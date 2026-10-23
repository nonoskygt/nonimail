package com.nonosky.nonimailtools.core.mail

import com.sun.mail.iap.Argument
import com.sun.mail.iap.Response
import com.sun.mail.imap.IMAPFolder
import com.sun.mail.imap.IMAPSSLStore
import com.sun.mail.imap.IMAPStore
import com.sun.mail.imap.protocol.BASE64MailboxEncoder
import com.sun.mail.imap.protocol.BODY
import com.sun.mail.imap.protocol.ENVELOPE
import com.sun.mail.imap.protocol.FLAGS
import com.sun.mail.imap.protocol.FetchResponse
import com.sun.mail.imap.protocol.IMAPProtocol
import com.sun.mail.imap.protocol.INTERNALDATE
import com.sun.mail.imap.protocol.RFC822SIZE
import com.sun.mail.imap.protocol.UID
import java.util.Date
import java.util.Properties
import javax.mail.AuthenticationFailedException
import javax.mail.Flags
import javax.mail.Folder
import javax.mail.MessagingException
import javax.mail.Session
import javax.mail.URLName
import javax.mail.internet.InternetAddress
import javax.mail.internet.InternetHeaders
import javax.mail.internet.MimeUtility

/** How the IMAP connection is protected. */
enum class Security(val id: String) {
    SSL("ssl"), STARTTLS("starttls"), NONE("none");

    companion object {
        fun of(id: String?): Security = entries.firstOrNull { it.id == id } ?: SSL
    }
}

/**
 * What the engines need to log in. The password is never logged or serialized from here.
 * With [oauth] the "password" is a short-lived OAuth access token and the login uses XOAUTH2.
 */
data class ImapAccount(
    val email: String,
    val host: String,
    val port: Int = 993,
    val security: Security = Security.SSL,
    val user: String = email,
    val password: String,
    val oauth: Boolean = false,
) {
    override fun toString(): String = "ImapAccount(email=$email, host=$host, port=$port, security=$security)"
}

data class ImapTimeouts(val connectMs: Int = 30_000, val ioMs: Int = 120_000)

/** A connection failure with a stable reason the UI can translate. */
class ImapException(val reason: Reason, message: String, cause: Throwable? = null) : Exception(message, cause) {
    enum class Reason { AUTH, CONNECT, PROTOCOL, NO_TRASH, CANCELLED }
}

/** One selectable folder from LIST. [special] is the RFC 6154 attribute in lower case ("\\trash") or "". */
data class FolderMeta(val name: String, val delimiter: Char?, val special: String)

/** Envelope-level data of one message: everything indexing and scanning need, no body. */
data class MessageMeta(
    val uid: Long,
    val messageId: String?,
    val date: Date?,
    val from: List<InternetAddress>,
    val to: List<InternetAddress>,
    val cc: List<InternetAddress>,
    val subject: String,
    val inReplyTo: String?,
    val size: Long,
    val flags: Flags?,
    val internalDate: Date?,
    val headers: InternetHeaders?,
)

/**
 * Thin layer over JavaMail's IMAP protocol API. Messages are addressed by UID and fetched
 * in batches straight from FETCH responses, so no `IMAPMessage` objects pile up in memory
 * on big folders. Reading uses EXAMINE (read-only) and `BODY.PEEK`: nothing gets marked read.
 */
class ImapConnection private constructor(val store: IMAPStore, val account: ImapAccount) : AutoCloseable {

    val separatorCache = mutableMapOf<String, Char?>()

    fun hasCapability(cap: String): Boolean = runCatching { store.hasCapability(cap) }.getOrDefault(false)

    /** Selectable folders with their special-use attribute (if the server sends one). */
    fun listFolders(): List<FolderMeta> {
        val out = mutableListOf<FolderMeta>()
        for (f in store.defaultFolder.list("*")) {
            val imap = f as IMAPFolder
            val attrs = runCatching { imap.attributes.map { it.lowercase() } }.getOrDefault(emptyList())
            if ("\\noselect" in attrs || "\\nonexistent" in attrs) continue
            if (!runCatching { (imap.type and Folder.HOLDS_MESSAGES) != 0 }.getOrDefault(true)) continue
            val special = attrs.sorted().firstOrNull { it in SPECIAL_USES } ?: ""
            val sep = runCatching { imap.separator }.getOrNull()?.takeIf { it != '\u0000' }
            out += FolderMeta(imap.fullName, sep, special)
        }
        return out
    }

