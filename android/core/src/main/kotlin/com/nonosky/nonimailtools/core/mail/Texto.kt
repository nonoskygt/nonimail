package com.nonosky.nonimailtools.core.mail

import javax.mail.Multipart
import javax.mail.Part

object Texto {
    private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ")
    private val SCRIPT_STYLE = Regex("<(script|style|head)[\\s\\S]*?</\\1>", RegexOption.IGNORE_CASE)
    private val BREAKS = Regex("<br\\s*/?>|</(p|div|tr|li|h\\d)>", RegexOption.IGNORE_CASE)
    private val TAGS = Regex("<[^>]+>")
    private val ENTITY = Regex("&(#\\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);")
    private val SPACES = Regex("[ \\t\\r\\f\\u000B]+")
    private val NEWLINES = Regex("\\s*\\n\\s*")

    /** HTML → plain text, same steps as the desktop cleaner. */
    fun htmlToText(html: String?): String {
        var s = (html ?: "").replace(SCRIPT_STYLE, " ").replace(BREAKS, "\n").replace(TAGS, " ")
        s = ENTITY.replace(s) { m ->
            val e = m.groupValues[1]
            if (e.startsWith("#")) {
                val n = if (e.length > 1 && (e[1] == 'x' || e[1] == 'X')) e.drop(2).toIntOrNull(16) else e.drop(1).toIntOrNull()
                if (n != null && Character.isValidCodePoint(n)) String(Character.toChars(n)) else m.value
            } else {
                ENTITIES[e.lowercase()] ?: m.value
            }
        }
        return s.replace(SPACES, " ").replace(NEWLINES, "\n").trim()
    }

    /** First text/plain part (or text/html converted), cut to [maxChars]. Never throws. */
    fun bodySample(part: Part, maxChars: Int): String = runCatching {
        val plain = findPart(part, "text/plain")
        val text = if (plain != null) (plain.content as? String).orEmpty()
        else htmlToText((findPart(part, "text/html")?.content as? String).orEmpty())
        text.replace(Regex("\\s+"), " ").trim().take(maxChars)
    }.getOrDefault("")

    private fun findPart(p: Part, mime: String, depth: Int = 0): Part? {
        if (depth > 6) return null
        if (p.isMimeType(mime) && !Part.ATTACHMENT.equals(p.disposition, ignoreCase = true)) return p
        if (p.isMimeType("multipart/*")) {
            val mp = p.content as? Multipart ?: return null
            for (i in 0 until mp.count) findPart(mp.getBodyPart(i), mime, depth + 1)?.let { return it }
        }
        return null
    }
}
