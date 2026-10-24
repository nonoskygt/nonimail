package com.nonosky.nonimailtools.core.integracion

import com.icegreen.greenmail.junit.GreenMailRule
import com.icegreen.greenmail.util.ServerSetup
import com.icegreen.greenmail.util.ServerSetupTest
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.Reporter
import com.nonosky.nonimailtools.core.limpiar.CleanOptions
import com.nonosky.nonimailtools.core.limpiar.CleanProgress
import com.nonosky.nonimailtools.core.limpiar.Limpieza
import com.nonosky.nonimailtools.core.limpiar.Rules
import com.nonosky.nonimailtools.core.limpiar.ScanMode
import com.nonosky.nonimailtools.core.limpiar.ScanOptions
import com.nonosky.nonimailtools.core.limpiar.ScanProgress
import com.nonosky.nonimailtools.core.mail.ImapAccount
import com.nonosky.nonimailtools.core.mail.ImapConnection
import com.nonosky.nonimailtools.core.mail.ImapException
import com.nonosky.nonimailtools.core.mail.ImapTimeouts
import com.nonosky.nonimailtools.core.mail.Security
import com.nonosky.nonimailtools.core.sync.SyncEngine
import com.nonosky.nonimailtools.core.sync.SyncOptions
import com.nonosky.nonimailtools.core.sync.SyncProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.Timeout
import java.util.Properties
import javax.mail.Flags
import javax.mail.Folder
import javax.mail.Session
import javax.mail.internet.InternetAddress
import javax.mail.internet.MimeMessage

/** Real IMAP conversations against an in-process GreenMail server. */
class ImapIntegracionTest {
    // No IMAP conversation may take more than a minute; a stuck one fails instead of hanging CI.
    @get:Rule(order = 0) val limite: Timeout = Timeout.seconds(60)
    @get:Rule(order = 1) val gm = GreenMailRule(ServerSetupTest.IMAP)

    private val d = Defaults.instance
    private val timeouts = ImapTimeouts(5_000, 20_000)
    private val rules = Rules.compile(d.heuristics)

    private fun acct(login: String) = ImapAccount("$login@test.local", "127.0.0.1", ServerSetupTest.IMAP.port, Security.NONE, login, "pw-$login")

    private fun msg(from: String, subject: String, id: String?, unsub: Boolean = false, body: String = "hola"): MimeMessage =
        MimeMessage(Session.getInstance(Properties())).apply {
            setFrom(InternetAddress(from)); setRecipients(javax.mail.Message.RecipientType.TO, "yo@test.local")
            setSubject(subject, "UTF-8"); setText(body)
            if (unsub) setHeader("List-Unsubscribe", "<mailto:baja@x.com>")
            if (id != null) setHeader("Message-ID", id)
            saveChanges()
            if (id != null) setHeader("Message-ID", id)
        }

    private fun seed(login: String, vararg ms: MimeMessage) {
        val u = gm.setUser("$login@test.local", login, "pw-$login")
        ms.forEach { u.deliver(it) }
    }

    private fun createFolder(login: String, name: String) {
        val store = Session.getInstance(Properties()).getStore("imap")
        store.connect("127.0.0.1", ServerSetupTest.IMAP.port, login, "pw-$login")
        store.getFolder(name).create(Folder.HOLDS_MESSAGES)
        store.close()
    }

    private fun count(login: String, folder: String): Int =
        ImapConnection.open(acct(login), timeouts).use { c -> c.openReadOnly(folder).let { f -> f.messageCount.also { f.close(false) } } }

    private fun scanOpt() = ScanOptions(ScanMode.MENSAJES, 100, emptyList(), rules, d.scores, d.cleaning, d.folders.sent)

    @Test fun scanGroupsBySenderAndScoresAndNeverMarksRead() {
        seed(
            "ana",
            msg("Oferta <noreply@tienda.com>", "50% OFF hoy", "<1@t>", unsub = true),
            msg("Oferta <noreply@tienda.com>", "Black Friday", "<2@t>", unsub = true),
            msg("Banco <alertas@banco.com>", "Su estado de cuenta", "<3@t>"),
            msg("Juan <juan@amigo.com>", "Almuerzo?", "<4@t>"),
        )
        val r = Limpieza(timeouts).scan(acct("ana"), scanOpt(), object : Reporter<ScanProgress> {})
        assertEquals(4, r.reviewed)
        val by = r.senders.associateBy { it.email }
        assertEquals(2, by.getValue("noreply@tienda.com").count)
        assertTrue(by.getValue("noreply@tienda.com").score >= 88)
        assertTrue(by.getValue("alertas@banco.com").isProtected)
        assertFalse(by.getValue("juan@amigo.com").isProtected)
        assertTrue(by.getValue("juan@amigo.com").score < 30)
        // Read-only: nothing got \Seen.
        ImapConnection.open(acct("ana"), timeouts).use { c ->
            val f = c.openReadOnly("INBOX")
            assertTrue(f.messages.none { it.isSet(Flags.Flag.SEEN) })
            f.close(false)
        }
    }

