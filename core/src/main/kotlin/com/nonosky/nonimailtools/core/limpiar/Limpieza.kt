package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.CleaningDefaults
import com.nonosky.nonimailtools.core.Reporter
import com.nonosky.nonimailtools.core.ScoreLevels
import com.nonosky.nonimailtools.core.mail.ImapAccount
import com.nonosky.nonimailtools.core.mail.ImapConnection
import com.nonosky.nonimailtools.core.mail.ImapException
import com.nonosky.nonimailtools.core.mail.ImapTimeouts
import com.nonosky.nonimailtools.core.mail.Texto
import com.nonosky.nonimailtools.core.mail.addressOf
import com.nonosky.nonimailtools.core.mail.expungeAll
import com.nonosky.nonimailtools.core.mail.fetchMeta
import com.nonosky.nonimailtools.core.mail.imapSearchDate
import com.nonosky.nonimailtools.core.mail.personalOf
import com.nonosky.nonimailtools.core.mail.uidAddDeleted
import com.nonosky.nonimailtools.core.mail.uidCopy
import com.nonosky.nonimailtools.core.mail.uidExpunge
import com.nonosky.nonimailtools.core.mail.uidMove
import com.nonosky.nonimailtools.core.mail.uidSearch
import com.sun.mail.iap.Argument
import kotlinx.serialization.Serializable
import java.util.Date

/** Scan range: the last N messages or the last N days. */
enum class ScanMode(val id: String) {
    MENSAJES("mensajes"), DIAS("dias");

    companion object {
        fun of(id: String?): ScanMode = entries.firstOrNull { it.id == id } ?: MENSAJES
    }
}

data class ScanOptions(
    val mode: ScanMode,
    val amount: Int,
    val protectedList: List<String>,
    val rules: Rules,
    val levels: ScoreLevels,
    val cleaning: CleaningDefaults,
    val sentNames: List<String>,
    /** Null = heuristics only. */
    val ia: IaScorer? = null,
    val llmPrompt: String = "",
    val categoryScores: Map<String, Int> = emptyMap(),
    val now: Date = Date(),
)

/** One sender after the scan. */
@Serializable
data class SenderScore(
    val email: String,
    val name: String,
    val count: Int,
    val bytes: Long,
    val samples: List<String>,
    val unsubscribe: Boolean,
    val bulk: Boolean,
    val score: Int,
    val reason: Reason,
    val heuristicScore: Int,
) {
    val isProtected: Boolean
        get() = reason == Reason.PROTEGIDO || reason == Reason.PROTEGIDO_USUARIO || reason == Reason.CONTACTO
}

@Serializable
data class ScanResult(
    val account: String,
    val totalInbox: Int,
    val reviewed: Int,
    val contacts: Int,
    val senders: List<SenderScore>,
    val cancelled: Boolean,
    val durationMs: Long,
    val aiScored: Int,
    val aiError: String? = null,
)

data class ScanProgress(val phase: Phase, val done: Int = 0, val total: Int = 0, val senders: Int = 0) {
    enum class Phase { CONNECTING, SENT, INBOX, GROUPING, AI, DONE }

    val fraction: Float get() = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else 0f
}

data class CleanOptions(
    val dryRun: Boolean,
    val protectedList: List<String>,
    val rules: Rules,
    val trashNames: List<String>,
    val batch: Int = 200,
)

@Serializable
data class CleanResult(
    val dryRun: Boolean,
    val trash: String?,
    val total: Int,
    val perSender: Map<String, Int>,
    val skippedSenders: List<String>,
    val protectedMessages: Int,
    val cancelled: Boolean,
    val durationMs: Long,
    val usedMove: Boolean,
)

data class CleanProgress(val done: Int, val total: Int, val moved: Int) {
    val fraction: Float get() = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else 0f
}

/**
 * The cleaner. The scan only reads (EXAMINE + BODY.PEEK). The execution moves mail to the
 * Trash and nothing else: no Trash folder → it refuses before touching anything.
 */
class Limpieza(private val timeouts: ImapTimeouts) {

