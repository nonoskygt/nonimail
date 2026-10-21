package com.nonosky.nonimailtools.core.sync

import com.nonosky.nonimailtools.core.Reporter
import com.nonosky.nonimailtools.core.SyncDefaults
import com.nonosky.nonimailtools.core.mail.ImapAccount
import com.nonosky.nonimailtools.core.mail.ImapConnection
import com.nonosky.nonimailtools.core.mail.ImapTimeouts
import com.nonosky.nonimailtools.core.mail.MessageMeta
import com.nonosky.nonimailtools.core.mail.addressOf
import com.nonosky.nonimailtools.core.mail.append
import com.nonosky.nonimailtools.core.mail.fetchMeta
import com.nonosky.nonimailtools.core.mail.fetchRaw
import com.nonosky.nonimailtools.core.mail.isConnectionLoss
import com.nonosky.nonimailtools.core.mail.uidSearch
import kotlinx.serialization.Serializable
import java.util.Date
import javax.mail.Flags
import javax.mail.Folder

data class SyncOptions(
    val dryRun: Boolean = true,
    val include: Set<String> = emptySet(),
    val exclude: Set<String> = emptySet(),
    /** 0 = no limit. */
    val maxBytes: Long = 0,
)

@Serializable
data class FolderResult(
    val source: String,
    val dest: String,
    var sourceCount: Int = 0,
    var existing: Int = 0,
    var toCopy: Int = 0,
    var copied: Int = 0,
    var errors: Int = 0,
    var bytes: Long = 0,
    val errorSamples: MutableList<String> = mutableListOf(),
)

@Serializable
data class VerifyFolder(val folder: String, val sourceCount: Int, val destCount: Int, val matched: Int, val missing: Int)

@Serializable
data class Verification(val ok: Boolean, val missing: Int, val folders: List<VerifyFolder>)

@Serializable
data class SyncTotals(val source: Int = 0, val existing: Int = 0, val toCopy: Int = 0, val copied: Int = 0, val errors: Int = 0, val bytes: Long = 0)

@Serializable
data class SyncResult(
    val ok: Boolean,
    val dryRun: Boolean,
    val cancelled: Boolean,
    val overLimit: Boolean,
    val error: String?,
    /** [com.nonosky.nonimailtools.core.mail.ImapException.Reason] name when the error has one. */
    val errorReason: String? = null,
    val durationMs: Long,
    val folders: List<FolderResult>,
    val totals: SyncTotals,
    val verification: Verification?,
)

/** Progress snapshot for the notification and the screen. */
data class SyncProgress(
    val phase: Phase,
    val folder: String = "",
    val foldersDone: Int = 0,
    val foldersTotal: Int = 0,
    val folderCopied: Int = 0,
    val folderToCopy: Int = 0,
    val indexed: Int = 0,
    val copied: Int = 0,
    val bytes: Long = 0,
    val messagesTotal: Int = 0,
) {
    enum class Phase { CONNECTING, PLANNING, INDEXING, COPYING, VERIFYING, DONE }

    /** 0..1 overall, by folders plus the fraction of the current one. */
    val fraction: Float
        get() {
            if (foldersTotal <= 0) return 0f
            val inFolder = if (folderToCopy > 0) folderCopied.toFloat() / folderToCopy else 0f
            return ((foldersDone + inFolder) / foldersTotal).coerceIn(0f, 1f)
        }
}

private class Meta(val uid: Long, val identity: String, val size: Long, val flags: Flags?, val internalDate: Date?)

/**
 * IMAP → IMAP copy (faithful port of the reference engine in `nonimail-saas/src/sync/engine.js`).
 * Copies from SOURCE to DESTINATION everything that is missing, never touching the source:
 *  1. connect both sides (TLS verified);
 *  2. list source folders, drop Gmail's virtual ones, keep "All" last;
 *  3. per folder: index both sides by identity (multiset) and copy only what is missing,
 *     keeping flags and INTERNALDATE;
 *  4. verify end to end on fresh connections: source ⊆ destination per folder.
 */
class SyncEngine(private val timeouts: ImapTimeouts, private val cfg: SyncDefaults) {