    @Test fun refusesToCleanWithoutATrashFolder() {
        seed("bea", msg("A <noreply@x.com>", "oferta", "<1@t>"))
        val opt = CleanOptions(dryRun = false, protectedList = emptyList(), rules = rules, trashNames = d.folders.trash)
        try {
            Limpieza(timeouts).execute(acct("bea"), listOf("noreply@x.com"), opt, object : Reporter<CleanProgress> {})
            fail("must refuse")
        } catch (e: ImapException) {
            assertEquals(ImapException.Reason.NO_TRASH, e.reason)
        }
        assertEquals(1, count("bea", "INBOX"))
        // Dry run without Trash does not throw and moves nothing.
        val dry = Limpieza(timeouts).execute(acct("bea"), listOf("noreply@x.com"), opt.copy(dryRun = true), object : Reporter<CleanProgress> {})
        assertNull(dry.trash); assertEquals(1, dry.total); assertEquals(1, count("bea", "INBOX"))
    }

    @Test fun dryRunCountsAndRealRunMovesToTrashSparingProtected() {
        seed(
            "cris",
            msg("A <noreply@x.com>", "oferta 1", "<1@t>"),
            msg("A <noreply@x.com>", "oferta 2", "<2@t>"),
            msg("A <noreply@x.com>", "Su factura de octubre", "<3@t>"),
            msg("Z <noreply@xx.com>", "oferta", "<4@t>"),
            msg("B <jefe@banco.com>", "hola", "<5@t>"),
        )
        createFolder("cris", "Trash")
        val l = Limpieza(timeouts)
        val opt = CleanOptions(dryRun = true, protectedList = listOf("banco.com"), rules = rules, trashNames = d.folders.trash)
        val dry = l.execute(acct("cris"), listOf("noreply@x.com", "jefe@banco.com"), opt, object : Reporter<CleanProgress> {})
        assertEquals("Trash", dry.trash)
        assertEquals(2, dry.total)                       // the invoice is spared by the keep pattern
        assertEquals(1, dry.protectedMessages)
        assertEquals(listOf("jefe@banco.com"), dry.skippedSenders)
        assertEquals(5, count("cris", "INBOX")); assertEquals(0, count("cris", "Trash"))

        val real = l.execute(acct("cris"), listOf("noreply@x.com", "jefe@banco.com"), opt.copy(dryRun = false), object : Reporter<CleanProgress> {})
        assertEquals(2, real.total)
        assertEquals(3, count("cris", "INBOX"))          // invoice + other sender + protected bank
        assertEquals(2, count("cris", "Trash"))
    }

    @Test fun syncCopiesOnlyMissingAndVerifies() {
        seed("src", msg("A <a@x.com>", "uno", "<1@t>"), msg("B <b@x.com>", "dos", "<2@t>"), msg("C <c@x.com>", "tres", null))
        createFolder("src", "Clientes")
        seed("dst", msg("A <a@x.com>", "uno", "<1@t>"))
        val engine = SyncEngine(timeouts, d.sync)
        val o = SyncOptions(dryRun = true)
        val sim = engine.run(acct("src"), acct("dst"), o, object : Reporter<SyncProgress> {})
        assertTrue(sim.error ?: "", sim.ok)
        assertEquals(2, sim.totals.toCopy); assertEquals(1, sim.totals.existing); assertEquals(0, sim.totals.copied)
        assertEquals(1, count("dst", "INBOX"))

        val real = engine.run(acct("src"), acct("dst"), o.copy(dryRun = false), object : Reporter<SyncProgress> {})
        assertTrue(real.error ?: "", real.ok)
        assertEquals(2, real.totals.copied)
        assertNotNull(real.verification); assertTrue(real.verification!!.ok)
        assertEquals(3, count("dst", "INBOX"))

        val again = engine.run(acct("src"), acct("dst"), o.copy(dryRun = false), object : Reporter<SyncProgress> {})
        assertEquals(0, again.totals.copied); assertEquals(3, again.totals.existing)
        assertEquals(3, count("src", "INBOX"))           // the source is never touched
    }

