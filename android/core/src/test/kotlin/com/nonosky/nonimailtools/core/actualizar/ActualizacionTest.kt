package com.nonosky.nonimailtools.core.actualizar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ActualizacionTest {
    @Test fun comparaVersionesComoSemver() {
        assertTrue(Version.esMasNueva("v1.2.0", "1.1.0"))
        assertTrue(Version.esMasNueva("1.10.0", "1.9.9"))      // numérico, no de texto
        assertFalse(Version.esMasNueva("1.1.0", "1.1.0"))      // igual
        assertFalse(Version.esMasNueva("1.0.9", "1.1.0"))      // más vieja
        assertTrue(Version.esMasNueva("1.2.0", "1.2.0-rc.1"))  // la final gana a la preliminar
        assertFalse(Version.esMasNueva("1.2.0-rc.1", "1.2.0"))
        assertTrue(Version.esMasNueva("1.2.0-rc.2", "1.2.0-rc.1"))
        assertFalse(Version.esMasNueva("basura", "1.1.0"))     // ilegible: nunca es más nueva
        assertNull(Version.parse("1.x.0"))
        assertEquals("1.2.0", Version.parse("v1.2+build5").toString())
    }

    private fun decidir(
        remota: String? = "1.2.0", auto: Boolean = true, pedida: Boolean = false,
        listo: Boolean = false, ocupada: Boolean = false, visible: Boolean = false,
    ) = Actualizador.decidir("1.1.0", remota, auto, pedida, listo, ocupada, visible)

    @Test fun decideQueHacer() {
        assertEquals(Accion.DESCARGAR, decidir())                                   // más nueva
        assertEquals(Accion.NADA, decidir(remota = "1.1.0"))                        // igual
        assertEquals(Accion.NADA, decidir(remota = "1.0.0", listo = true))          // más vieja
        assertEquals(Accion.NADA, decidir(remota = null))                           // sin dato
        assertEquals(Accion.NADA, decidir(auto = false))                            // interruptor apagado
        assertEquals(Accion.DESCARGAR, decidir(auto = false, pedida = true))        // pero la persona la pidió
        assertEquals(Accion.INSTALAR_SILENCIOSO, decidir(listo = true))             // lista y en segundo plano
        assertEquals(Accion.AVISAR, decidir(listo = true, visible = true))          // a la vista: aviso, un toque
        assertEquals(Accion.AVISAR, decidir(listo = true, auto = false))            // apagado: nunca en silencio
        assertEquals(Accion.ESPERAR, decidir(listo = true, ocupada = true))         // sincronizando o limpiando
        assertEquals(Accion.ESPERAR, decidir(listo = true, ocupada = true, visible = true))
    }

    @Test fun leeElLanzamientoYLasSumas() {
        val json = """{"tag_name":"v1.2.0","draft":false,"prerelease":false,"assets":[
          {"name":"NoniMail-Tools.apk","browser_download_url":"https://github.com/x/y/releases/download/v1.2.0/NoniMail-Tools.apk","size":123},
          {"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/x/y/releases/download/v1.2.0/SHA256SUMS.txt","size":9}]}"""
        val l = Lanzamientos.parse(json, "NoniMail-Tools.apk", "SHA256SUMS.txt")!!
        assertEquals("1.2.0", l.version.toString()); assertEquals(123L, l.apkBytes)
        assertNull(Lanzamientos.parse(json.replace("SHA256SUMS.txt", "otro.txt"), "NoniMail-Tools.apk", "SHA256SUMS.txt"))
        assertNull(Lanzamientos.parse(json.replace("\"prerelease\":false", "\"prerelease\":true"), "NoniMail-Tools.apk", "SHA256SUMS.txt"))
        val h = "a".repeat(64); val h2 = "B".repeat(64)
        val sumas = "$h2  NoniMail-Tools-1.2.0.apk\n$h *NoniMail-Tools.apk\n"
        assertEquals(h, Sumas.buscar(sumas, "NoniMail-Tools.apk"))
        assertNull(Sumas.buscar(sumas, "falta.apk"))
    }
}