    /**
     * A special folder: the one with the SPECIAL-USE attribute [use] (e.g. "\\Trash");
     * otherwise the first of [names] that exists (case-insensitive). Null if none.
     */
    fun findSpecialFolder(use: String, names: List<String>, folders: List<FolderMeta> = listFolders()): String? {
        val u = use.lowercase()
        folders.firstOrNull { it.special == u }?.let { return it.name }
        val byLower = folders.associateBy { it.name.lowercase() }
        for (n in names) byLower[n.lowercase()]?.let { return it.name }
        return null
    }

    fun folder(name: String): IMAPFolder = store.getFolder(name) as IMAPFolder

    /** Opens [name] read-only (EXAMINE). */
    fun openReadOnly(name: String): IMAPFolder = folder(name).also { it.open(Folder.READ_ONLY) }

    fun openReadWrite(name: String): IMAPFolder = folder(name).also { it.open(Folder.READ_WRITE) }

    override fun close() {
        runCatching { store.close() }
    }

    companion object {
        /** RFC 6154 attributes the engines care about (lower case). */
        val SPECIAL_USES = setOf("\\all", "\\archive", "\\drafts", "\\flagged", "\\important", "\\junk", "\\sent", "\\trash")

        fun sessionProperties(account: ImapAccount, timeouts: ImapTimeouts): Properties {
            val proto = if (account.security == Security.SSL) "imaps" else "imap"
            return Properties().apply {
                put("mail.$proto.connectiontimeout", timeouts.connectMs.toString())
                put("mail.$proto.timeout", timeouts.ioMs.toString())
                put("mail.$proto.writetimeout", timeouts.ioMs.toString())
                // Never set \Seen when reading bodies.
                put("mail.$proto.peek", "true")
                put("mail.$proto.fetchsize", (1024 * 1024).toString())
                put("mail.$proto.partialfetch", "false")
                put("mail.$proto.ssl.checkserveridentity", "true")
                if (account.oauth) {
                    // The access token goes in as the password; only XOAUTH2 is attempted.
                    put("mail.$proto.auth.mechanisms", "XOAUTH2")
                    put("mail.$proto.auth.login.disable", "true")
                    put("mail.$proto.auth.plain.disable", "true")
                }
                if (account.security == Security.STARTTLS) {
                    put("mail.imap.starttls.enable", "true")
                    put("mail.imap.starttls.required", "true")
                }
            }
        }

        /** Connects and logs in. Throws [ImapException] with a translatable reason. */
        fun open(account: ImapAccount, timeouts: ImapTimeouts = ImapTimeouts()): ImapConnection {
            val props = sessionProperties(account, timeouts)
            val session = Session.getInstance(props)
            // Built directly (not via Session.getStore) so no provider lookup can pick
            // another JavaMail implementation that happens to be on the classpath.
            val store: IMAPStore = if (account.security == Security.SSL) {
                IMAPSSLStore(session, URLName("imaps", account.host, account.port, null, account.user, null))
            } else {
                IMAPStore(session, URLName("imap", account.host, account.port, null, account.user, null))
            }
            try {
                store.connect(account.host, account.port, account.user, account.password)
            } catch (e: AuthenticationFailedException) {
                throw ImapException(ImapException.Reason.AUTH, "Login rejected by ${account.host}", e)
            } catch (e: MessagingException) {
                throw ImapException(ImapException.Reason.CONNECT, "Cannot connect to ${account.host}:${account.port}: ${e.message}", e)
            }
            return ImapConnection(store, account)
        }

        /** Opens and closes a connection: true when login works. */
        fun test(account: ImapAccount, timeouts: ImapTimeouts = ImapTimeouts()) {
            open(account, timeouts).use { it.listFolders() }
        }
    }
}

