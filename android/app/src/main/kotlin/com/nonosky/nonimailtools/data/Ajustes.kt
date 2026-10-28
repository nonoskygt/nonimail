package com.nonosky.nonimailtools.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.limpiar.Fusion
import com.nonosky.nonimailtools.core.limpiar.LibroReglas
import com.nonosky.nonimailtools.core.limpiar.ReglaFecha
import com.nonosky.nonimailtools.core.limpiar.Reglas
import com.nonosky.nonimailtools.core.limpiar.SincronizadorReglas
import com.nonosky.nonimailtools.ui.theme.Acento
import com.nonosky.nonimailtools.ui.theme.Modo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.UUID

internal val Context.nmtStore by preferencesDataStore("nmt_settings")

/** Everything the person can change. Absent keys fall back to BuildConfig / defaults.json. */
data class Valores(
    /** "" = device language, otherwise "es" or "en". */
    val idioma: String = "",
    /** Only what the person chose is stored; null = default (auto / crimson). */
    val modoElegido: String? = null,
    val acentoElegido: String? = null,
    val configurado: Boolean = false,
    val ollamaUrl: String = "",
    val ollamaModelo: String = BuildConfig.OLLAMA_MODEL,
    /** "" = none, "basico" / "mediano" / "grande" = model on the phone, "red" = Ollama on the LAN, "nonosky" = the subscription's AI. */
    val iaModo: String = "",
    /** File name of the model that was downloaded, verified and loaded once (a retired model no longer matches). */
    val iaListoId: String = "",
    val telemetria: Boolean = true,
    val serviceUrl: String = BuildConfig.SERVICE_URL,
    val installId: String = "",
    val installEnviadaMs: Long = 0,
    val installHash: String = "",
    val keepOverride: String = "",
    val protegidos: String = "",
    val escaneoModo: String = "",
    val escaneoCantidad: Int = 0,
    val dureza: Int = -1,
    val usarIa: Boolean = true,
    val cuentaLimpiar: String = "",
    val syncOrigen: String = "",
    val syncDestino: String = "",
    val syncIncluir: String = "",
    val syncExcluir: String = "",
    /** «Actualizar automáticamente»: on by default. */
    val actualizarAuto: Boolean = true,
    /** Last time the update check ran (epoch ms); throttles the check at app start. */
    val actualizarUltimaMs: Long = 0,
    /** Saved sender rules (Conservar / Eliminar per sender or domain), with the dates the sync merges by. */
    val reglas: LibroReglas = LibroReglas(),
    /** Share the cleaning decisions with the collective filter (own switch, apart from telemetry). */
    val filtroCompartir: Boolean = Defaults.instance.filtro.compartir,
) {
    /** Installs from before 1.1 only had the Ollama address. */
    val iaModoEfectivo: String get() = iaModo.ifBlank { if (ollamaUrl.isNotBlank()) "red" else "" }
        .let { m -> if (m == "" || m == "red" || m == com.nonosky.nonimailtools.ops.MODO_NONOSKY || Defaults.instance.localAi.models.any { it.id == m }) m else "" } // tier retirado → sin IA hasta elegir
    val iaActiva: Boolean get() = when (val m = iaModoEfectivo) {
        "" -> false
        "red" -> ollamaUrl.isNotBlank()
        // The server checks the subscription; without it the scan goes on with the heuristics.
        com.nonosky.nonimailtools.ops.MODO_NONOSKY -> true
        else -> Defaults.instance.localAi.models.firstOrNull { it.id == m }?.archivo == iaListoId
    }
    val modo: Modo get() = Modo.of(modoElegido)
    val acento: Acento get() = Acento.of(acentoElegido)
    val keepEfectivo: String get() = keepOverride.ifBlank { Defaults.instance.heuristics.keepOverride }
    val duerezaEfectiva: Int get() = if (dureza in 0..100) dureza else Defaults.instance.cleaning.hardness
    val protegidosLista: List<String> get() = protegidos.split('\n', ',', ';', ' ').map { it.trim() }.filter { it.isNotEmpty() }
}

