package com.nonosky.nonimailtools

import com.nonosky.nonimailtools.ui.theme.Acento
import com.nonosky.nonimailtools.ui.theme.AcentoActivo
import com.nonosky.nonimailtools.ui.theme.Modo
import com.nonosky.nonimailtools.ui.theme.Superficies
import com.nonosky.nonimailtools.ui.theme.contraste
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TemaTest {
    private val blanco = 0xFFFFFFFF.toInt()

    @Test fun autoFollowsTheClock() {
        for (h in 0..5) assertTrue("hour $h", Modo.esOscuro(Modo.AUTO, h))
        for (h in 6..17) assertFalse("hour $h", Modo.esOscuro(Modo.AUTO, h))
        for (h in 18..23) assertTrue("hour $h", Modo.esOscuro(Modo.AUTO, h))
    }

    @Test fun explicitModesIgnoreTheClock() {
        assertFalse(Modo.esOscuro(Modo.CLARO, 3)); assertTrue(Modo.esOscuro(Modo.OSCURO, 12))
    }

    @Test fun defaultsAreAutoAndCrimson() {
        assertEquals(Modo.AUTO, Modo.of(null)); assertEquals(Modo.AUTO, Modo.of("raro"))
        assertEquals("carmesi", Acento.of(null).id); assertEquals("carmesi", Acento.of("nada").id)
    }

    @Test fun sixAccentPresetsWithTheSpecValues() {
        assertEquals(listOf("carmesi", "verde-azulado", "violeta", "azul", "ambar", "verde"), Acento.Todos.map { it.id })
        val c = Acento.of("carmesi")
        assertEquals(0xFFB8283F.toInt(), c.claro); assertEquals(0xFF9E2135.toInt(), c.claroPress)
        assertEquals(0xFFEA7A8F.toInt(), c.oscuroTexto); assertEquals(0xFFB8364E.toInt(), c.oscuroRelleno)
    }

    @Test fun surfaceTokensMatchTheSpec() {
        assertEquals(0xFFF3F0E9.toInt(), Superficies.Claro.bg); assertEquals(0xFFFCFBF8.toInt(), Superficies.Claro.panel)
        assertEquals(0xFF27241F.toInt(), Superficies.Claro.text); assertEquals(0xFFB42318.toInt(), Superficies.Claro.red)
        assertEquals(0xFF1A1E25.toInt(), Superficies.Oscuro.bg); assertEquals(0xFF21262E.toInt(), Superficies.Oscuro.panel)
        assertEquals(0xFFEBE7DF.toInt(), Superficies.Oscuro.text)
    }

    @Test fun inkContrastIsAtLeastAA() {
        for (s in listOf(Superficies.Claro, Superficies.Oscuro)) {
            for (fondo in listOf(s.bg, s.panel)) {
                assertTrue(contraste(s.text, fondo) >= 4.5)
                assertTrue(contraste(s.muted, fondo) >= 4.5)
            }
        }
    }

    @Test fun accentTextAndWhiteOnFillPassAA() {
        for (s in listOf(Superficies.Claro, Superficies.Oscuro)) for (a in Acento.Todos) {
            val v = AcentoActivo.de(a, s)
            val nombre = "${a.id}/${if (s.oscuro) "oscuro" else "claro"}"
            assertTrue("$nombre text on panel ${contraste(v.texto, s.panel)}", contraste(v.texto, s.panel) >= 4.5)
            assertTrue("$nombre text on bg ${contraste(v.texto, s.bg)}", contraste(v.texto, s.bg) >= 4.5)
            assertTrue("$nombre white on fill ${contraste(blanco, v.relleno)}", contraste(blanco, v.relleno) >= 4.5)
        }
    }
}
