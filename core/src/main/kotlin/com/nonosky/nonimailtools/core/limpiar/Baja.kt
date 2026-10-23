package com.nonosky.nonimailtools.core.limpiar

import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.URL

/** Result of one unsubscribe: [metodo] = "one-click", "enlace" or "correo"; [error] when nothing worked. */
data class ResultadoBaja(val ok: Boolean, val metodo: String = "", val error: String = "")

/** Sends the unsubscribe e-mail of a `mailto:` link; null if it went out, else the error. */
fun interface EnviadorCorreo {
    fun enviar(para: String, asunto: String, cuerpo: String): String?
}

/**
 * List-Unsubscribe, same order as the desktop app: one-click POST (RFC 8058), then the mailto
 * e-mail, then a plain GET of the link. Links are written by the sender, so only https and never
 * towards the local network (a malicious mail must not make the phone visit the router).
 */
object Baja {
    private val ENTRE_ANGULOS = Regex("<([^>]+)>")

    data class Enlaces(val https: String?, val mailto: String?)

    fun enlaces(listUnsubscribe: String?): Enlaces {
        val urls = ENTRE_ANGULOS.findAll(listUnsubscribe.orEmpty()).map { it.groupValues[1].trim() }.toList()
        return Enlaces(urls.firstOrNull { it.startsWith("https:", true) }, urls.firstOrNull { it.startsWith("mailto:", true) })
    }

    fun esHostPrivado(host: String): Boolean {
        val h = host.trim('[', ']').lowercase()
        if (h == "localhost" || Regex("\\.(local|localhost|lan|internal|home|corp)$").containsMatchIn(h)) return true
        if ('.' !in h && ':' !in h) return true
        val ip = if (Regex("^[0-9.]+$").matches(h) || ':' in h) runCatching { InetAddress.getByName(h) }.getOrNull() else null
        return ip != null && esIpPrivada(ip)
    }

    private fun esIpPrivada(a: InetAddress): Boolean = when (a) {
        is Inet4Address -> a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress || a.isAnyLocalAddress ||
            (a.address[0].toInt() and 0xff) == 100 && (a.address[1].toInt() and 0xff) in 64..127
        is Inet6Address -> a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress || a.isAnyLocalAddress ||
            (a.address[0].toInt() and 0xfe) == 0xfc
        else -> true
    }

    /** The name is not enough: a public domain can resolve to a LAN address. */
    private fun resuelvePublico(host: String): Boolean = runCatching {
        val all = InetAddress.getAllByName(host.trim('[', ']'))
        all.isNotEmpty() && all.none(::esIpPrivada)
    }.getOrDefault(false)

    fun httpsSeguro(url: String): Boolean = runCatching {
        val u = URI(url)
        u.scheme.equals("https", true) && !u.host.isNullOrBlank() && !esHostPrivado(u.host)
    }.getOrDefault(false)

    /** Follows redirects by hand, checking every hop. Returns null when the server accepted. */
    private fun pedir(url: String, post: Boolean, timeoutMs: Int, maxSaltos: Int): String? {
        var actual = url
        var esPost = post
        repeat(maxSaltos) {
            val u = runCatching { URL(actual) }.getOrNull() ?: return "enlace inválido"
            if (!httpsSeguro(actual) || !resuelvePublico(u.host)) return "servidor no permitido (${u.host})"
            val c = (u.openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = timeoutMs; readTimeout = timeoutMs
                requestMethod = if (esPost) "POST" else "GET"
            }
            try {
                if (esPost) {
                    c.doOutput = true
                    c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                    c.outputStream.use { it.write("List-Unsubscribe=One-Click".toByteArray()) }
                }
                val st = c.responseCode
                val loc = c.getHeaderField("Location")
                if (st in 300..399 && loc != null) { actual = URL(u, loc).toString(); esPost = false; return@repeat }
                return if (st < 400) null else "HTTP $st"
            } catch (e: Exception) {
                return e.message ?: e.javaClass.simpleName
            } finally {
                c.disconnect()
            }
        }
        return "demasiadas redirecciones"
    }

    /** `mailto:a@b?subject=x&body=y` → (to, subject, body), or null. */
    fun mailto(m: String): Triple<String, String, String>? = runCatching {
        val sin = m.substringAfter(':')
        val para = java.net.URLDecoder.decode(sin.substringBefore('?'), "UTF-8").trim()
        if ('@' !in para) return null
        val q = sin.substringAfter('?', "").split('&').mapNotNull {
            val k = it.substringBefore('=').lowercase(); val v = it.substringAfter('=', "")
            if (k.isEmpty()) null else k to java.net.URLDecoder.decode(v, "UTF-8")
        }.toMap()
        Triple(para, q["subject"] ?: "unsubscribe", q["body"] ?: "unsubscribe")
    }.getOrNull()

    fun ejecutar(listUnsubscribe: String?, listUnsubscribePost: String?, correo: EnviadorCorreo?, timeoutMs: Int = 20_000, maxSaltos: Int = 5): ResultadoBaja {
        if (listUnsubscribe.isNullOrBlank()) return ResultadoBaja(false, error = "sin enlace de baja")
        val (https, mailto) = enlaces(listUnsubscribe)
        val errores = ArrayList<String>()
        val unClic = Regex("one-?click", RegexOption.IGNORE_CASE).containsMatchIn(listUnsubscribePost.orEmpty())
        val okHttps = https != null && httpsSeguro(https)
        if (https != null && !okHttps) errores += "enlace no seguro"
        if (okHttps && unClic) {
            pedir(https!!, true, timeoutMs, maxSaltos)?.let { errores += "one-click: $it" } ?: return ResultadoBaja(true, "one-click")
        }
        if (mailto != null) {
            val m = mailto(mailto)
            when {
                correo == null -> errores += "sin envío de correo"
                m == null -> errores += "mailto inválido"
                else -> correo.enviar(m.first, m.second, m.third)?.let { errores += "correo: $it" } ?: return ResultadoBaja(true, "correo")
            }
        }
        if (okHttps && !unClic) {
            pedir(https!!, false, timeoutMs, maxSaltos)?.let { errores += it } ?: return ResultadoBaja(true, "enlace")
        }
        return ResultadoBaja(false, error = errores.joinToString(" · ").ifEmpty { "nada utilizable" })
    }
}
