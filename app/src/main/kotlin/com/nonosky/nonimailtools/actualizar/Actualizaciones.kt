package com.nonosky.nonimailtools.actualizar

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.MainActivity
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.actualizar.Accion
import com.nonosky.nonimailtools.core.actualizar.Actualizador
import com.nonosky.nonimailtools.core.actualizar.Lanzamiento
import com.nonosky.nonimailtools.core.actualizar.Lanzamientos
import com.nonosky.nonimailtools.core.actualizar.Sumas
import com.nonosky.nonimailtools.core.actualizar.Version
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** What the settings line and the banner show. */
sealed interface EstadoAct {
    data object Reposo : EstadoAct
    data object Buscando : EstadoAct
    data class AlDia(val version: String) : EstadoAct
    data class Descargando(val version: String) : EstadoAct

    /** Downloaded, checksum and certificate verified: waiting for the person (or for a running task to end). */
    data class Lista(val version: String) : EstadoAct
    data class Instalando(val version: String) : EstadoAct

    /** Only after the person pressed «Buscar actualizaciones»; background failures stay silent. */
    data object Fallo : EstadoAct

    /** Debug builds (another application id and key) never update themselves. */
    data object SoloRelease : EstadoAct
}

/** A step of the update failed for a reason worth reporting (not a plain lack of network). */
private class FalloAct(mensaje: String) : Exception(mensaje)

/**
 * Self-update from GitHub Releases: check, download (resumable), verify SHA-256 and signing certificate,
 * then install through a PackageInstaller session. Failures go to the log and to telemetry
 * (`error`, context `actualizacion`); the person only sees the result of a manual check.
 */
class Actualizaciones(private val app: NmtApp) {
    private val _estado = MutableStateFlow<EstadoAct>(EstadoAct.Reposo)
    val estado: StateFlow<EstadoAct> = _estado.asStateFlow()

    private val _puedeInstalar = MutableStateFlow(true)

    /** «Install unknown apps» is granted for this app. */
    val puedeInstalar: StateFlow<Boolean> = _puedeInstalar.asStateFlow()

    private val dir get() = File(app.filesDir, "actualizaciones")
    private val log get() = app.telemetry.log
    private val instalando = AtomicBoolean(false)

    /** Version the person turned down in the system dialog: no more silent attempts or notices for it. */
    @Volatile private var rechazada: String? = null

    init {
        // A running sync or clean blocks the install; when it ends, a ready update goes on.
        app.scope.launch { app.operaciones.ocupada.collect { if (!it) reevaluar() } }
    }

    private fun visible() = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    fun refrescarPermiso() { _puedeInstalar.value = app.packageManager.canRequestPackageInstalls() }

    private fun puedeSilencioso() = Build.VERSION.SDK_INT >= 31 && app.packageManager.canRequestPackageInstalls()

    // --- Scheduling ---------------------------------------------------------------------------------

    private val redOk = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** App in the foreground: tidy up, schedule the periodic job and check if the last check is old enough. */
    fun alIniciar() {
        refrescarPermiso()
        if (BuildConfig.DEBUG) return
        app.scope.launch(Dispatchers.IO) { recuperar(avisar = true) }
        val v = app.ajustes.valores.value
        programar(v.actualizarAuto)
        val desdeUltima = System.currentTimeMillis() - v.actualizarUltimaMs
        if (v.actualizarAuto && desdeUltima >= TimeUnit.HOURS.toMillis(BuildConfig.UPDATE_MIN_HOURS.toLong())) encolar(solicitada = false)
    }

    private fun programar(auto: Boolean) {
        runCatching {
            val wm = WorkManager.getInstance(app)
            if (auto) {
                wm.enqueueUniquePeriodicWork(
                    TRABAJO_PERIODICO, ExistingPeriodicWorkPolicy.KEEP,
                    PeriodicWorkRequestBuilder<ActualizarWorker>(BuildConfig.UPDATE_PERIOD_HOURS.toLong(), TimeUnit.HOURS).setConstraints(redOk).build(),
                )
            } else {
                wm.cancelUniqueWork(TRABAJO_PERIODICO)
            }
        }
    }

