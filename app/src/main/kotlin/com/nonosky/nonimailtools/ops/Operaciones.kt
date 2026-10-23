package com.nonosky.nonimailtools.ops

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.Reporter
import com.nonosky.nonimailtools.core.licencias.LicenseGate
import com.nonosky.nonimailtools.core.licencias.Tipo
import com.nonosky.nonimailtools.core.limpiar.CleanOptions
import com.nonosky.nonimailtools.core.limpiar.CleanProgress
import com.nonosky.nonimailtools.core.limpiar.CleanResult
import com.nonosky.nonimailtools.core.limpiar.IaScorer
import com.nonosky.nonimailtools.core.limpiar.Limpieza
import com.nonosky.nonimailtools.core.limpiar.Ollama
import com.nonosky.nonimailtools.core.limpiar.Rules
import com.nonosky.nonimailtools.core.limpiar.ScanMode
import com.nonosky.nonimailtools.core.limpiar.ScanOptions
import com.nonosky.nonimailtools.core.limpiar.ScanProgress
import com.nonosky.nonimailtools.core.limpiar.ScanResult
import com.nonosky.nonimailtools.core.mail.ImapException
import com.nonosky.nonimailtools.core.sync.SyncEngine
import com.nonosky.nonimailtools.core.sync.SyncOptions
import com.nonosky.nonimailtools.core.sync.SyncProgress
import com.nonosky.nonimailtools.core.sync.SyncResult
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.data.Cuenta
import com.nonosky.nonimailtools.data.GoogleReautenticar
import com.nonosky.nonimailtools.data.timeouts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** A short, translatable failure the UI shows in one line. */
data class Fallo(val tipo: Tipo2, val detalle: String) {
    enum class Tipo2 { AUTENTICACION, CONEXION, SIN_PAPELERA, SIN_LICENCIA, CUENTA_ILEGIBLE, GOOGLE_REAUTH, OTRO }
}

sealed interface EstadoEscaneo {
    data object Reposo : EstadoEscaneo
    data class Corriendo(val cuenta: String, val p: ScanProgress) : EstadoEscaneo
    data class Listo(val cuenta: Cuenta, val r: ScanResult) : EstadoEscaneo
    data class Error(val f: Fallo) : EstadoEscaneo
}

sealed interface EstadoLimpieza {
    data object Reposo : EstadoLimpieza
    data class Corriendo(val dryRun: Boolean, val p: CleanProgress) : EstadoLimpieza
    data class Listo(val r: CleanResult, val cuenta: String) : EstadoLimpieza
    data class Error(val f: Fallo) : EstadoLimpieza
}

sealed interface EstadoSync {
    data object Reposo : EstadoSync
    data class Corriendo(val dryRun: Boolean, val p: SyncProgress) : EstadoSync
    data class Listo(val r: SyncResult, val origen: String, val destino: String) : EstadoSync
    data class Error(val f: Fallo) : EstadoSync
}

/** What the foreground service has to run. */
sealed interface Trabajo {
    val titulo: Int

    data class Escanear(
        val cuenta: Cuenta, val modo: ScanMode, val cantidad: Int, val usarIa: Boolean,
        val protegidos: List<String>, val keep: String,
    ) : Trabajo { override val titulo get() = com.nonosky.nonimailtools.R.string.op_escaneando }

    data class Limpiar(
        val cuenta: Cuenta, val remitentes: List<String>, val dryRun: Boolean,
        val protegidos: List<String>, val keep: String,
    ) : Trabajo { override val titulo get() = com.nonosky.nonimailtools.R.string.op_limpiando }

    data class Sincronizar(
        val origen: Cuenta, val destino: Cuenta, val dryRun: Boolean, val incluir: Set<String>, val excluir: Set<String>,
    ) : Trabajo { override val titulo get() = com.nonosky.nonimailtools.R.string.op_sincronizando }
}

/** Progress line for the notification. */
data class Avance(val titulo: Int, val detalle: String, val fraccion: Float?)

/**
 * Hub between the screens and the foreground service: states as flows, the job to run, and the
 * cancel flag. The engines run in [ejecutar], always inside [OperacionService].
 */