    private class Ctx(
        val reporter: Reporter<SyncProgress>,
        val dryRun: Boolean,
        val maxBytes: Long,
        var transferred: Long = 0,
        var overLimit: Boolean = false,
        val skipIds: MutableMap<String, Multiset> = HashMap(),
        val dstPaths: MutableSet<String> = HashSet(),
        var progress: SyncProgress = SyncProgress(SyncProgress.Phase.CONNECTING),
    ) {
        fun log(s: String) { runCatching { reporter.log(s) } }
        fun emit(p: SyncProgress) { progress = p; runCatching { reporter.progress(p) } }
        fun cancelled(): Boolean = runCatching { reporter.cancelled() }.getOrDefault(false)
    }

    fun run(origen: ImapAccount, destino: ImapAccount, options: SyncOptions, reporter: Reporter<SyncProgress>): SyncResult {
        val t0 = System.currentTimeMillis()
        val ctx = Ctx(reporter, options.dryRun, maxOf(0, options.maxBytes))
        val folders = ArrayList<FolderResult>()
        var cancelled = false
        var error: String? = null
        var errorReason: String? = null
        var verification: Verification? = null
        try {
            var mapping: List<FolderMapping>
            ImapConnection.open(origen, timeouts).use { source ->
                ImapConnection.open(destino, timeouts).use { dest ->
                    ctx.emit(SyncProgress(SyncProgress.Phase.PLANNING))
                    val srcFolders = Plan.sourceFolders(source.listFolders(), options.include, options.exclude, ctx::log)
                    val dstMeta = dest.listFolders()
                    ctx.dstPaths += dstMeta.map { it.name }
                    val ns = runCatching { dest.store.personalNamespaces.firstOrNull() }.getOrNull()
                    val nsSep = runCatching { ns?.separator }.getOrNull()?.takeIf { it != '\u0000' }
                    val nsPrefix = ns?.fullName?.takeIf { it.isNotEmpty() }?.let { it + (nsSep ?: "") } ?: ""
                    mapping = Plan.mapping(srcFolders, dstMeta, nsPrefix, nsSep, ctx::log)

                    val total = srcFolders.sumOf { f -> runCatching { source.folder(f.name).messageCount }.getOrDefault(0).coerceAtLeast(0) }
                    for (f in srcFolders) if (f.special == Plan.ALL_USE && srcFolders.size > 1) {
                        // What lives in another source folder already travels with that folder.
                        val others = Multiset()
                        for (o in srcFolders) {
                            if (o.name == f.name || o.special == Plan.ALL_USE) continue
                            if (ctx.cancelled()) break
                            index(source, o.name, ctx).forEach { others.add(it.identity) }
                        }
                        ctx.skipIds[f.name] = others
                    }

                    ctx.log("Folders to process: ${mapping.size}")
                    var base = SyncProgress(SyncProgress.Phase.INDEXING, foldersTotal = mapping.size, messagesTotal = total)
                    for ((i, m) in mapping.withIndex()) {
                        if (ctx.cancelled()) { cancelled = true; break }
                        base = base.copy(phase = SyncProgress.Phase.INDEXING, folder = m.source, foldersDone = i, folderCopied = 0, folderToCopy = 0)
                        ctx.emit(base)
                        if (!ctx.dryRun) ensureDestFolder(dest, m.dest, m.destDelimiter, ctx)
                        val r = copyFolder(ctx, source, dest, m.source, m.dest, base)
                        folders += r
                        base = ctx.progress.copy(foldersDone = i + 1)
                        ctx.emit(base)
                        if (ctx.overLimit) break
                    }
                }
            }
            if (ctx.cancelled()) cancelled = true
            if (!cancelled) {
                ctx.emit(ctx.progress.copy(phase = SyncProgress.Phase.VERIFYING))
                verification = verify(ctx, origen, destino, folders.map { it.source to it.dest })
                val v = verification
                ctx.log(
                    "Verification: " + when {
                        v.ok -> "OK (source ⊆ destination)"
                        ctx.dryRun -> "${v.missing} messages missing in destination (simulation: nothing copied)"
                        else -> "FAILED, ${v.missing} missing"
                    },
                )
            }
        } catch (e: Exception) {
            error = e.message ?: e.javaClass.simpleName
            errorReason = (e as? com.nonosky.nonimailtools.core.mail.ImapException)?.reason?.name
                ?: if (e.isConnectionLoss()) com.nonosky.nonimailtools.core.mail.ImapException.Reason.CONNECT.name else null
            ctx.log("Engine error: $error")
        } finally {
            ctx.emit(ctx.progress.copy(phase = SyncProgress.Phase.DONE))
        }
        val totals = SyncTotals(
            source = folders.sumOf { it.sourceCount },
            existing = folders.sumOf { it.existing },
            toCopy = folders.sumOf { it.toCopy },
            copied = folders.sumOf { it.copied },
            errors = folders.sumOf { it.errors },
            bytes = folders.sumOf { it.bytes },
        )
        val ok = error == null && !cancelled && !ctx.overLimit && (ctx.dryRun || verification?.ok == true)
        val result = SyncResult(ok, ctx.dryRun, cancelled, ctx.overLimit, error, errorReason, System.currentTimeMillis() - t0, folders, totals, verification)
        ctx.log("Done in ${result.durationMs / 1000}s — folders=${folders.size} source=${totals.source} copied=${totals.copied} errors=${totals.errors} bytes=${totals.bytes}" +
            (if (result.dryRun) " SIMULATION" else "") + (if (cancelled) " CANCELLED" else "") + (if (ctx.overLimit) " LIMIT" else ""))
        return result
    }