    private class Group(val email: String, var name: String) {
        var count = 0
        var bytes = 0L
        val samples = ArrayList<String>()
        var unsubscribe = false
        var bulk = false
        var protectedSubject: String? = null
        var replied = false
        var sampleUid = 0L
    }

    fun scan(account: ImapAccount, opt: ScanOptions, reporter: Reporter<ScanProgress>): ScanResult {
        val t0 = System.currentTimeMillis()
        fun log(s: String) = runCatching { reporter.log(s) }
        fun emit(p: ScanProgress) = runCatching { reporter.progress(p) }
        fun cancelled() = runCatching { reporter.cancelled() }.getOrDefault(false)
        val maxSamples = opt.cleaning.maxSamples
        val groups = LinkedHashMap<String, Group>()
        val contacts = HashSet<String>()
        val sentIds = HashSet<String>()
        var totalInbox = 0
        var reviewed = 0
        var cancelled = false
        var aiScored = 0
        var aiError: String? = null
        val scored = ArrayList<SenderScore>()

        emit(ScanProgress(ScanProgress.Phase.CONNECTING))
        ImapConnection.open(account, timeouts).use { conn ->
            val folders = conn.listFolders()
            // 1) Sent → who the user writes to (protects conversations).
            val sent = conn.findSpecialFolder("\\Sent", opt.sentNames, folders)
            if (sent != null && !sent.equals("INBOX", true)) {
                emit(ScanProgress(ScanProgress.Phase.SENT))
                val f = conn.openReadOnly(sent)
                try {
                    val uids = f.uidSearch("ALL").takeLast(opt.cleaning.sentScanMax).reversed()
                    for (chunk in uids.chunked(opt.cleaning.fetchBatch)) {
                        if (cancelled()) { cancelled = true; break }
                        for (m in f.fetchMeta(chunk, withFlags = false)) {
                            m.messageId?.let { sentIds += it.trim().lowercase() }
                            (m.to + m.cc).map(::addressOf).filter { it.isNotEmpty() }.forEach { contacts += it }
                        }
                    }
                } finally { runCatching { f.close(false) } }
                log("Contacts from Sent '$sent': ${contacts.size}")
            } else {
                log("No Sent folder found: no contacts to protect from there.")
            }

            // 2) INBOX, newest first, read-only.
            val inbox = conn.openReadOnly("INBOX")
            try {
                if (!cancelled) {
                    val all = inbox.uidSearch("ALL")
                    totalInbox = all.size
                    val uids = when (opt.mode) {
                        ScanMode.MENSAJES -> all.takeLast(opt.amount.coerceAtLeast(0))
                        ScanMode.DIAS -> {
                            val since = Date(opt.now.time - opt.amount.coerceAtLeast(0) * 86_400_000L)
                            inbox.uidSearch("SINCE ${imapSearchDate(since)}")
                        }
                    }.reversed()
                    log("INBOX: $totalInbox messages; reviewing ${uids.size}.")
                    emit(ScanProgress(ScanProgress.Phase.INBOX, 0, uids.size))
                    for (chunk in uids.chunked(opt.cleaning.fetchBatch)) {
                        if (cancelled()) { cancelled = true; log("Scan cancelled: returning what was reviewed."); break }
                        val metas = inbox.fetchMeta(chunk, headerFields = LIST_HEADERS, withFlags = false)
                        for (m in metas.sortedByDescending { it.uid }) {
                            reviewed++
                            val fromAddr = m.from.firstOrNull { addressOf(it).isNotEmpty() } ?: continue
                            val email = addressOf(fromAddr)
                            val name = personalOf(fromAddr)
                            val g = groups.getOrPut(email) { Group(email, name.ifEmpty { email }).also { it.sampleUid = m.uid } }
                            if (g.name == email && name.isNotEmpty()) g.name = name
                            g.count++
                            g.bytes += m.size
                            val subject = m.subject
                            if (subject.isNotEmpty() && g.samples.size < maxSamples) g.samples += if (subject.length <= 120) subject else subject.take(120) + "…"
                            if (subject.isNotEmpty() && g.protectedSubject == null && opt.rules.keep?.containsMatchIn(subject) == true) {
                                // One «Estado de cuenta» among a hundred promotions is enough to keep the sender.
                                g.protectedSubject = subject
                            }
                            if (!g.replied && sentIds.isNotEmpty()) {
                                val irt = m.inReplyTo?.let { MSGID.findAll(it).map { x -> x.value.lowercase() }.toList() }.orEmpty()
                                if (irt.any { it in sentIds }) g.replied = true
                            }
                            val h = m.headers
                            val (unsub, bulk) = Heuristica.bulkSignals(
                                h?.getHeader("List-Unsubscribe", ","), h?.getHeader("List-Id", ","), h?.getHeader("Precedence", ","),
                            )
                            g.unsubscribe = g.unsubscribe || unsub
                            g.bulk = g.bulk || bulk
                        }
                        log("[cpu] Leídos $reviewed / ${uids.size} correos · ${groups.size} remitentes")
                        emit(ScanProgress(ScanProgress.Phase.INBOX, reviewed, uids.size, groups.size))
                    }
                }

                // 3) Score each sender once.
                emit(ScanProgress(ScanProgress.Phase.GROUPING, groups.size, groups.size, groups.size))
                val effectiveContacts = contacts + groups.values.filter { it.replied }.map { it.email }
                for (g in groups.values) {
                    val subjects = g.samples + listOfNotNull(g.protectedSubject)
                    val (score, reason) = Heuristica.score(g.email, g.name, subjects, g.bulk, effectiveContacts, opt.protectedList, opt.rules, opt.levels)
                    scored += SenderScore(g.email, g.name, g.count, g.bytes, g.samples.toList(), g.unsubscribe, g.bulk, score, reason, score)
                    log("[cpu] ${g.email} · ${g.count} correos → $score (${reason.name.lowercase()})")
                }

                // 4) Optional local AI for every sender that is not protected.
                val ai = opt.ia
                if (ai != null && !cancelled) {
                    val todo = scored.indices.filter { !scored[it].isProtected }
                    emit(ScanProgress(ScanProgress.Phase.AI, 0, todo.size, groups.size))
                    for ((n, i) in todo.withIndex()) {
                        if (cancelled()) { cancelled = true; break }
                        val s = scored[i]
                        val g = groups.getValue(s.email)
                        val body = runCatching {
                            inbox.getMessageByUID(g.sampleUid)?.let { Texto.bodySample(it, opt.cleaning.bodyMaxChars) }.orEmpty()
                        }.getOrDefault("")
                        val bodyBulk = opt.rules.body?.containsMatchIn(body) == true
                        try {
                            val text = ai.generate(Ollama.buildPrompt(opt.llmPrompt, "${s.name} <${s.email}>", s.samples, s.bulk || bodyBulk, body))
                            val llm = Ollama.parseScore(text, null, opt.categoryScores)
                            log("[ia] ${s.email} → ${text.trim().lineSequence().firstOrNull().orEmpty().take(40)} = ${llm ?: "?"}")
                            if (llm != null) {
                                scored[i] = s.copy(score = llm, reason = Reason.IA, bulk = s.bulk || bodyBulk)
                                aiScored++
                            }
                        } catch (e: Exception) {
                            aiError = e.message ?: e.javaClass.simpleName
                            log("AI stopped, heuristics kept for the rest: $aiError")
                            break
                        }
                        emit(ScanProgress(ScanProgress.Phase.AI, n + 1, todo.size, groups.size))
                    }
                }
            } finally {
                runCatching { inbox.close(false) }
            }
        }
        emit(ScanProgress(ScanProgress.Phase.DONE, reviewed, reviewed, groups.size))
        val senders = scored.sortedWith(compareByDescending<SenderScore> { it.count }.thenBy { it.email })
        log("Scan ${if (cancelled) "cancelled" else "done"}: $reviewed messages, ${senders.size} senders, ${contacts.size} contacts.")
        return ScanResult(account.email, totalInbox, reviewed, contacts.size, senders, cancelled, System.currentTimeMillis() - t0, aiScored, aiError)
    }

