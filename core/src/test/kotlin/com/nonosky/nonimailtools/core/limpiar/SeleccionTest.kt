package com.nonosky.nonimailtools.core.limpiar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
}