    private fun encolar(solicitada: Boolean) {
        runCatching {
            val req = OneTimeWorkRequestBuilder<ActualizarWorker>()
                .setInputData(workDataOf(ActualizarWorker.CLAVE_SOLICITADA to solicitada))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .apply { if (!solicitada) setConstraints(redOk) }
                .build()
            WorkManager.getInstance(app).enqueueUniqueWork(
                TRABAJO_AHORA, if (solicitada) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, req,
            )
        }
    }

    /** The «Actualizar automáticamente» switch. */
    fun cambiarAuto(on: Boolean) {
        app.ajustes.actualizarAuto(on)
        if (BuildConfig.DEBUG) return
        programar(on)
        if (on) encolar(solicitada = false)
    }

    /** The «Buscar actualizaciones» button: no throttle, no network constraint, result on the settings line. */
    fun buscarAhora() {
        if (BuildConfig.DEBUG) { _estado.value = EstadoAct.SoloRelease; return }
        _estado.value = EstadoAct.Buscando
        encolar(solicitada = true)
    }

    // --- Check, download, verify --------------------------------------------------------------------

    /** Called by [ActualizarWorker]. Returns false when the worker should retry later (no network, server error). */
    suspend fun ejecutar(solicitada: Boolean): Boolean {
        if (BuildConfig.DEBUG) { if (solicitada) _estado.value = EstadoAct.SoloRelease; return true }
        app.ajustes.actualizarUltima(System.currentTimeMillis())
        if (solicitada) _estado.value = EstadoAct.Buscando
        try {
            val rel = withContext(Dispatchers.IO) { consultar() }
            val version = rel.version.toString()
            val automatica = app.ajustes.valores.value.actualizarAuto
            var apk = archivoListo(version)
            var accion = decidir(version, automatica, solicitada, apk != null)
            if (accion == Accion.DESCARGAR) {
                _estado.value = EstadoAct.Descargando(version)
                log.i("actualizacion", "Downloading $version")
                apk = descargar(rel)
                accion = decidir(version, automatica, solicitada, true)
            }
            if (accion == Accion.NADA) {
                if (!Version.esMasNueva(version, BuildConfig.VERSION_NAME)) {
                    log.i("actualizacion", "Up to date (latest $version)")
                    liberarSi { _estado.value = EstadoAct.AlDia(BuildConfig.VERSION_NAME) }
                } else {
                    log.i("actualizacion", "$version available; automatic updates are off")
                    liberarSi { _estado.value = EstadoAct.Reposo }
                }
            } else {
                checkNotNull(apk)
                withContext(Dispatchers.IO) { aplicar(accion, version) }
            }
            return true
        } catch (e: CancellationException) {
            liberarSi { _estado.value = EstadoAct.Reposo }
            throw e
        } catch (e: FalloAct) {
            fallar(e.message.orEmpty(), e, solicitada)
            return true
        } catch (e: IOException) {
            // No network, DNS, timeouts: expected on a phone. Logged, retried later, not worth a telemetry event.
            val red = e is UnknownHostException || e is SocketTimeoutException || e is SocketException
            if (red) log.w("actualizacion", "Update check failed (network): ${e.message}")
            else app.telemetry.error("actualizacion", "Update check failed: ${e.message}", e)
            if (solicitada) _estado.value = EstadoAct.Fallo else liberarSi { _estado.value = EstadoAct.Reposo }
            return solicitada // a manual check is not retried behind the person's back
        } catch (e: Exception) {
            fallar("Update check crashed: ${e.message}", e, solicitada)
            return true
        }
    }