    /**
     * Moves every INBOX message from [senders] to the Trash (or only counts, in dry run).
     * Only messages whose first From is EXACTLY the sender are touched (server SEARCH FROM is
     * a substring match). Protected senders and messages whose subject matches the keep
     * pattern are never moved.
     */
    fun execute(account: ImapAccount, senders: List<String>, opt: CleanOptions, reporter: Reporter<CleanProgress>): CleanResult {
        val t0 = System.currentTimeMillis()
        fun log(s: String) = runCatching { reporter.log(s) }
        fun cancelled() = runCatching { reporter.cancelled() }.getOrDefault(false)
        val wanted = senders.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()
        var total = 0
        var protectedMessages = 0
        val perSender = LinkedHashMap<String, Int>()
        val skipped = ArrayList<String>()
        var cancelled = false
        var usedMove = false
        var trash: String? = null

        ImapConnection.open(account, timeouts).use { conn ->
            trash = conn.findSpecialFolder("\\Trash", opt.trashNames)?.takeUnless { it.equals("INBOX", true) }
            if (trash == null) {
                if (!opt.dryRun) throw ImapException(ImapException.Reason.NO_TRASH, "The mailbox has no Trash folder. Nothing was moved.")
                log("Warning: no Trash folder; a real run would refuse.")
            }
            val withMove = conn.hasCapability("MOVE")
            val withUidplus = conn.hasCapability("UIDPLUS")
            usedMove = withMove
            val inbox = if (opt.dryRun) conn.openReadOnly("INBOX") else conn.openReadWrite("INBOX")
            try {
                runCatching { reporter.progress(CleanProgress(0, wanted.size, 0)) }
                for ((i, email) in wanted.withIndex()) {
                    if (cancelled()) { cancelled = true; break }
                    if ('@' !in email) { skipped += email; continue }
                    if (Heuristica.inProtectedList(email, opt.protectedList) || opt.rules.keep?.containsMatchIn(email) == true) {
                        skipped += email
                        log("Skipped (protected): $email")
                        continue
                    }
                    val ascii = email.all { it.code < 128 }
                    val args = Argument().apply {
                        if (ascii) writeString(email) else writeString(email, "UTF-8")
                        writeAtom("NOT")
                        writeAtom("DELETED")
                    }
                    val candidates = inbox.uidSearch("FROM", args, utf8 = !ascii)
                    val exact = ArrayList<Long>()
                    for (chunk in candidates.chunked(opt.batch)) {
                        for (m in inbox.fetchMeta(chunk, withFlags = false)) {
                            val from = m.from.firstOrNull { addressOf(it).isNotEmpty() }?.let(::addressOf) ?: continue
                            if (from != email) continue
                            if (opt.rules.keep?.containsMatchIn(m.subject) == true) { protectedMessages++; continue }
                            exact += m.uid
                        }
                    }
                    var n = 0
                    if (opt.dryRun) {
                        n = exact.size
                    } else {
                        for (chunk in exact.chunked(opt.batch)) {
                            if (cancelled()) { cancelled = true; break }
                            if (withMove) {
                                inbox.uidMove(chunk, trash!!)
                            } else {
                                inbox.uidCopy(chunk, trash!!) // throws before anything is flagged
                                inbox.uidAddDeleted(chunk)
                                if (withUidplus) {
                                    inbox.uidExpunge(chunk)
                                } else {
                                    val foreign = inbox.uidSearch("DELETED").toSet() - chunk.toSet()
                                    if (foreign.isEmpty()) inbox.expungeAll()
                                    else log("Warning: ${foreign.size} other messages are flagged deleted and the server has no UIDPLUS; not expunging.")
                                }
                            }
                            n += chunk.size
                        }
                    }
                    perSender[email] = n
                    total += n
                    log("${if (opt.dryRun) "[SIMULATION] " else ""}$email: $n")
                    runCatching { reporter.progress(CleanProgress(i + 1, wanted.size, total)) }
                    if (cancelled) break
                }
            } finally {
                runCatching { inbox.close(false) }
            }
        }
        return CleanResult(opt.dryRun, trash, total, perSender, skipped, protectedMessages, cancelled, System.currentTimeMillis() - t0, usedMove)
    }

    companion object {
        val LIST_HEADERS = listOf("LIST-UNSUBSCRIBE", "LIST-ID", "PRECEDENCE")
        private val MSGID = Regex("<[^<>\\s]+>")
    }
}