    @Test fun savedRulesDecideWhatIsDeletedAndWhatIsSpared() {
        seed(
            "dora",
            msg("A <ofertas@tienda.com>", "oferta 1", "<1@t>"),
            msg("A <ofertas@tienda.com>", "Su factura de octubre", "<2@t>"),
            msg("B <amiga@tienda.com>", "oferta amiga", "<3@t>"),
            msg("C <x@otra.com>", "oferta", "<4@t>"),
            msg("D <banco@banco.com>", "Su estado de cuenta", "<5@t>"),
        )
        createFolder("dora", "Trash")
        val reglas = mapOf("@tienda.com" to "delete", "amiga@tienda.com" to "protect", "x@otra.com" to "protect", "banco@banco.com" to "delete")
        val opt = CleanOptions(dryRun = false, protectedList = emptyList(), rules = rules, trashNames = d.folders.trash, reglas = reglas)
        val r = Limpieza(timeouts).execute(acct("dora"), listOf("ofertas@tienda.com", "amiga@tienda.com", "x@otra.com", "banco@banco.com"), opt, object : Reporter<CleanProgress> {})
        // delete beats the invoice/bank patterns; protect spares even when it was asked for
        assertEquals(3, r.total)
        assertEquals(0, r.protectedMessages)
        assertEquals(listOf("amiga@tienda.com", "x@otra.com"), r.skippedSenders)
        assertEquals(2, count("dora", "INBOX")); assertEquals(3, count("dora", "Trash"))
    }

    @Test fun scanSkipsTheAiForRuledAndReputationSenders() {
        val par = java.security.KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
        val pub = par.public.encoded.takeLast(32).toByteArray()
        val base = kotlinx.serialization.json.Json.parseToJsonElement("""{"v":1,"generado":"g","dominios":{"tienda.com":{"eliminar_pct":95,"n":50},"amigos.com":{"eliminar_pct":2,"n":40}}}""")
        val sig = java.security.Signature.getInstance("Ed25519").apply {
            initSign(par.private); update((com.nonosky.nonimailtools.core.limpiar.Filtro.PREFIJO_FIRMA + com.nonosky.nonimailtools.core.limpiar.Filtro.canonico(base)).toByteArray())
        }.sign()
        val doc = base.toString().dropLast(1) + ",\"firma\":\"" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(sig) + "\"}"
        val rep = com.nonosky.nonimailtools.core.limpiar.Reputacion.leer(doc, pub)!!
        seed(
            "eva",
            msg("A <hola@tienda.com>", "novedades", "<1@t>"),
            msg("B <hola@amigos.com>", "oferta 50% OFF", "<2@t>", unsub = true),
            msg("C <promo@regla.com>", "oferta", "<3@t>"),
            msg("D <alertas@banco.com>", "Su estado de cuenta", "<4@t>"),
            msg("E <otro@sinrep.com>", "oferta", "<5@t>"),
        )
        val llamadas = ArrayList<String>()
        val ia = object : com.nonosky.nonimailtools.core.limpiar.IaScorer {
            override fun generate(prompt: String): String { llamadas += prompt; return "PROMOCION" }
        }
        val opt = scanOpt().copy(ia = ia, categoryScores = d.llm.categoryScores, reglas = mapOf("promo@regla.com" to "delete"), reputacion = rep, filtro = d.filtro)
        val r = Limpieza(timeouts).scan(acct("eva"), opt, object : Reporter<ScanProgress> {})
        val by = r.senders.associateBy { it.email }
        assertEquals(com.nonosky.nonimailtools.core.limpiar.Reason.REPUTACION, by.getValue("hola@tienda.com").reason)
        assertEquals(95, by.getValue("hola@tienda.com").score)
        assertEquals(com.nonosky.nonimailtools.core.limpiar.Reason.REPUTACION, by.getValue("hola@amigos.com").reason)
        assertEquals(5, by.getValue("hola@amigos.com").score)
        assertTrue("protected stays protected", by.getValue("alertas@banco.com").isProtected)
        // only the sender with no rule, no reputation and no protection reached the model
        assertEquals(1, llamadas.size)
        assertEquals(com.nonosky.nonimailtools.core.limpiar.Reason.IA, by.getValue("otro@sinrep.com").reason)
        assertTrue(by.getValue("promo@regla.com").reason != com.nonosky.nonimailtools.core.limpiar.Reason.IA)
    }
}