// ---------------------------------------------------------------------------------------
// Low-level commands on an open folder (UID SEARCH / UID FETCH / MOVE …).
// ---------------------------------------------------------------------------------------

/** Runs [block] with the folder's protocol connection. */
fun <T> IMAPFolder.withProtocol(block: (IMAPProtocol) -> T): T {
    @Suppress("UNCHECKED_CAST")
    return doCommand { p -> block(p) } as T
}

/** Untagged responses minus FETCH go to the folder (EXPUNGE etc. keep it consistent). */
private fun IMAPProtocol.finish(r: Array<Response>) {
    notifyResponseHandlers(r.filter { it !is FetchResponse }.toTypedArray())
    handleResult(r[r.size - 1])
}

/** `UID SEARCH <criteria>` → sorted UIDs. [args] carries strings (quoted/literal as needed). */
fun IMAPFolder.uidSearch(criteria: String, args: Argument? = null, utf8: Boolean = false): List<Long> = withProtocol { p ->
    val cmd = if (utf8) "UID SEARCH CHARSET UTF-8 $criteria" else "UID SEARCH $criteria"
    val r = p.command(cmd, args)
    val out = mutableListOf<Long>()
    for (resp in r) {
        if (resp is FetchResponse || !resp.isUnTagged) continue
        val ir = resp as? com.sun.mail.imap.protocol.IMAPResponse ?: continue
        if (!ir.keyEquals("SEARCH")) continue
        while (true) {
            val n = ir.readLong()
            if (n < 0) break
            out += n
        }
    }
    p.finish(r)
    out.sort()
    out
}

/** IMAP date for SEARCH SINCE: 21-Oct-2026. */
fun imapSearchDate(d: Date): String {
    val c = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
    c.time = d
    val months = arrayOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return "%d-%s-%d".format(c.get(java.util.Calendar.DAY_OF_MONTH), months[c.get(java.util.Calendar.MONTH)], c.get(java.util.Calendar.YEAR))
}

/** Compact UID set: 1:5,7,9:12. */
fun uidSet(uids: Collection<Long>): String {
    val s = uids.toSortedSet().toList()
    if (s.isEmpty()) return ""
    val sb = StringBuilder()
    var start = s[0]
    var prev = s[0]
    fun flush() {
        if (sb.isNotEmpty()) sb.append(',')
        sb.append(start)
        if (prev != start) sb.append(':').append(prev)
    }
    for (i in 1 until s.size) {
        if (s[i] == prev + 1) { prev = s[i]; continue }
        flush(); start = s[i]; prev = s[i]
    }
    flush()
    return sb.toString()
}

/**
 * `UID FETCH` of envelope data for [uids] (one round trip per call; callers batch).
 * [headerFields] adds `BODY.PEEK[HEADER.FIELDS (...)]`.
 */
fun IMAPFolder.fetchMeta(uids: Collection<Long>, headerFields: List<String> = emptyList(), withFlags: Boolean = true): List<MessageMeta> {
    if (uids.isEmpty()) return emptyList()
    val items = buildString {
        append("UID RFC822.SIZE INTERNALDATE ENVELOPE")
        if (withFlags) append(" FLAGS")
        if (headerFields.isNotEmpty()) append(" BODY.PEEK[HEADER.FIELDS (").append(headerFields.joinToString(" ")).append(")]")
    }
    return withProtocol { p ->
        val r = p.command("UID FETCH ${uidSet(uids)} ($items)", null)
        val out = mutableListOf<MessageMeta>()
        for (resp in r) {
            val fr = resp as? FetchResponse ?: continue
            val uid = fr.getItem(UID::class.java)?.uid ?: continue
            val env = fr.getItem(ENVELOPE::class.java)
            val body = fr.getItem(BODY::class.java)
            val headers = body?.byteArrayInputStream?.let { runCatching { InternetHeaders(it) }.getOrNull() }
            out += MessageMeta(
                uid = uid,
                messageId = env?.messageId,
                date = env?.date,
                from = env?.from?.toList().orEmpty(),
                to = env?.to?.toList().orEmpty(),
                cc = env?.cc?.toList().orEmpty(),
                subject = decodeSubject(env?.subject),
                inReplyTo = env?.inReplyTo,
                size = fr.getItem(RFC822SIZE::class.java)?.size ?: 0L,
                flags = fr.getItem(FLAGS::class.java),
                internalDate = fr.getItem(INTERNALDATE::class.java)?.date,
                headers = headers,
            )
        }
        p.finish(r)
        out.distinctBy { it.uid }.sortedBy { it.uid }
    }
}

