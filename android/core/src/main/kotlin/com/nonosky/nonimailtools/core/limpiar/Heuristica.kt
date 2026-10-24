package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.HeuristicPatterns
import com.nonosky.nonimailtools.core.ScoreLevels

/** Why a sender got its score. */
enum class Reason { PROTEGIDO_USUARIO, CONTACTO, PROTEGIDO, PROMOCION, MASIVO_AUTOMATICO, MASIVO, AUTOMATICO, PERSONA, IA, REPUTACION }

/** Where a sender lands for a given hardness. */
enum class Decision { LIMPIAR, DUDA, CONSERVAR }

/** Compiled heuristic patterns. A blank pattern never matches (an empty regex would match everything). */
class Rules(val keep: Regex?, val subject: Regex?, val from: Regex?, val body: Regex?) {
    companion object {
        /** Throws [IllegalArgumentException] when a pattern does not compile. */
        fun compile(p: HeuristicPatterns): Rules =
            Rules(pattern(p.keepOverride), pattern(p.subject), pattern(p.from), pattern(p.body))

        fun pattern(src: String?): Regex? {
            val s = (src ?: "").trim()
            if (s.isEmpty()) return null
            return try {
                Regex(s, RegexOption.IGNORE_CASE)
            } catch (e: java.util.regex.PatternSyntaxException) {
                throw IllegalArgumentException(e.description, e)
            }
        }

        /** True when [src] compiles (or is blank). */
        fun isValid(src: String?): Boolean = runCatching { pattern(src) }.isSuccess
    }
}

object Heuristica {

    /** Domain (after the last @), lower case. */
    fun dominioDe(email: String): String {
        val e = email.trim().lowercase()
        return if ('@' in e) e.substringAfterLast('@') else ""
    }

    /**
     * True when [email] is in the user's protected list. Entries are full addresses or
     * domains (a domain also covers its subdomains).
     */
    fun inProtectedList(email: String, protectedList: Collection<String>): Boolean {
        val e = email.trim().lowercase()
        if (e.isEmpty()) return false
        val d = dominioDe(e)
        for (raw in protectedList) {
            val p = raw.trim().lowercase().removePrefix("@").removePrefix(".")
            if (p.isEmpty()) continue
            if ('@' in p) { if (p == e) return true; continue }
            if (d.isNotEmpty() && (d == p || d.endsWith(".$p"))) return true
        }
        return false
    }

    /** Protection by rule: user list, or the keep-override regex on sender or subject. */
    fun isProtected(email: String, name: String, subject: String?, protectedList: Collection<String>, rules: Rules): Boolean {
        if (inProtectedList(email, protectedList)) return true
        val keep = rules.keep ?: return false
        return keep.containsMatchIn("$name <$email>") || (subject != null && keep.containsMatchIn(subject))
    }

    /**
     * Noise score 0–100 for one sender (100 = surely noise). First matching rule wins;
     * the bias is always towards keeping.
     */
    fun score(
        email: String,
        name: String,
        subjects: List<String>,
        bulk: Boolean,
        contacts: Set<String>,
        protectedList: Collection<String>,
        rules: Rules,
        levels: ScoreLevels,
    ): Pair<Int, Reason> {
        val e = email.trim().lowercase()
        val subs = subjects.filter { it.isNotBlank() }
        val sender = "$name <$e>"
        if (inProtectedList(e, protectedList)) return levels.protected to Reason.PROTEGIDO_USUARIO
        if (e.isNotEmpty() && e in contacts) return levels.contact to Reason.CONTACTO
        val keep = rules.keep
        if (keep != null && (keep.containsMatchIn(sender) || subs.any { keep.containsMatchIn(it) })) {
            return levels.protected to Reason.PROTEGIDO
        }
        if (rules.subject != null && subs.any { rules.subject.containsMatchIn(it) }) return levels.promo to Reason.PROMOCION
        val automatic = rules.from?.containsMatchIn(sender) == true
        return when {
            automatic && bulk -> levels.automaticBulk to Reason.MASIVO_AUTOMATICO
            bulk -> levels.bulk to Reason.MASIVO
            automatic -> levels.automatic to Reason.AUTOMATICO
            else -> levels.person to Reason.PERSONA
        }
    }

    /** Selection threshold for a hardness: senders scoring at or above it are cleaned. */
    fun cutLine(hardness: Int, band: Int): Int = (100 - hardness.coerceIn(0, 100)) + band

    /** Score against hardness: clean only what is clear, the middle stays in doubt. */
    fun decide(score: Int, hardness: Int, band: Int): Decision {
        val t = 100 - hardness.coerceIn(0, 100)
        return when {
            score >= t + band -> Decision.LIMPIAR
            score <= t - band -> Decision.CONSERVAR
            else -> Decision.DUDA
        }
    }

    /** Bulk mail signals from List-* / Precedence headers. */
    fun bulkSignals(listUnsubscribe: String?, listId: String?, precedence: String?): Pair<Boolean, Boolean> {
        val unsub = !listUnsubscribe.isNullOrBlank()
        val list = !listId.isNullOrBlank()
        val prec = precedence?.trim()?.lowercase() in setOf("bulk", "list", "junk")
        return unsub to (unsub || list || prec)
    }
}
