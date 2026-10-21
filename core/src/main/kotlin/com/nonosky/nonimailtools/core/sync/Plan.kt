package com.nonosky.nonimailtools.core.sync

import com.nonosky.nonimailtools.core.mail.FolderMeta

/** One source folder and where it lands in the destination. */
data class FolderMapping(val source: String, val dest: String, val destDelimiter: Char?, val special: String, val merged: Boolean)

/** Folder planning of the sync, pure so it can be tested without a server. */
object Plan {
    /** Virtual folders (RFC 6154): their messages already live in other folders. */
    val VIRTUAL_USES = setOf("\\important", "\\flagged")

    /** "All Mail" holds everything, archived mail included: processed last, copying only what lives nowhere else. */
    const val ALL_USE = "\\all"

    /** Special folders merged with the destination's equivalent. */
    val MAPPABLE_USES = setOf("\\sent", "\\trash", "\\drafts", "\\junk", "\\archive", ALL_USE)

    /** Flags that cannot (and must not) be set with APPEND. */
    val UNSETTABLE_FLAGS = setOf("\\recent")

    /**
     * Drops virtual folders (unless explicitly included), puts "All" last, then applies the
     * include list (when not empty) and the exclude list. Names compare case-insensitively.
     */
    fun sourceFolders(metas: List<FolderMeta>, include: Set<String>, exclude: Set<String>, log: (String) -> Unit = {}): List<FolderMeta> {
        val inc = include.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
        val exc = exclude.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
        val normal = ArrayList<FolderMeta>()
        val all = ArrayList<FolderMeta>()
        for (f in metas) {
            if (f.special in VIRTUAL_USES && f.name.lowercase() !in inc) {
                log("[${f.name}] skipped: virtual folder (${f.special})")
                continue
            }
            (if (f.special == ALL_USE) all else normal) += f
        }
        return (normal + all).filter { (inc.isEmpty() || it.name.lowercase() in inc) && it.name.lowercase() !in exc }
    }

    fun translateName(name: String, srcDelim: Char?, dstDelim: Char?): String {
        if (name.equals("INBOX", ignoreCase = true)) return "INBOX"
        if (srcDelim != null && dstDelim != null && srcDelim != dstDelim) return name.split(srcDelim).joinToString(dstDelim.toString())
        return name
    }

    /** Adds the personal-namespace prefix (e.g. "INBOX.") when missing, like the reference engine. */
    fun withNamespace(path: String, prefix: String): String {
        if (path.equals("INBOX", ignoreCase = true)) return "INBOX"
        return if (prefix.isNotEmpty() && !path.startsWith(prefix)) prefix + path else path
    }

    /** First destination folder per special use. */
    fun destSpecials(dst: List<FolderMeta>): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for (f in dst) if (f.special in MAPPABLE_USES && f.special !in out) out[f.special] = f.name
        return out
    }

    fun destDelimiter(dst: List<FolderMeta>, namespaceSeparator: Char?): Char =
        dst.firstOrNull { it.delimiter != null }?.delimiter ?: namespaceSeparator ?: '/'

    fun mapping(src: List<FolderMeta>, dst: List<FolderMeta>, nsPrefix: String, namespaceSeparator: Char?, log: (String) -> Unit = {}): List<FolderMapping> {
        val dstDelim = destDelimiter(dst, namespaceSeparator)
        val specials = destSpecials(dst)
        return src.map { f ->
            val special = specials[f.special]
            if (special != null) {
                if (special != f.name) log("[${f.name}] merged into '$special' (${f.special})")
                FolderMapping(f.name, special, dstDelim, f.special, merged = special != f.name)
            } else {
                FolderMapping(f.name, withNamespace(translateName(f.name, f.delimiter, dstDelim), nsPrefix), dstDelim, f.special, merged = false)
            }
        }
    }

    /** Parent paths to create before [name] (and [name] itself), in order. */
    fun pathsToCreate(name: String, delimiter: Char?): List<String> {
        if (name.equals("INBOX", ignoreCase = true)) return emptyList()
        if (delimiter == null || delimiter !in name) return listOf(name)
        val out = ArrayList<String>()
        var acc = ""
        for (part in name.split(delimiter)) {
            acc = if (acc.isEmpty()) part else "$acc$delimiter$part"
            if (!acc.equals("INBOX", ignoreCase = true)) out += acc
        }
        return out
    }

    fun cleanFlags(flags: List<String>): List<String> = flags.filter { it.lowercase() !in UNSETTABLE_FLAGS }
}
