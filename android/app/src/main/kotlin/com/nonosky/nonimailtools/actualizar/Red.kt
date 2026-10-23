package com.nonosky.nonimailtools.actualizar

import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.ia.ProgresoDescarga
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/** Plain HttpURLConnection helpers for the updater (GitHub API and release assets). */
internal object Red {
    private const val MAX_TEXTO = 1_000_000

    private fun conexion(url: String, userAgent: String): HttpURLConnection {
        val c = URI(url).toURL().openConnection() as HttpURLConnection
        c.connectTimeout = BuildConfig.HTTP_TIMEOUT_MS
        c.readTimeout = 30_000
        c.instanceFollowRedirects = true
        c.setRequestProperty("User-Agent", userAgent)
        return c
    }

    /** GET [url] as text (small answers only: the release JSON and the checksums file). */
    fun texto(url: String, userAgent: String, aceptar: String? = null): String {
        val c = conexion(url, userAgent)
        try {
            if (aceptar != null) c.setRequestProperty("Accept", aceptar)
            val code = c.responseCode
            if (code !in 200..299) throw IOException("HTTP $code")
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            c.inputStream.use { ins ->
                while (true) {
                    val n = ins.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > MAX_TEXTO) throw IOException("answer too large")
                }
            }
            return out.toString(Charsets.UTF_8.name())
        } finally {
            c.disconnect()
        }
    }

    /** Opens [url] from byte [desde]. Returns the connection and the byte it really starts at. */
    fun abrir(url: String, userAgent: String, desde: Long): Pair<HttpURLConnection, Long> {
        val c = conexion(url, userAgent)
        if (desde > 0) c.setRequestProperty("Range", "bytes=$desde-")
        val code = c.responseCode
        if (code == 206 && ProgresoDescarga.parseContentRange(c.getHeaderField("Content-Range"))?.inicio == desde) return c to desde
        if (code == 200) return c to 0L
        c.disconnect()
        // 416 or a server that ignored Range: start over once.
        if (desde > 0 && (code == 206 || code == 416)) return abrir(url, userAgent, 0)
        throw IOException("HTTP $code")
    }
}
