package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.Defaults
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HeuristicaTest {
    private val d = Defaults.instance
    private val rules = Rules.compile(d.heuristics)
    private val lv = d.scores

    private fun score(email: String, name: String = "", subjects: List<String> = emptyList(), bulk: Boolean = false,
                      contacts: Set<String> = emptySet(), prot: List<String> = emptyList()) =
        Heuristica.score(email, name, subjects, bulk, contacts, prot, rules, lv)

    @Test fun promoSubjectScoresHigh() {
        val (s, r) = score("tienda@shop.com", "Tienda", listOf("50% OFF solo hoy"))
        assertEquals(lv.promo, s); assertEquals(Reason.PROMOCION, r)
    }

    @Test fun bankAndInvoiceAreProtectedEvenIfBulk() {
        assertEquals(Reason.PROTEGIDO, score("alertas@bi.com.gt", "BI en Línea", bulk = true).second)
        assertEquals(Reason.PROTEGIDO, score("x@y.com", "X", listOf("Su factura de octubre"), bulk = true).second)
        assertEquals(Reason.PROTEGIDO, score("x@y.com", "X", listOf("Su código de verificación es 123456")).second)
        assertEquals(0, score("x@y.com", "X", listOf("Verification code 123456")).first)
    }

    @Test fun contactsAndUserListAreProtected() {
        assertEquals(Reason.CONTACTO, score("amiga@x.com", contacts = setOf("amiga@x.com")).second)
        assertEquals(Reason.PROTEGIDO_USUARIO, score("a@promo.empresa.com", subjects = listOf("oferta"), prot = listOf("empresa.com")).second)
        assertEquals(Reason.PROTEGIDO_USUARIO, score("Ana@x.com", prot = listOf("ana@x.com")).second)
    }

    @Test fun automaticAndBulkLevels() {
        assertEquals(Reason.MASIVO_AUTOMATICO, score("noreply@x.com", bulk = true).second)
        assertEquals(Reason.MASIVO, score("juan@x.com", bulk = true).second)
        assertEquals(Reason.AUTOMATICO, score("noreply@x.com").second)
        assertEquals(Reason.PERSONA, score("juan@x.com", "Juan").second)
        assertTrue(score("noreply@x.com", bulk = true).first > score("juan@x.com").first)
    }

    @Test fun protectedListMatchesDomainsAndSubdomains() {
        assertTrue(Heuristica.inProtectedList("a@mail.banco.com", listOf("banco.com")))
        assertFalse(Heuristica.inProtectedList("a@notbanco.com", listOf("banco.com")))
        assertTrue(Heuristica.inProtectedList("a@banco.com", listOf("@banco.com")))
        assertFalse(Heuristica.inProtectedList("b@banco.com", listOf("a@banco.com")))
    }

    @Test fun hardnessMovesTheCutLine() {
        assertTrue(Heuristica.cutLine(90, 12) < Heuristica.cutLine(10, 12))
        // 75 is cleaned by a hard setting and kept by a soft one.
        assertEquals(Decision.LIMPIAR, Heuristica.decide(75, 80, 12))
        assertEquals(Decision.CONSERVAR, Heuristica.decide(60, 10, 12))
        assertEquals(Decision.DUDA, Heuristica.decide(50, 50, 12))
        assertEquals(Decision.LIMPIAR, Heuristica.decide(15, 100, 12))
    }

    @Test fun bulkSignals() {
        assertEquals(true to true, Heuristica.bulkSignals("<mailto:x>", null, null))
        assertEquals(false to true, Heuristica.bulkSignals(null, "<list.x>", null))
        assertEquals(false to true, Heuristica.bulkSignals(null, null, " Bulk "))
        assertEquals(false to false, Heuristica.bulkSignals(null, null, "normal"))
    }

    @Test fun blankPatternNeverMatchesAndBadPatternIsRejected() {
        assertNull(Rules.pattern("  "))
        assertFalse(Rules.isValid("(abc"))
        assertTrue(Rules.isValid(""))
    }

    @Test fun parseOllamaScore() {
        assertEquals(85, Ollama.parseScore("85", null))
        assertEquals(70, Ollama.parseScore("Puntaje: 70", null))
        assertEquals(30, Ollama.parseScore("**30**", null))
        assertEquals(42, Ollama.parseScore("de 0 a 100 -> 42", null))
        assertEquals(7, Ollama.parseScore("sin numero", 7))
        assertNull(Ollama.parseScore(null, null))
    }

    @Test fun ollamaUrlNormalization() {
        assertEquals("http://192.168.1.20:11434", Ollama.normalizeUrl("192.168.1.20", 11434))
        assertEquals("http://192.168.1.20:8080", Ollama.normalizeUrl("192.168.1.20:8080/", 11434))
        assertEquals("https://ia.casa", Ollama.normalizeUrl("https://ia.casa", 11434))
        assertEquals("", Ollama.normalizeUrl("  ", 11434))
    }

    @Test fun providerPresets() {
        assertEquals("gmail", d.providerForEmail("a@gmail.com")?.id)
        assertEquals("outlook", d.providerForEmail("a@hotmail.es")?.id)
        assertNull(d.providerForEmail("a@empresa.com"))
        assertTrue(d.provider("gmail")!!.appPassword)
    }
}
