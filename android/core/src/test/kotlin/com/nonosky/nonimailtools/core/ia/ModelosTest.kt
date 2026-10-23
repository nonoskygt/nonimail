package com.nonosky.nonimailtools.core.ia

import com.nonosky.nonimailtools.core.Defaults
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelosTest {
    private val cfg = Defaults.instance.localAi
    private val gb = 1024L * 1024 * 1024

    @Test fun unSoloModeloProbado() {
        assertEquals(listOf("basico"), cfg.models.map { it.id })                  // solo Gemma 4 E2B (24/24 en nuestro banco)
        assertEquals("basico", Recomendador.recomendar(cfg, 3 * gb, 50 * gb).id)
        assertEquals("basico", Recomendador.recomendar(cfg, 16 * gb, 2 * gb).id)
    }

    @Test fun progresoDeDescarga() {
        assertEquals("37% (210 / 567 MB)", ProgresoDescarga.texto(210L * 1024 * 1024, 567L * 1024 * 1024))
        assertEquals("0% (0 / 0 MB)", ProgresoDescarga.texto(0, 0))
        assertEquals(ProgresoDescarga.Rango(100, 999, 1000), ProgresoDescarga.parseContentRange("bytes 100-999/1000"))
        assertNull(ProgresoDescarga.parseContentRange("bytes */1000"))
    }
}