    private fun decidir(version: String, automatica: Boolean, solicitada: Boolean, listo: Boolean) = Actualizador.decidir(
        BuildConfig.VERSION_NAME, version, automatica, solicitada, listo,
        operacionEnCurso = app.operaciones.ocupada.value, appVisible = visible() || rechazada == version,
    )

    /** Sets a state only when no update is waiting for the person (a background check must not hide the banner). */
    private inline fun liberarSi(poner: () -> Unit) {
        if (_estado.value !is EstadoAct.Lista && _estado.value !is EstadoAct.Instalando) poner()
    }

    private fun fallar(mensaje: String, e: Throwable?, solicitada: Boolean) {
        app.telemetry.error("actualizacion", mensaje, e)
        if (solicitada) _estado.value = EstadoAct.Fallo else liberarSi { _estado.value = EstadoAct.Reposo }
    }

    private fun consultar(): Lanzamiento {
        val url = "${BuildConfig.UPDATE_API_BASE}/repos/${BuildConfig.UPDATE_REPO}/releases/latest"
        val texto = Red.texto(url, app.telemetry.userAgent, "application/vnd.github+json")
        val lanzamiento = try {
            Lanzamientos.parse(texto, BuildConfig.UPDATE_APK_ASSET, BuildConfig.UPDATE_SUMS_ASSET)
        } catch (e: kotlinx.serialization.SerializationException) {
            throw FalloAct("The release answer cannot be read: ${e.message}")
        }
        return lanzamiento
            ?: throw FalloAct("The latest release has no usable ${BuildConfig.UPDATE_APK_ASSET} and ${BuildConfig.UPDATE_SUMS_ASSET}")
    }

    private fun archivoListo(version: String): File? = File(dir, "$version.apk").takeIf { it.isFile && it.length() > 0 }

