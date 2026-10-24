package com.nonosky.nonimailtools.data

import android.content.Context
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.licencias.LicenseVerifier
import com.nonosky.nonimailtools.core.limpiar.Reputacion
import com.nonosky.nonimailtools.core.telemetria.Registro
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

/**
 * The collective sender reputation: downloaded once a day from the service, checked with the Ed25519
 * public key bundled with the app, kept on disk. A copy whose signature does not hold is ignored.
 */
class RepoReputacion(ctx: Context, private val ajustes: Ajustes, private val log: Registro) {
    private val archivo = File(ctx.filesDir, "filtro/reputacion.json")
    private val clave = LicenseVerifier.bundledPublicKey()
    private val cfg get() = Defaults.instance.filtro

    @Volatile private var doc: Reputacion? = null
    @Volatile private var bajadaMs = 0L

    init {
        runCatching {
            if (archivo.exists()) {
                val o = Json.parseToJsonElement(archivo.readText()).jsonObject
                val r = Reputacion.leer(o.getValue("doc").toString(), clave)
                if (r != null) { doc = r; bajadaMs = (o["bajadaMs"] as? JsonPrimitive)?.contentOrNull?.toLongOrNull() ?: 0L }
            }
        }
    }

    /** The reputation to use in a scan, or null when the layer is off or nothing valid was downloaded yet. */
    fun actual(): Reputacion? = if (cfg.reputacion) doc else null

    fun vencida() = doc == null || System.currentTimeMillis() - bajadaMs >= cfg.intervalMs

    /** Downloads when the copy is older than a day. Blocking; never throws. */
    fun actualizarSiVencida() { if (cfg.reputacion && ajustes.valores.value.configurado && vencida()) actualizar() }

    @Synchronized
    fun actualizar(): Boolean = try {
        val url = URI(ajustes.valores.value.serviceUrl.trimEnd('/') + cfg.reputacionPath).toURL()
        val c = url.openConnection() as HttpURLConnection
        try {
            c.connectTimeout = cfg.timeoutMs; c.readTimeout = cfg.timeoutMs
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("User-Agent", "NoniMailTools/${BuildConfig.VERSION_NAME} (android)")
            if (c.responseCode !in 200..299) { log.w("filtro", "Reputation: answer ${c.responseCode}"); false }
            else {
                val texto = c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                val r = Reputacion.leer(texto, clave)
                if (r == null) { log.w("filtro", "Reputation ignored: invalid signature"); false }
                else {
                    doc = r; bajadaMs = System.currentTimeMillis()
                    runCatching {
                        archivo.parentFile?.mkdirs()
                        archivo.writeText(buildJsonObject { put("bajadaMs", bajadaMs.toString()); put("doc", Json.parseToJsonElement(texto)) }.toString())
                    }
                    log.i("filtro", "Reputation updated (${r.tamano} domains)")
                    true
                }
            }
        } finally { c.disconnect() }
    } catch (e: Exception) {
        log.w("filtro", "Reputation not downloaded (${e.javaClass.simpleName})")
        false
    }
}