class Operaciones(private val app: NmtApp) {
    private companion object { const val MAX_LINEAS = 200 }

    private val _escaneo = MutableStateFlow<EstadoEscaneo>(EstadoEscaneo.Reposo)
    private val _limpieza = MutableStateFlow<EstadoLimpieza>(EstadoLimpieza.Reposo)
    private val _sync = MutableStateFlow<EstadoSync>(EstadoSync.Reposo)
    val escaneo: StateFlow<EstadoEscaneo> = _escaneo.asStateFlow()
    val limpieza: StateFlow<EstadoLimpieza> = _limpieza.asStateFlow()
    val sync: StateFlow<EstadoSync> = _sync.asStateFlow()

    /** Live terminal windows: reading + heuristics, the AI model, and the sync network. */
    enum class Terminal { CPU, IA, RED }
    private val terminales = Terminal.entries.associateWith { MutableStateFlow<List<String>>(emptyList()) }
    fun terminal(t: Terminal): StateFlow<List<String>> = terminales.getValue(t).asStateFlow()
    private fun limpiarTerminal(vararg t: Terminal) = t.forEach { terminales.getValue(it).value = emptyList() }

    /** Appends one line (secrets scrubbed), keeping the last [MAX_LINEAS]. */
    private fun escribir(t: Terminal, linea: String) {
        var l = linea
        for (s in app.cuentas.secretos()) l = l.replace(s, "••••")
        val f = terminales.getValue(t)
        f.value = (f.value + l).takeLast(MAX_LINEAS)
    }

    private fun faseRed(f: SyncProgress.Phase) = when (f) {
        SyncProgress.Phase.CONNECTING -> "conectando"
        SyncProgress.Phase.PLANNING -> "planificando"
        SyncProgress.Phase.INDEXING -> "comparando"
        SyncProgress.Phase.COPYING -> "copiando"
        SyncProgress.Phase.VERIFYING -> "verificando"
        SyncProgress.Phase.DONE -> "listo"
    }

    /** Engine lines tagged «[cpu] »/«[ia] » go to their window; the rest only to the log file. */
    private fun ruteo(linea: String) {
        when {
            linea.startsWith("[cpu] ") -> escribir(Terminal.CPU, linea.removePrefix("[cpu] "))
            linea.startsWith("[ia] ") -> escribir(Terminal.IA, linea.removePrefix("[ia] "))
        }
    }

    private val _ocupada = MutableStateFlow(false)
    val ocupada: StateFlow<Boolean> = _ocupada.asStateFlow()

    @Volatile var cancelada = false
        private set
    @Volatile private var pendiente: Trabajo? = null

    fun cancelar() { cancelada = true }

    /** Test hook (screenshots): shows a state without running anything. */
    @androidx.annotation.VisibleForTesting
    fun mostrar(e: EstadoEscaneo) { _escaneo.value = e }

    @androidx.annotation.VisibleForTesting
    fun mostrar(e: EstadoLimpieza) { _limpieza.value = e }

    @androidx.annotation.VisibleForTesting
    fun mostrar(e: EstadoSync) { _sync.value = e }

    fun reiniciarLimpieza() { _limpieza.value = EstadoLimpieza.Reposo }
    fun reiniciarSync() { _sync.value = EstadoSync.Reposo }
    fun reiniciarEscaneo() { _escaneo.value = EstadoEscaneo.Reposo; _limpieza.value = EstadoLimpieza.Reposo }

    /** Queues [t] and starts the service. Returns false when something is already running. */
    fun iniciar(ctx: Context, t: Trabajo): Boolean {
        if (!_ocupada.compareAndSet(false, true)) return false
        cancelada = false
        pendiente = t
        when (t) {
            is Trabajo.Escanear -> { _limpieza.value = EstadoLimpieza.Reposo; _escaneo.value = EstadoEscaneo.Corriendo(t.cuenta.email, ScanProgress(ScanProgress.Phase.CONNECTING)) }
            is Trabajo.Limpiar -> _limpieza.value = EstadoLimpieza.Corriendo(t.dryRun, CleanProgress(0, t.remitentes.size, 0))
            is Trabajo.Sincronizar -> _sync.value = EstadoSync.Corriendo(t.dryRun, SyncProgress(SyncProgress.Phase.CONNECTING))
        }
        ContextCompat.startForegroundService(ctx, Intent(ctx, OperacionService::class.java).setAction(OperacionService.ACTION_START))
        return true
    }