    /** Resumable download of the APK, SHA-256 against SHA256SUMS.txt, then the certificate check. */
    private suspend fun descargar(rel: Lanzamiento): File = withContext(Dispatchers.IO) {
        val version = rel.version.toString()
        dir.mkdirs()
        // Anything that is not this version is stale.
        dir.listFiles()?.filter { !it.name.startsWith("$version.apk") }?.forEach { it.delete() }

        val esperado = Sumas.buscar(Red.texto(rel.sumasUrl, app.telemetry.userAgent), BuildConfig.UPDATE_APK_ASSET)
            ?: throw FalloAct("${BuildConfig.UPDATE_SUMS_ASSET} has no entry for ${BuildConfig.UPDATE_APK_ASSET}")

        val final = File(dir, "$version.apk")
        val parcial = File(dir, "$version.apk.part")
        var hecho = if (parcial.exists()) parcial.length() else 0L
        if (rel.apkBytes > 0 && hecho > rel.apkBytes) { parcial.delete(); hecho = 0 }
        if (rel.apkBytes <= 0 || hecho < rel.apkBytes) {
            val (conn, desde) = Red.abrir(rel.apkUrl, app.telemetry.userAgent, hecho)
            try {
                FileOutputStream(parcial, desde > 0).use { out ->
                    conn.inputStream.use { ins ->
                        val buf = ByteArray(256 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = ins.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                        }
                    }
                }
            } finally {
                conn.disconnect()
            }
        }
        // Cut short: keep the partial file, the next attempt resumes from it.
        if (rel.apkBytes > 0 && parcial.length() < rel.apkBytes) throw IOException("download cut short (${parcial.length()} of ${rel.apkBytes})")

        val md = MessageDigest.getInstance("SHA-256")
        parcial.inputStream().use { ins ->
            val buf = ByteArray(1024 * 1024)
            while (true) {
                currentCoroutineContext().ensureActive()
                val n = ins.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        val obtenido = md.digest().joinToString("") { "%02x".format(it) }
        if (obtenido != esperado) {
            parcial.delete()
            throw FalloAct("SHA-256 of the download does not match ${BuildConfig.UPDATE_SUMS_ASSET}; file discarded")
        }
        final.delete()
        if (!parcial.renameTo(final)) throw FalloAct("Could not move the verified APK into place")

        Firmas.verificar(app, final)?.let { motivo ->
            final.delete()
            throw FalloAct("Update $version discarded: $motivo")
        }
        log.i("actualizacion", "Update $version downloaded and verified")
        final
    }

    /** At start: forget leftovers, and pick up a verified APK from an earlier run. */
    private fun recuperar(avisar: Boolean) {
        val actual = Version.parse(BuildConfig.VERSION_NAME)
        val archivos = dir.listFiles() ?: return
        var mejor: Pair<Version, File>? = null
        for (f in archivos) {
            val esParcial = f.name.endsWith(".apk.part")
            val v = Version.parse(f.name.removeSuffix(".part").removeSuffix(".apk"))
            if (v == null || actual == null || v <= actual || !(esParcial || f.name.endsWith(".apk"))) { f.delete(); continue }
            if (esParcial) continue // a future version in progress: the download resumes from it
            val m = mejor
            if (m == null || v > m.first) { m?.second?.delete(); mejor = v to f } else f.delete()
        }
        val elegido = mejor
        if (elegido == null) {
            if (_estado.value is EstadoAct.Reposo) runCatching { NotificationManagerCompat.from(app).cancel(ID_AVISO) }
            return
        }
        val (v, f) = elegido
        Firmas.verificar(app, f)?.let { motivo ->
            f.delete()
            app.telemetry.error("actualizacion", "Update $v discarded: $motivo", null)
            return
        }
        liberarSi { _estado.value = EstadoAct.Lista(v.toString()) }
        if (avisar) reevaluar()
    }

    // --- Telling the person and installing -----------------------------------------------------------

    /** Carries out what [Actualizador.decidir] chose for a ready APK. */
    private fun aplicar(accion: Accion, version: String) {
        _estado.value = EstadoAct.Lista(version)
        when (accion) {
            Accion.ESPERAR -> log.i("actualizacion", "$version is ready; waiting for the running task to finish")
            Accion.INSTALAR_SILENCIOSO ->
                if (puedeSilencioso()) instalar(silencioso = true)
                else avisarListo(version)
            // On screen the banner already says it; in the background the notification does.
            Accion.AVISAR -> if (!visible()) avisarListo(version)
            else -> Unit
        }
    }

    private fun avisarListo(version: String) {
        if (rechazada != version) notificarLista(version)
    }

    /** The app left the screen with an update ready and nothing running: leave the notification. */
    fun alSalir() {
        val e = _estado.value as? EstadoAct.Lista ?: return
        if (!app.operaciones.ocupada.value) avisarListo(e.version)
    }

    private fun reevaluar() {
        app.scope.launch(Dispatchers.IO) {
            val e = _estado.value as? EstadoAct.Lista ?: return@launch
            if (archivoListo(e.version) == null) { _estado.value = EstadoAct.Reposo; return@launch }
            aplicar(decidir(e.version, app.ajustes.valores.value.actualizarAuto, false, true), e.version)
        }
    }

    /** The banner or notification tap. Opens the system confirmation; never during a sync or clean. */
    fun instalarDesdeToque() {
        app.scope.launch(Dispatchers.IO) {
            rechazada = null
            if (_estado.value !is EstadoAct.Lista) recuperar(avisar = false)
            instalar(silencioso = false)
        }
    }

    private fun instalar(silencioso: Boolean) {
        // Instalando is accepted too: a confirmation that was ignored can be asked for again.
        val version = when (val s = _estado.value) {
            is EstadoAct.Lista -> s.version
            is EstadoAct.Instalando -> s.version
            else -> return
        }
        if (!instalando.compareAndSet(false, true)) return
        try {
            if (app.operaciones.ocupada.value) return
            val apk = archivoListo(version) ?: run { _estado.value = EstadoAct.Reposo; return }
            refrescarPermiso()
            if (!_puedeInstalar.value) return
            Firmas.verificar(app, apk)?.let { motivo ->
                apk.delete()
                _estado.value = EstadoAct.Reposo
                app.telemetry.error("actualizacion", "Update ${version} discarded before install: $motivo", null)
                return
            }
            _estado.value = EstadoAct.Instalando(version)
            log.i("actualizacion", "Installing ${version} (silent=$silencioso)")
            Instalador.instalar(app, apk, version, silencioso)
        } catch (t: Throwable) {
            app.telemetry.error("actualizacion", "Install session failed: ${t.message}", t)
            _estado.value = EstadoAct.Lista(version)
        } finally {
            instalando.set(false)
        }
    }

    /** The system wants the person to confirm: open its screen now, or leave a notification when in the background. */
    fun pedirConfirmacion(confirmar: Intent) {
        val version = (_estado.value as? EstadoAct.Instalando)?.version ?: ""
        if (visible()) {
            runCatching { app.startActivity(confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { app.telemetry.error("actualizacion", "Cannot open the install confirmation: ${it.message}", it) }
        } else {
            val abrir = PendingIntent.getActivity(
                app, 3, confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            notificar(version, abrir)
        }
    }

    /** Anything but success. A refusal in the dialog is not an error; a broken APK is dropped. */
    fun instalacionFallida(estado: Int, mensaje: String) {
        val version = (_estado.value as? EstadoAct.Instalando)?.version
        when (estado) {
            PackageInstaller.STATUS_FAILURE_ABORTED -> {
                log.i("actualizacion", "Install declined: $mensaje")
                rechazada = version
            }
            else -> {
                app.telemetry.error("actualizacion", "Install failed (status $estado): $mensaje", null)
                if (estado == PackageInstaller.STATUS_FAILURE_INVALID || estado == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ||
                    estado == PackageInstaller.STATUS_FAILURE_CONFLICT
                ) {
                    version?.let { File(dir, "$it.apk").delete() }
                    _estado.value = EstadoAct.Reposo
                    return
                }
            }
        }
        if (version != null) _estado.value = EstadoAct.Lista(version)
    }

    private fun notificarLista(version: String) {
        val abrir = PendingIntent.getActivity(
            app, 2,
            Intent(app, MainActivity::class.java).setAction(ACCION_INSTALAR).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        notificar(version, abrir)
    }

    private fun notificar(version: String, alToque: PendingIntent) {
        if (!NotificationManagerCompat.from(app).areNotificationsEnabled()) return
        val nm = app.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(CANAL, app.getString(R.string.act_canal), NotificationManager.IMPORTANCE_DEFAULT))
        }
        val n = NotificationCompat.Builder(app, CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(app.getString(R.string.act_banner, version))
            .setContentText(app.getString(R.string.act_notif_texto))
            .setContentIntent(alToque)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .addAction(0, app.getString(R.string.act_instalar), alToque)
            .build()
        runCatching { NotificationManagerCompat.from(app).notify(ID_AVISO, n) }
    }

    companion object {
        const val ACCION_INSTALAR = "com.nonosky.nonimailtools.INSTALAR_ACTUALIZACION"
        const val CANAL = "actualizaciones"
        private const val ID_AVISO = 1003
        private const val TRABAJO_PERIODICO = "nmt-actualizar-periodica"
        private const val TRABAJO_AHORA = "nmt-actualizar-ya"
    }
}

/** Periodic (every 12 h, with network) and one-shot update check. All the logic lives in [Actualizaciones]. */
class ActualizarWorker(ctx: android.content.Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val solicitada = inputData.getBoolean(CLAVE_SOLICITADA, false)
        val terminado = NmtApp.instance.actualizaciones.ejecutar(solicitada)
        return if (terminado || runAttemptCount >= MAX_INTENTOS) Result.success() else Result.retry()
    }

    companion object {
        const val CLAVE_SOLICITADA = "solicitada"
        private const val MAX_INTENTOS = 5
    }
}