/** Full raw message (`BODY.PEEK[]`), or null when the server returns nothing. */
fun IMAPFolder.fetchRaw(uid: Long): ByteArray? = withProtocol { p ->
    val r = p.command("UID FETCH $uid (UID BODY.PEEK[])", null)
    var bytes: ByteArray? = null
    for (resp in r) {
        val fr = resp as? FetchResponse ?: continue
        if (fr.getItem(UID::class.java)?.uid != uid) continue
        val ba = fr.getItem(BODY::class.java)?.byteArray ?: continue
        bytes = ba.bytes.copyOfRange(ba.start, ba.start + ba.count)
    }
    p.finish(r)
    bytes
}

/** Mailbox name as an IMAP argument (modified UTF-7). */
fun mailboxArg(name: String): Argument = Argument().writeString(BASE64MailboxEncoder.encode(name))

fun IMAPFolder.uidMove(uids: Collection<Long>, dest: String) = withProtocol { p ->
    p.finish(p.command("UID MOVE ${uidSet(uids)}", mailboxArg(dest)))
}

fun IMAPFolder.uidCopy(uids: Collection<Long>, dest: String) = withProtocol { p ->
    p.finish(p.command("UID COPY ${uidSet(uids)}", mailboxArg(dest)))
}

fun IMAPFolder.uidAddDeleted(uids: Collection<Long>) = withProtocol { p ->
    p.finish(p.command("UID STORE ${uidSet(uids)} +FLAGS.SILENT (\\Deleted)", null))
}

fun IMAPFolder.uidExpunge(uids: Collection<Long>) = withProtocol { p ->
    p.finish(p.command("UID EXPUNGE ${uidSet(uids)}", null))
}

fun IMAPFolder.expungeAll() = withProtocol { p -> p.finish(p.command("EXPUNGE", null)) }

/** APPEND with flags and internal date, through the store connection (folder may be closed). */
fun ImapConnection.append(folder: String, raw: ByteArray, flags: Flags?, internalDate: Date?) {
    val f = this.folder(folder)
    f.withProtocol { p ->
        p.append(folder, flags, internalDate, object : com.sun.mail.iap.Literal {
            override fun size(): Int = raw.size
            override fun writeTo(os: java.io.OutputStream) = os.write(raw)
        })
    }
}

/** Decodes an ENVELOPE subject (RFC 2047) the way IMAPMessage.getSubject does. */
fun decodeSubject(raw: String?): String {
    if (raw == null) return ""
    return runCatching { MimeUtility.decodeText(MimeUtility.unfold(raw)) }.getOrDefault(raw)
        .replace(Regex("\\s+"), " ").trim()
}

/** Lower-case `mailbox@host` of an address, or "" for group markers and junk. */
fun addressOf(a: InternetAddress?): String {
    val s = a?.address?.trim()?.lowercase() ?: return ""
    return if ('@' in s && !s.startsWith("@") && !s.endsWith("@")) s else ""
}

fun personalOf(a: InternetAddress?): String =
    (a?.personal ?: "").replace(Regex("\\s+"), " ").trim()

/** True for errors that mean the connection is gone (vs. one bad message). */
fun Throwable.isConnectionLoss(): Boolean {
    var t: Throwable? = this
    while (t != null) {
        if (t is javax.mail.FolderClosedException || t is javax.mail.StoreClosedException ||
            t is com.sun.mail.iap.ConnectionException || t is java.net.SocketException ||
            t is java.net.SocketTimeoutException || t is java.io.EOFException
        ) return true
        t = t.cause
    }
    return false
}
