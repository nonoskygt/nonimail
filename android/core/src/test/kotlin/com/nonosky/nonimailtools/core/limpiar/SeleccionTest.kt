package com.nonosky.nonimailtools.core.limpiar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SeleccionTest {
    private fun s(email: String, score: Int, reason: Reason, count: Int = 10, bytes: Long = 1000) =
        SenderScore(email, email, count, bytes, emptyList(), false, false, score, reason, score)

    private val list = listOf(
        s("promo@x.com", 95, Reason.PROMOCION),
        s("news@x.com", 75, Reason.MASIVO),
        s("juan@x.com", 15, Reason.PERSONA),
        s("banco@x.com", 0, Reason.PROTEGIDO, count = 5),
    )

    @Test fun harderSelectsMore() {
        val soft = Seleccion.automatica(list, 10, 12)
        val mid = Seleccion.automatica(list, 50, 12)
        val hard = Seleccion.automatica(list, 90, 12)
        assertEquals(emptySet<String>(), soft)
        assertEquals(setOf("promo@x.com", "news@x.com"), mid)
        assertTrue(hard.containsAll(mid))
        assertFalse("juan@x.com" in mid)
    }

    @Test fun protectedNeverSelectedEvenAtMaxHardness() {
        assertFalse("banco@x.com" in Seleccion.automatica(list, 100, 12))
        assertFalse("banco@x.com" in Seleccion.sinProtegidos(setOf("banco@x.com", "promo@x.com"), list))
    }

    @Test fun summaryCountsOnlyUnprotectedChosen() {
        val r = Seleccion.resumen(list, setOf("promo@x.com", "news@x.com", "banco@x.com"))
        assertEquals(Seleccion.Resumen(2, 20, 2000), r)
    }

    @Test fun cutLineFollowsHardness() {
        assertTrue(Seleccion.lineaDeCorte(80, 12) < Seleccion.lineaDeCorte(20, 12))
        assertEquals(100, Seleccion.lineaDeCorte(0, 12))
    }

    // ---- saved rules and domains ----

    private fun sd(email: String, score: Int, reason: Reason = Reason.MASIVO, count: Int = 10) =
        SenderScore(email, email, count, 100, emptyList(), false, false, score, reason, score)

    @Test fun ruleOfTheSenderBeatsTheDomainAndTheNoise() {
        val l = listOf(sd("ofertas@tienda.com", 95), sd("amiga@tienda.com", 95), sd("juan@amigo.com", 15))
        val reglas = mapOf("@tienda.com" to "protect", "amiga@tienda.com" to "delete", "juan@amigo.com" to "delete")
        assertEquals(setOf("amiga@tienda.com", "juan@amigo.com"), Seleccion.elegidos(l, reglas, 50, 12))
        // without rules only the noisy ones
        assertEquals(setOf("ofertas@tienda.com", "amiga@tienda.com"), Seleccion.elegidos(l, emptyMap(), 50, 12))
    }

    @Test fun deleteRuleBeatsContactButNotTheManualList() {
        val l = listOf(sd("ana@x.com", 0, Reason.CONTACTO), sd("jefe@y.com", 0, Reason.PROTEGIDO_USUARIO))
        val reglas = mapOf("ana@x.com" to "delete", "jefe@y.com" to "delete")
        assertEquals(setOf("ana@x.com"), Seleccion.elegidos(l, reglas, 50, 12))
        assertEquals(Seleccion.Resumen(1, 10, 100), Seleccion.resumen(l, setOf("ana@x.com", "jefe@y.com"), reglas))
    }

    @Test fun senderWithoutRuleCountsOnlyUnruledUnprotectedAboveTheThreshold() {
        val l = listOf(sd("a@x.com", 95), sd("b@x.com", 95), sd("c@x.com", 95, Reason.PROTEGIDO), sd("d@x.com", 20))
        assertEquals(62, Seleccion.umbral(50, 12))
        assertEquals(2, Seleccion.marcadosSinRegla(l, emptyMap(), 50, 12))
        assertEquals(1, Seleccion.marcadosSinRegla(l, mapOf("a@x.com" to "protect"), 50, 12))
        assertTrue(Seleccion.umbral(0, 12) > 100)
    }

    @Test fun domainRowsOnlyForTwoOrMoreSendersBiggestFirst() {
        val l = listOf(sd("a@tienda.com", 90, count = 30), sd("b@news.tienda.com", 40, count = 5), sd("solo@otra.com", 10, count = 50), sd("z@banco.com.gt", 70, count = 2))
        val f = Seleccion.filas(l)
        assertEquals(3, f.size)
        assertEquals("solo@otra.com", (f[0] as FilaLimpiar.Suelto).remitente.email)
        val d = f[1] as FilaLimpiar.Dominio
        assertEquals("tienda.com", d.dominio); assertEquals(35, d.correos); assertEquals(90, d.ruido)
        assertTrue(f[2] is FilaLimpiar.Suelto)
    }

    @Test fun domainStateShowsMixedExceptionsAndTheDomainRule() {
        val d = FilaLimpiar.Dominio("tienda.com", listOf(sd("a@tienda.com", 90), sd("b@tienda.com", 90), sd("c@tienda.com", 90)))
        assertEquals(EstadoDominio(true, null, 0), Seleccion.estadoDominio(d, emptyMap(), 50, 12))
        val mixto = Seleccion.estadoDominio(d, mapOf("a@tienda.com" to "protect"), 50, 12)
        assertNull(mixto.elimina); assertEquals(0, mixto.excepciones)
        val reg = mapOf("@tienda.com" to "delete", "a@tienda.com" to "protect")
        assertEquals(EstadoDominio(null, "delete", 1), Seleccion.estadoDominio(d, reg, 50, 12))
        assertEquals(EstadoDominio(false, "protect", 0), Seleccion.estadoDominio(d, mapOf("@tienda.com" to "protect"), 50, 12))
    }
}
