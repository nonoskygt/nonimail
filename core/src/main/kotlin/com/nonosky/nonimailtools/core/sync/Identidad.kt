package com.nonosky.nonimailtools.core.sync

import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Message identity, as in the reference engine:
 *  1. normalized Message-ID → `mid:<...>`;
 *  2. without one → `h:` + sha1(date ISO, from, to, subject, size).
 * Folders are compared as multisets of identities, so legitimate duplicates survive.
 */
object Identidad {

    fun normMessageId(raw: String?): String {
        var s = raw?.trim().orEmpty()
        if (s.isEmpty()) return ""
        if (!s.startsWith("<")) s = "<$s"
        if (!s.endsWith(">")) s = "$s>"
        return s
    }

    /** Lower-case addresses, sorted, comma-joined. */
    fun addrRepr(addresses: List<String>): String =
        addresses.map { it.trim().lowercase() }.sorted().joinToString(",")

    /** ISO-8601 in UTC with milliseconds, like JavaScript's `Date.toISOString()`. */
    fun isoDate(d: Date?): String {
        if (d == null) return ""
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(d)
    }

    fun of(messageId: String?, date: Date?, from: List<String>, to: List<String>, subject: String?, size: Long): String {
        val mid = normMessageId(messageId)
        if (mid.isNotEmpty()) return "mid:$mid"
        val basis = listOf(isoDate(date), addrRepr(from), addrRepr(to), subject?.trim().orEmpty(), size.toString())
            .joinToString("\u001f")
        val sha = MessageDigest.getInstance("SHA-1").digest(basis.toByteArray(Charsets.UTF_8))
        return "h:" + sha.joinToString("") { "%02x".format(it) }
    }
}

/** Counting multiset of identities. */
class Multiset(initial: Map<String, Int> = emptyMap()) {
    private val counts = HashMap<String, Int>(initial)

    fun add(id: String, n: Int = 1) {
        if (n > 0) counts[id] = (counts[id] ?: 0) + n
    }

    /** Consumes one unit of [id]; true when there was one. */
    fun take(id: String): Boolean {
        val n = counts[id] ?: 0
        if (n <= 0) return false
        if (n == 1) counts.remove(id) else counts[id] = n - 1
        return true
    }

    fun count(id: String): Int = counts[id] ?: 0
    fun size(): Int = counts.values.sum()
    fun entries(): Map<String, Int> = counts.toMap()
    fun copy(): Multiset = Multiset(counts)

    /** Removes up to the counts in [other] (multiset difference, in place). */
    fun subtract(other: Multiset) {
        for ((id, n) in other.counts) {
            val have = counts[id] ?: continue
            val left = have - n
            if (left > 0) counts[id] = left else counts.remove(id)
        }
    }

    companion object {
        fun of(ids: Iterable<String>): Multiset = Multiset().also { m -> ids.forEach { m.add(it) } }
    }
}

/** Per-folder dedupe and verification arithmetic, kept pure for tests. */
object Dedupe {
    /**
     * Splits [source] identities into (already in destination, to copy), consuming the
     * destination multiset so N copies in the source need N in the destination.
     */
    fun <T> plan(source: List<T>, identity: (T) -> String, destination: Multiset): Pair<Int, List<T>> {
        val dest = destination.copy()
        var existing = 0
        val toCopy = ArrayList<T>()
        for (m in source) if (dest.take(identity(m))) existing++ else toCopy += m
        return existing to toCopy
    }

    /** Drops from [source] the identities in [skip] (what travels with another folder). */
    fun <T> skip(source: List<T>, identity: (T) -> String, skip: Multiset): List<T> {
        val pending = skip.copy()
        return source.filterNot { pending.take(identity(it)) }
    }

    data class Check(val sourceCount: Int, val destCount: Int, val matched: Int, val missing: Int, val samples: List<String>)

    /** source ⊆ destination as multisets. */
    fun verify(source: Multiset, destination: Multiset, maxSamples: Int = 20): Check {
        var missing = 0
        var matched = 0
        val samples = ArrayList<String>()
        for ((id, n) in source.entries()) {
            val have = destination.count(id)
            matched += minOf(n, have)
            if (have < n) {
                missing += n - have
                if (samples.size < maxSamples) samples += "$id x${n - have}"
            }
        }
        return Check(source.size(), destination.size(), matched, missing, samples)
    }
}