    /** UID SEARCH ALL, then envelope FETCH in UID batches. The folder is closed afterwards. */
    private fun index(conn: ImapConnection, name: String, ctx: Ctx): List<Meta> {
        val folder = conn.openReadOnly(name)
        try {
            val uids = folder.uidSearch("ALL")
            val out = ArrayList<Meta>(uids.size)
            for (chunk in uids.chunked(cfg.fetchBatch)) {
                for (m in folder.fetchMeta(chunk)) out += toMeta(m)
                ctx.emit(ctx.progress.copy(indexed = ctx.progress.indexed + chunk.size))
            }
            return out.distinctBy { it.uid }.sortedBy { it.uid }
        } finally {
            runCatching { folder.close(false) }
        }
    }

    private fun toMeta(m: MessageMeta) = Meta(
        uid = m.uid,
        identity = Identidad.of(m.messageId, m.date, m.from.map(::addressOf), m.to.map(::addressOf), m.subject, m.size),
        size = m.size,
        flags = m.flags,
        internalDate = m.internalDate,
    )

    private fun exists(conn: ImapConnection, name: String, ctx: Ctx): Boolean =
        name.equals("INBOX", ignoreCase = true) || name in ctx.dstPaths

    private fun destCounter(dest: ImapConnection, name: String, ctx: Ctx): Multiset =
        if (!exists(dest, name, ctx)) Multiset() else Multiset.of(index(dest, name, ctx).map { it.identity })

    /** Creates [name] (and its parents) in the destination when missing. */
    private fun ensureDestFolder(dest: ImapConnection, name: String, delim: Char?, ctx: Ctx) {
        if (name.equals("INBOX", ignoreCase = true) || name in ctx.dstPaths) return
        for (p in Plan.pathsToCreate(name, delim)) {
            if (p in ctx.dstPaths) continue
            try {
                dest.folder(p).create(Folder.HOLDS_MESSAGES or Folder.HOLDS_FOLDERS)
                ctx.dstPaths += p
            } catch (e: Exception) {
                // Maybe it existed without ALREADYEXISTS: confirm with a fresh LIST.
                val fresh = dest.listFolders().map { it.name }.toSet()
                if (p in fresh) ctx.dstPaths += p
                else if (p == name) ctx.log("[$name] cannot create folder in destination: ${e.message}")
            }
        }
        if (name !in ctx.dstPaths && dest.listFolders().any { it.name == name }) ctx.dstPaths += name
    }

