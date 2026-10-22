package com.nonosky.nonimailtools.core.ia

import com.nonosky.nonimailtools.core.Defaults
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelosTest {
    private val cfg = Defaults.instance.localAi
    private val gb = 1024L * 1024 * 1024

    @Test fun recomiendaElMayorQueCabe() {
        assertEquals("basico", Recomendador.recomendar(cfg, 3 * gb, 50 * gb).id)    // gama baja
        assertEquals("mediano", Recomendador.recomendar(cfg, 8 * gb, 50 * gb).id)   // gama media/alta
        assertEquals("grande", Recomendador.recomendar(cfg, 16 * gb, 50 * gb).id)   // tope de gama
        assertEquals("basico", Recomendador.recomendar(cfg, 16 * gb, 2 * gb).id)    // sin espacio
    }

    @Test fun progresoDeDescarga() {
        assertEquals("37% (210 / 567 MB)", ProgresoDescarga.texto(210L * 1024 * 1024, 567L * 1024 * 1024))
        assertEquals("0% (0 / 0 MB)", ProgresoDescarga.texto(0, 0))
        assertEquals(ProgresoDescarga.Rango(100, 999, 1000), ProgresoDescarga.parseContentRange("bytes 100-999/1000"))
        assertNull(ProgresoDescarga.parseContentRange("bytes */1000"))
    }
}