class Ajustes(private val ctx: Context, scope: CoroutineScope) {
    private object K {
        val idioma = stringPreferencesKey("idioma")
        val modo = stringPreferencesKey("nmt_modo")
        val acento = stringPreferencesKey("nmt_acento")
        val configurado = booleanPreferencesKey("configurado")
        val ollamaUrl = stringPreferencesKey("ollama_url")
        val ollamaModelo = stringPreferencesKey("ollama_modelo")
        val iaModo = stringPreferencesKey("ia_modo")
        val iaListoId = stringPreferencesKey("ia_listo_id")
        val telemetria = booleanPreferencesKey("telemetria")
        val serviceUrl = stringPreferencesKey("service_url")
        val installId = stringPreferencesKey("install_id")
        val installEnviada = longPreferencesKey("install_enviada_ms")
        val installHash = stringPreferencesKey("install_hash")
        val keep = stringPreferencesKey("keep_override")
        val protegidos = stringPreferencesKey("protegidos")
        val escaneoModo = stringPreferencesKey("escaneo_modo")
        val escaneoCantidad = intPreferencesKey("escaneo_cantidad")
        val dureza = intPreferencesKey("dureza")
        val usarIa = booleanPreferencesKey("usar_ia")
        val cuentaLimpiar = stringPreferencesKey("cuenta_limpiar")
        val syncOrigen = stringPreferencesKey("sync_origen")
        val syncDestino = stringPreferencesKey("sync_destino")
        val syncIncluir = stringPreferencesKey("sync_incluir")
        val syncExcluir = stringPreferencesKey("sync_excluir")
        val actualizarAuto = booleanPreferencesKey("actualizar_auto")
        val actualizarUltima = longPreferencesKey("actualizar_ultima_ms")
        val reglas = stringPreferencesKey("reglas_remitentes")
        val reglasMigradas = booleanPreferencesKey("reglas_migradas")
        val filtroCompartir = booleanPreferencesKey("filtro_compartir")
    }

    private fun read(p: Preferences) = Valores(
        idioma = p[K.idioma] ?: "",
        modoElegido = p[K.modo], acentoElegido = p[K.acento],
        configurado = p[K.configurado] ?: false,
        ollamaUrl = p[K.ollamaUrl] ?: "",
        ollamaModelo = p[K.ollamaModelo]?.takeIf { it.isNotBlank() } ?: BuildConfig.OLLAMA_MODEL,
        iaModo = p[K.iaModo] ?: "", iaListoId = p[K.iaListoId] ?: "",
        telemetria = p[K.telemetria] ?: true,
        serviceUrl = p[K.serviceUrl]?.takeIf { it.isNotBlank() } ?: BuildConfig.SERVICE_URL,
        installId = p[K.installId] ?: "",
        installEnviadaMs = p[K.installEnviada] ?: 0,
        installHash = p[K.installHash] ?: "",
        keepOverride = p[K.keep] ?: "", protegidos = p[K.protegidos] ?: "",
        escaneoModo = p[K.escaneoModo] ?: "", escaneoCantidad = p[K.escaneoCantidad] ?: 0,
        dureza = p[K.dureza] ?: -1, usarIa = p[K.usarIa] ?: true,
        cuentaLimpiar = p[K.cuentaLimpiar] ?: "",
        syncOrigen = p[K.syncOrigen] ?: "", syncDestino = p[K.syncDestino] ?: "",
        syncIncluir = p[K.syncIncluir] ?: "", syncExcluir = p[K.syncExcluir] ?: "",
        actualizarAuto = p[K.actualizarAuto] ?: true, actualizarUltimaMs = p[K.actualizarUltima] ?: 0,
        reglas = LibroReglas.leer(p[K.reglas]),
        filtroCompartir = p[K.filtroCompartir] ?: Defaults.instance.filtro.compartir,
    )

    /** Read once, synchronously, before the first frame: language and theme are applied before painting. */
    val inicial: Valores = runBlocking { read(ctx.nmtStore.data.first()) }

    private val scope0 = scope
    val valores: StateFlow<Valores> = ctx.nmtStore.data.map(::read).stateIn(scope, SharingStarted.Eagerly, inicial)

    private fun <T> Preferences.Key<T>.putOrRemove(p: androidx.datastore.preferences.core.MutablePreferences, v: T?) {
        if (v == null) p.remove(this) else p[this] = v
    }

    /** Fire-and-forget write (the flow republishes). */
    private fun edit(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        scope0.launch { ctx.nmtStore.edit { block(it) } }
    }

    /** Synchronous: the activity is recreated right after and must read the new language. */
    fun idioma(v: String) { runBlocking { ctx.nmtStore.edit { it[K.idioma] = v } } }