    private fun copyFolder(ctx: Ctx, source: ImapConnection, dest: ImapConnection, srcName: String, dstName: String, base: SyncProgress): FolderResult {
        val res = FolderResult(srcName, dstName)
        fun fail(uid: Long, msg: String) {
            res.errors++
            if (res.errorSamples.size < cfg.maxErrorSamples) res.errorSamples += "uid $uid: $msg"
        }

        var srcMetas = index(source, srcName, ctx)
        ctx.skipIds[srcName]?.let { skip ->
            val before = srcMetas.size
            srcMetas = Dedupe.skip(srcMetas, { it.identity }, skip)
            ctx.log("[$srcName] ${before - srcMetas.size} already in other folders; copying only the ${srcMetas.size} that live only here")
        }
        res.sourceCount = srcMetas.size

        val (existing, toCopy) = Dedupe.plan(srcMetas, { it.identity }, destCounter(dest, dstName, ctx))
        res.existing = existing
        res.toCopy = toCopy.size
        ctx.log("[$srcName] source=${res.sourceCount} already=${res.existing} to_copy=${res.toCopy}")
        ctx.emit(ctx.progress.copy(phase = SyncProgress.Phase.COPYING, folder = srcName, folderCopied = 0, folderToCopy = toCopy.size))
        if (ctx.dryRun || toCopy.isEmpty()) return res

        val folder = source.openReadOnly(srcName)
        try {
            for (m in toCopy) {
                if (ctx.cancelled()) break
                if (ctx.maxBytes > 0 && ctx.transferred + m.size > ctx.maxBytes) {
                    ctx.overLimit = true
                    ctx.log("[$srcName] transfer limit reached (${ctx.transferred} bytes); stopping.")
                    break
                }
                try {
                    val raw = folder.fetchRaw(m.uid)
                    if (raw == null || raw.isEmpty()) { fail(m.uid, "empty body"); continue }
                    dest.append(dstName, raw, cleanFlags(m.flags), m.internalDate)
                    res.copied++
                    res.bytes += raw.size
                    ctx.transferred += raw.size
                    if (res.copied % cfg.progressEvery == 0 || res.copied == toCopy.size) {
                        ctx.emit(ctx.progress.copy(folderCopied = res.copied, copied = base.copied + res.copied, bytes = base.bytes + res.bytes))
                    }
                } catch (e: Exception) {
                    // One message does not abort the folder… unless the connection died.
                    if (e.isConnectionLoss() || !source.store.isConnected || !dest.store.isConnected) {
                        throw RuntimeException("IMAP connection lost copying [$srcName]: ${e.message}", e)
                    }
                    fail(m.uid, e.message ?: e.javaClass.simpleName)
                }
            }
        } finally {
            runCatching { folder.close(false) }
            ctx.emit(ctx.progress.copy(folderCopied = res.copied, copied = base.copied + res.copied, bytes = base.bytes + res.bytes))
        }
        return res
    }

    private fun cleanFlags(flags: Flags?): Flags? {
        if (flags == null) return null
        val out = Flags(flags)
        out.remove(Flags.Flag.RECENT)
        return out
    }

    /** Fresh, independent connections; per folder: source multiset (minus the "All" skip) ⊆ destination. */
    private fun verify(ctx: Ctx, origen: ImapAccount, destino: ImapAccount, mapping: List<Pair<String, String>>): Verification {
        val out = ArrayList<VerifyFolder>()
        var missing = 0
        ImapConnection.open(origen, timeouts).use { source ->
            ImapConnection.open(destino, timeouts).use { dest ->
                val dstPaths = dest.listFolders().map { it.name }.toSet()
                for ((src, dst) in mapping) {
                    val srcCounter = Multiset.of(index(source, src, ctx).map { it.identity })
                    ctx.skipIds[src]?.let { srcCounter.subtract(it) }
                    val dstCounter = if (dst.equals("INBOX", true) || dst in dstPaths) Multiset.of(index(dest, dst, ctx).map { it.identity }) else Multiset()
                    val c = Dedupe.verify(srcCounter, dstCounter)
                    out += VerifyFolder(src, c.sourceCount, c.destCount, c.matched, c.missing)
                    missing += c.missing
                    if (c.missing > 0 && !ctx.dryRun) ctx.log("[$src] verification: ${c.missing} missing in '$dst' (e.g. ${c.samples.take(5).joinToString()})")
                }
            }
        }
        return Verification(missing == 0, missing, out)
    }
}