    fun tomarPendiente(): Trabajo? = pendiente.also { pendiente = null }

    fun liberar() { _ocupada.value = false }

    private fun fallo(contexto: String, cuenta: String?, e: Throwable): Fallo {
        app.telemetry.error(contexto, e.message ?: e.javaClass.simpleName, e, cuenta)
        val tipo = when ((e as? ImapException)?.reason) {
            ImapException.Reason.AUTH -> Fallo.Tipo2.AUTENTICACION
            ImapException.Reason.CONNECT -> Fallo.Tipo2.CONEXION
            ImapException.Reason.NO_TRASH -> Fallo.Tipo2.SIN_PAPELERA
            else -> Fallo.Tipo2.OTRO
        }
        return Fallo(tipo, e.message.orEmpty())
    }

    private fun gate(tipo: Tipo, cuentas: List<Cuenta>) =
        LicenseGate.check(cuentas.map { it.email }, tipo, app.licencias.licencias.value, System.currentTimeMillis() / 1000)

    /** Runs [t] to the end. Blocking: the service calls it from a worker thread. */
    fun ejecutar(t: Trabajo, avance: (Avance) -> Unit) {
        val defaults = Defaults.instance
        val t0 = System.currentTimeMillis()
        fun secs() = (System.currentTimeMillis() - t0) / 1000
        try {
            when (t) {
                is Trabajo.Escanear -> escanear(t, defaults, avance, ::secs)
                is Trabajo.Limpiar -> limpiar(t, defaults, avance, ::secs)
                is Trabajo.Sincronizar -> sincronizar(t, defaults, avance, ::secs)
            }
        } finally {
            _ocupada.value = false
        }
    }

    private fun rulesOf(keep: String, d: Defaults): Rules = runCatching { Rules.compile(d.heuristics.copy(keepOverride = keep)) }
        .getOrElse { Rules.compile(d.heuristics) }

    private fun escanear(t: Trabajo.Escanear, d: Defaults, avance: (Avance) -> Unit, secs: () -> Long) {
        val cuenta = t.cuenta
        val acc = try { app.cuentas.imap(cuenta) } catch (e: GoogleReautenticar) {
            _escaneo.value = EstadoEscaneo.Error(Fallo(Fallo.Tipo2.GOOGLE_REAUTH, e.message.orEmpty())); return
        }
        if (acc == null) { _escaneo.value = EstadoEscaneo.Error(Fallo(Fallo.Tipo2.CUENTA_ILEGIBLE, "")); return }
        val v = app.ajustes.valores.value
        // Same interface for both engines; if the model cannot be loaded the heuristics score alone.
        val ia: IaScorer? = if (!t.usarIa || !v.iaActiva) null else when (val modo = v.iaModoEfectivo) {
            "red" -> Ollama(Ollama.normalizeUrl(v.ollamaUrl, BuildConfig.OLLAMA_PORT), v.ollamaModelo, BuildConfig.OLLAMA_TIMEOUT_MS, d.llm.numCtx, d.llm.numPredict)
            else -> runCatching { app.ia.puntuador(modo) }
                .onFailure { app.telemetry.error("ia", "On-device model failed to load: ${it.message}", it, cuenta.email) }
                .getOrNull()
        }
        val opts = ScanOptions(
            t.modo, t.cantidad, t.protegidos, rulesOf(t.keep, d), d.scores, d.cleaning, d.folders.sent, ia, d.llm.prompt, d.llm.categoryScores,
        )
        val rep = object : Reporter<ScanProgress> {
            override fun log(line: String) { app.telemetry.log.i("limpiar", line); ruteo(line) }
            override fun cancelled() = cancelada
            override fun progress(p: ScanProgress) {
                _escaneo.value = EstadoEscaneo.Corriendo(cuenta.email, p)
                avance(Avance(t.titulo, "${cuenta.email} · ${p.done}/${p.total}", if (p.total > 0) p.fraction else null))
            }
        }
        try {
            app.telemetry.log.i("limpiar", "Scan start (${t.modo.id}=${t.cantidad}, ai=${ia != null})")
            limpiarTerminal(Terminal.CPU, Terminal.IA)
            escribir(Terminal.CPU, "Conectando con ${cuenta.email} · últimos ${t.cantidad} días")
            escribir(Terminal.IA, if (ia != null) "Modelo listo" else "IA apagada: decide solo la heurística")
            val r = Limpieza(cuenta.timeouts).scan(acc, opts, rep)
            r.aiError?.let { app.telemetry.error("ia", it, null, cuenta.email) }
            _escaneo.value = EstadoEscaneo.Listo(cuenta, r)
            app.telemetry.registrar(
                Telemetria.limpiar(cuenta.email, "escaneo", true, r.reviewed, r.senders.size, null, secs(), if (r.cancelled) "cancelado" else "ok", true),
            )
        } catch (e: Exception) {
            _escaneo.value = EstadoEscaneo.Error(fallo("limpiar", cuenta.email, e))
            app.telemetry.registrar(Telemetria.limpiar(cuenta.email, "escaneo", true, null, null, null, secs(), "error", true))
        } finally {
            runCatching { ia?.close() }
        }
        app.telemetry.enviarYa()
    }