    /** Language straight from disk, for [android.content.ContextWrapper] before any flow has emitted. */
    fun idiomaGuardado(): String = runBlocking { read(ctx.nmtStore.data.first()).idioma }
    fun modo(m: Modo) = edit { it[K.modo] = m.id }
    fun acento(a: Acento) = edit { it[K.acento] = a.id }
    fun configurado(v: Boolean) = edit { it[K.configurado] = v }
    fun ollamaUrl(v: String) = edit { it[K.ollamaUrl] = v.trim() }
    fun ollamaModelo(v: String) = edit { it[K.ollamaModelo] = v.trim() }
    fun iaModo(v: String) = edit { it[K.iaModo] = v }
    fun iaListoId(v: String) = edit { it[K.iaListoId] = v }
    fun telemetria(v: Boolean) = edit { it[K.telemetria] = v }
    fun serviceUrl(v: String) = edit { it[K.serviceUrl] = v.trim() }
    fun keepOverride(v: String) = edit { it[K.keep] = v }
    fun protegidos(v: String) = edit { it[K.protegidos] = v }
    fun escaneo(modo: String, cantidad: Int) = edit { it[K.escaneoModo] = modo; it[K.escaneoCantidad] = cantidad }
    fun dureza(v: Int) = edit { it[K.dureza] = v.coerceIn(0, 100) }
    fun usarIa(v: Boolean) = edit { it[K.usarIa] = v }
    fun cuentaLimpiar(id: String) = edit { it[K.cuentaLimpiar] = id }
    fun sync(origen: String, destino: String, incluir: String, excluir: String) = edit {
        it[K.syncOrigen] = origen; it[K.syncDestino] = destino; it[K.syncIncluir] = incluir; it[K.syncExcluir] = excluir
    }
    fun actualizarAuto(v: Boolean) = edit { it[K.actualizarAuto] = v }
    fun filtroCompartir(v: Boolean) = edit { it[K.filtroCompartir] = v }

    /**
     * Saves rules (key -> delete / protect / none) with the date of now. One atomic step on the store,
     * so a sync that lands at the same moment cannot lose it. Returns when it is written.
     */
    fun reglasCambiar(cambios: Map<String, String>) {
        runBlocking {
            ctx.nmtStore.edit { p ->
                p[K.reglas] = LibroReglas.leer(p[K.reglas]).con(cambios, System.currentTimeMillis()).escribir()
            }
        }
    }

    /** Merges what the service has into the stored rules as one step; used by the sync. */
    @Synchronized
    fun reglasFusionar(remoto: Map<String, ReglaFecha>): Fusion = runBlocking {
        lateinit var f: Fusion
        ctx.nmtStore.edit { p ->
            f = SincronizadorReglas.fusionar(LibroReglas.leer(p[K.reglas]).entradas, remoto)
            p[K.reglas] = LibroReglas(f.resultado).escribir()
        }
        f
    }

    fun reglasEntradas(): Map<String, ReglaFecha> = runBlocking { LibroReglas.leer(ctx.nmtStore.data.first()[K.reglas]).entradas }

    /**
     * Before 1.6 «Nunca eliminar» wrote the address into the protected list. Those addresses become
     * «protect» rules (dated now, so they win over anything older) and leave the list; domains stay in it.
     */
    fun migrarReglas() {
        runBlocking {
            ctx.nmtStore.edit { p ->
                if (p[K.reglasMigradas] == true) return@edit
                val lista = (p[K.protegidos] ?: "").split('\n', ',', ';', ' ').map { it.trim() }.filter { it.isNotEmpty() }
                val correos = lista.filter { '@' in it && !it.startsWith("@") }.map { it.lowercase() }
                if (correos.isNotEmpty()) {
                    p[K.reglas] = LibroReglas.leer(p[K.reglas]).con(correos.associateWith { Reglas.PROTEGER }, System.currentTimeMillis()).escribir()
                    p[K.protegidos] = lista.filter { it.lowercase() !in correos }.joinToString("\n")
                }
                p[K.reglasMigradas] = true
            }
        }
    }
    fun actualizarUltima(ms: Long) = edit { it[K.actualizarUltima] = ms }
    fun installEnviada(ms: Long, hash: String) = edit { it[K.installEnviada] = ms; it[K.installHash] = hash }

    /** The install id is a UUID v4 made on the first launch and kept in the app data. */
    fun asegurarInstallId(): String {
        valores.value.installId.takeIf { it.isNotEmpty() }?.let { return it }
        val id = UUID.randomUUID().toString()
        runBlocking { ctx.nmtStore.edit { if (it[K.installId] == null) it[K.installId] = id } }
        return runBlocking { ctx.nmtStore.data.first()[K.installId] ?: id }
    }
}
