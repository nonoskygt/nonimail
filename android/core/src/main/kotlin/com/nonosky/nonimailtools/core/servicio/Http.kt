package com.nonosky.nonimailtools.core.servicio

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/** One answer of the web service: status and raw body (null when there is none). */
data class RespuestaHttp(val status: Int, val cuerpo: String?) {
    val ok: Boolean get() = status in 200..299
}

/**
 * How the clients of the service talk HTTP. Injected so the clients can be tested without a network.
 * Throws [IOException] when there is no answer at all (no network, DNS, timeout).
 */
fun interface Transporte {
    fun pedir(metodo: String, url: String, cuerpo: String?, token: String?, timeoutMs: Int): RespuestaHttp
}

/** [Transporte] over [HttpURLConnection] (blocking: never on the main thread). */
object TransporteUrl : Transporte {
    private const val MAX = 2_000_000

    override fun pedir(metodo: String, url: String, cuerpo: String?, token: String?, timeoutMs: Int): RespuestaHttp {
        val c = URI(url).toURL().openConnection() as HttpURLConnection
        try {
            // Android's HttpURLConnection (OkHttp inside) accepts PATCH; the plain JVM one does not.
            try { c.requestMethod = metodo } catch (e: java.net.ProtocolException) {
                c.requestMethod = "POST"; c.setRequestProperty("X-HTTP-Method-Override", metodo)
            }
            c.connectTimeout = minOf(timeoutMs, 15_000)
            c.readTimeout = timeoutMs
            c.setRequestProperty("Accept", "application/json")
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            if (cuerpo != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                c.outputStream.use { it.write(cuerpo.toByteArray(Charsets.UTF_8)) }
            }
            val st = c.responseCode
            val txt = runCatching {
                (if (st < 400) c.inputStream else c.errorStream)?.use { ins ->
                    val b = ins.readBytes()
                    if (b.size > MAX) throw IOException("answer too large")
                    b.toString(Charsets.UTF_8)
                }
            }.getOrNull()
            return RespuestaHttp(st, txt)
        } finally {
            c.disconnect()
        }
    }

    /** `base` without the trailing slash + `ruta`. */
    fun url(base: String, ruta: String): String = base.trim().trimEnd('/') + ruta
}