    private fun limpiar(t: Trabajo.Limpiar, d: Defaults, avance: (Avance) -> Unit, secs: () -> Long) {
        val cuenta = t.cuenta
        val gate = gate(Tipo.LIMPIAR, listOf(cuenta))
        if (!t.dryRun && !gate.permitido) {
            _limpieza.value = EstadoLimpieza.Error(Fallo(Fallo.Tipo2.SIN_LICENCIA, cuenta.email)); return
        }
        val acc = try { app.cuentas.imap(cuenta) } catch (e: GoogleReautenticar) {
            _limpieza.value = EstadoLimpieza.Error(Fallo(Fallo.Tipo2.GOOGLE_REAUTH, e.message.orEmpty())); return
        }
        if (acc == null) { _limpieza.value = EstadoLimpieza.Error(Fallo(Fallo.Tipo2.CUENTA_ILEGIBLE, "")); return }
        val opts = CleanOptions(t.dryRun, t.protegidos, rulesOf(t.keep, d), d.folders.trash)
        val rep = object : Reporter<CleanProgress> {
            override fun log(line: String) { app.telemetry.log.i("limpiar", line); escribir(Terminal.CPU, line.removePrefix("[cpu] ")) }
            override fun cancelled() = cancelada
            override fun progress(p: CleanProgress) {
                _limpieza.value = EstadoLimpieza.Corriendo(t.dryRun, p)
                avance(Avance(t.titulo, "${cuenta.email} · ${p.done}/${p.total}", p.fraction))
            }
        }
        try {
            app.telemetry.log.i("limpiar", "Execute start (dryRun=${t.dryRun}, senders=${t.remitentes.size})")
            escribir(Terminal.CPU, (if (t.dryRun) "Simulación: " else "Eliminando: ") + "${t.remitentes.size} remitentes")
            val r = Limpieza(cuenta.timeouts).execute(acc, t.remitentes, opts, rep)
            _limpieza.value = EstadoLimpieza.Listo(r, cuenta.email)
            app.telemetry.registrar(
                Telemetria.limpiar(cuenta.email, "ejecucion", t.dryRun, null, t.remitentes.size, if (t.dryRun) 0 else r.total, secs(), if (r.cancelled) "cancelado" else "ok", gate.permitido),
            )
        } catch (e: Exception) {
            _limpieza.value = EstadoLimpieza.Error(fallo("limpiar", cuenta.email, e))
            app.telemetry.registrar(Telemetria.limpiar(cuenta.email, "ejecucion", t.dryRun, null, t.remitentes.size, null, secs(), "error", gate.permitido))
        }
        app.telemetry.enviarYa()
    }

