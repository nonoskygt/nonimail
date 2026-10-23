package com.nonosky.nonimailtools.core.sync

import com.nonosky.nonimailtools.core.mail.FolderMeta
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class SyncTest {
    @Test fun identityUsesNormalizedMessageId() {
        val a = Identidad.of("abc@x", null, emptyList(), emptyList(), null, 0)
        val b = Identidad.of(" <abc@x> ", Date(5), listOf("z@z"), emptyList(), "otro", 99)
        assertEquals("mid:<abc@x>", a); assertEquals(a, b)
    }

    @Test fun identityFallsBackToHashOfDateAddressesSubjectSize() {
        val d = Date(1_700_000_000_000)
        val a = Identidad.of(null, d, listOf("A@x.com"), listOf("b@y.com", "c@y.com"), " Hola ", 100)
        val b = Identidad.of("", d, listOf("a@x.com"), listOf("c@y.com", "B@y.com"), "Hola", 100)
        assertTrue(a.startsWith("h:")); assertEquals(a, b)
        assertNotEquals(a, Identidad.of(null, d, listOf("a@x.com"), listOf("b@y.com", "c@y.com"), "Hola", 101))
        assertEquals("2023-11-14T22:13:20.000Z", Identidad.isoDate(d))
    }

    @Test fun dedupeCopiesOnlyWhatIsMissingAndKeepsLegitimateDuplicates() {
        val src = listOf("mid:<1>", "mid:<2>", "mid:<2>", "mid:<3>")
        val dst = Multiset.of(listOf("mid:<1>", "mid:<2>", "mid:<9>"))
        val (existing, toCopy) = Dedupe.plan(src, { it }, dst)
        assertEquals(2, existing)
        assertEquals(listOf("mid:<2>", "mid:<3>"), toCopy)
        assertEquals(3, dst.size()) // the caller's multiset is not consumed
    }

    @Test fun skipDropsWhatTravelsWithAnotherFolder() {
        val all = listOf("a", "b", "b", "c")
        assertEquals(listOf("b", "c"), Dedupe.skip(all, { it }, Multiset.of(listOf("a", "b"))))
    }

    @Test fun verifyIsMultisetSubset() {
        val ok = Dedupe.verify(Multiset.of(listOf("a", "b", "b")), Multiset.of(listOf("a", "b", "b", "z")))
        assertEquals(0, ok.missing); assertEquals(3, ok.matched)
        val bad = Dedupe.verify(Multiset.of(listOf("a", "b", "b")), Multiset.of(listOf("a", "b")))
        assertEquals(1, bad.missing); assertEquals(listOf("b x1".let { "b x1" }), bad.samples)
    }

    @Test fun multisetSubtract() {
        val m = Multiset.of(listOf("a", "a", "b")); m.subtract(Multiset.of(listOf("a", "c")))
        assertEquals(1, m.count("a")); assertEquals(1, m.count("b"))
    }

    private fun f(n: String, special: String = "", d: Char? = '/') = FolderMeta(n, d, special)

    @Test fun gmailVirtualFoldersAreSkippedAndAllMailGoesLast() {
        val metas = listOf(f("[Gmail]/All Mail", "\\all"), f("INBOX"), f("[Gmail]/Important", "\\important"), f("[Gmail]/Starred", "\\flagged"), f("Facturas"))
        val got = Plan.sourceFolders(metas, emptySet(), emptySet()).map { it.name }
        assertEquals(listOf("INBOX", "Facturas", "[Gmail]/All Mail"), got)
    }

    @Test fun includeAndExcludeAreCaseInsensitive() {
        val metas = listOf(f("INBOX"), f("Facturas"), f("Spam"))
        assertEquals(listOf("INBOX", "Facturas"), Plan.sourceFolders(metas, emptySet(), setOf("spam")).map { it.name })
        assertEquals(listOf("Facturas"), Plan.sourceFolders(metas, setOf("FACTURAS"), emptySet()).map { it.name })
    }

    @Test fun specialFoldersMapToTheDestinationEquivalent() {
        val src = listOf(f("INBOX"), f("[Gmail]/Sent Mail", "\\sent"), f("Clientes/2026"))
        val dst = listOf(f("INBOX", d = '.'), f("INBOX.Enviados", "\\sent", '.'))
        val m = Plan.mapping(src, dst, "INBOX.", '.')
        assertEquals("INBOX", m[0].dest)
        assertEquals("INBOX.Enviados", m[1].dest); assertTrue(m[1].merged)
        assertEquals("INBOX.Clientes.2026", m[2].dest)
    }

    @Test fun namespaceAndPathHelpers() {
        assertEquals("INBOX", Plan.withNamespace("inbox", "INBOX."))
        assertEquals("INBOX.X", Plan.withNamespace("X", "INBOX."))
        assertEquals("X", Plan.withNamespace("X", ""))
        assertEquals(listOf("A", "A/B", "A/B/C"), Plan.pathsToCreate("A/B/C", '/'))
        assertEquals(listOf("INBOX.A"), Plan.pathsToCreate("INBOX.A", '.'))
        assertEquals(listOf("\\Seen"), Plan.cleanFlags(listOf("\\Seen", "\\Recent")))
    }
}