    private fun sincronizar(t: Trabajo.Sincronizar, d: Defaults, avance: (Avance) -> Unit, secs: () -> Long) {
        val gate = gate(Tipo.SINCRONIZAR, listOf(t.origen, t.destino))
        if (!t.dryRun && !gate.permitido) {
            _sync.value = EstadoSync.Error(Fallo(Fallo.Tipo2.SIN_LICENCIA, gate.cuenta)); return
        }
        val (o, dd) = try { app.cuentas.imap(t.origen) to app.cuentas.imap(t.destino) } catch (e: GoogleReautenticar) {
            _sync.value = EstadoSync.Error(Fallo(Fallo.Tipo2.GOOGLE_REAUTH, e.message.orEmpty())); return
        }
        if (o == null || dd == null) { _sync.value = EstadoSync.Error(Fallo(Fallo.Tipo2.CUENTA_ILEGIBLE, "")); return }
        val rep = object : Reporter<SyncProgress> {
            var ultima = 0L
            var carpeta = ""
            val inicio = System.currentTimeMillis()
            override fun log(line: String) { app.telemetry.log.i("sincronizar", line); escribir(Terminal.RED, line) }
            override fun cancelled() = cancelada
            override fun progress(p: SyncProgress) {
                val ahora = System.currentTimeMillis()
                if (p.folder != carpeta || ahora - ultima >= 1000) {
                    carpeta = p.folder; ultima = ahora
                    val kbs = p.bytes / 1024.0 / ((ahora - inicio).coerceAtLeast(1) / 1000.0)
                    escribir(Terminal.RED, "${faseRed(p.phase)} · ${p.folder} · ${p.folderCopied}/${p.folderToCopy} · total ${p.copied} · ${p.bytes / 1024} KB · ${"%.0f".format(kbs)} KB/s")
                }
                _sync.value = EstadoSync.Corriendo(t.dryRun, p)
                avance(Avance(t.titulo, "${p.foldersDone}/${p.foldersTotal} · ${p.folder}", p.fraction))
            }
        }
        try {
            app.telemetry.log.i("sincronizar", "Sync start (dryRun=${t.dryRun})")
            limpiarTerminal(Terminal.RED)
            escribir(Terminal.RED, "${t.origen.email} → ${t.destino.email}" + if (t.dryRun) " (simulación)" else "")
            val r = SyncEngine(t.origen.timeouts, d.sync).run(o, dd, SyncOptions(t.dryRun, t.incluir, t.excluir), rep)
            _sync.value = EstadoSync.Listo(r, t.origen.email, t.destino.email)
            val resultado = when { r.cancelled -> "cancelado"; r.ok -> "ok"; else -> "error" }
            if (!r.ok && !r.cancelled && r.error != null) {
                app.telemetry.error("sincronizar", r.error!!, null, t.origen.email)
            }
            app.telemetry.registrar(
                Telemetria.sincronizar(
                    t.origen.email, t.destino.email, t.dryRun, r.folders.size, r.totals.source, r.totals.copied, r.totals.bytes,
                    secs(), resultado, gate.permitido,
                ),
            )
        } catch (e: Exception) {
            _sync.value = EstadoSync.Error(fallo("sincronizar", t.origen.email, e))
            app.telemetry.registrar(
                Telemetria.sincronizar(t.origen.email, t.destino.email, t.dryRun, 0, 0, 0, 0, secs(), "error", gate.permitido),
            )
        }
        app.telemetry.enviarYa()
    }

    /** Called by the service when it is cut (timeout / destroyed): leaves the states usable. */
    fun abortar() {
        cancelada = true
        _escaneo.update { if (it is EstadoEscaneo.Corriendo) EstadoEscaneo.Reposo else it }
        _limpieza.update { if (it is EstadoLimpieza.Corriendo) EstadoLimpieza.Reposo else it }
        _sync.update { if (it is EstadoSync.Corriendo) EstadoSync.Reposo else it }
        _ocupada.value = false
    }
}
