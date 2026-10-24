package com.nonosky.nonimailtools.core.limpiar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as `escritorio/test/reglas-sync.test.js`. */
class ReglasTest {
    private fun rf(r: String, ts: Long) = ReglaFecha(r, ts)

    @Test fun dominioAgrupaPorEmpresaYPorSegundoNivel() {
        assertEquals("tienda.com", Reglas.dominio("a@mail.tienda.com"))
        assertEquals("banco.com.gt", Reglas.dominio("A@Promo.Banco.com.gt"))
        assertEquals("bbc.co.uk", Reglas.dominio("x@bbc.co.uk"))
        assertEquals("empresa.com", Reglas.dominio("x@empresa.com"))
        assertEquals("gob.mx", Reglas.dominio("x@gob.mx"))
        assertEquals("tienda.io", Reglas.dominio("x@a.b.tienda.io"))
        assertEquals("", Reglas.dominio("sin-arroba"))
    }

    @Test fun reglaDelRemitenteMandaSobreLaDelDominio() {
        val reglas = mapOf("@tienda.com" to "delete", "amiga@tienda.com" to "protect")
        assertEquals("delete", Reglas.reglaDe(reglas, "ofertas@tienda.com"))
        assertEquals("delete", Reglas.reglaDe(reglas, "Ofertas@News.Tienda.com"))
        assertEquals("protect", Reglas.reglaDe(reglas, "amiga@tienda.com"))
        assertNull(Reglas.reglaDe(reglas, "otro@otra.com"))
    }

    @Test fun fusionarGanaLaMasReciente() {
        val r = SincronizadorReglas.fusionar(
            mapOf("a@x.com" to rf("protect", 10), "b@x.com" to rf("delete", 50), "c@x.com" to rf("none", 30)),
            mapOf("a@x.com" to rf("delete", 20), "b@x.com" to rf("none", 40), "d@x.com" to rf("protect", 5)),
        )
        assertEquals(rf("delete", 20), r.resultado["a@x.com"])
        assertEquals(rf("delete", 50), r.resultado["b@x.com"])
        assertEquals(listOf("a@x.com", "d@x.com"), r.cambiaLocal.sorted())
        assertEquals(listOf("b@x.com", "c@x.com"), r.cambiaRemoto.sorted())
        assertTrue("una regla invalida se ignora", SincronizadorReglas.fusionar(mapOf("a@x.com" to rf("basura", 1)), emptyMap()).resultado.isEmpty())
    }

    @Test fun conGuardaConFechaYQuitarEsNone() {
        var l = LibroReglas().con(mapOf("a@x.com" to "protect"), 100)
        assertEquals(mapOf("a@x.com" to "protect"), l.vigentes)
        l = l.con(mapOf("a@x.com" to "none"), 200)
        assertTrue(l.vigentes.isEmpty())
        assertEquals(rf("none", 200), l.entradas["a@x.com"])
        assertEquals(l, LibroReglas.leer(l.escribir()))
        assertTrue(LibroReglas.leer("no es json").entradas.isEmpty())
    }

    @Test fun remitenteIgualAlDominioNoCreaExcepcion() {
        val l = LibroReglas().con(mapOf("@tienda.com" to "delete"), 1)
        assertEquals(mapOf("a@tienda.com" to "none"), l.cambiosRemitente("A@tienda.com", "delete"))
        assertEquals(mapOf("a@tienda.com" to "protect"), l.cambiosRemitente("a@tienda.com", "protect"))
        assertEquals(mapOf("a@otra.com" to "delete"), l.cambiosRemitente("a@otra.com", "delete"))
    }

    @Test fun reglaDeDominioBorraLasExcepciones() {
        val l = LibroReglas().con(mapOf("amiga@tienda.com" to "protect", "otro@banco.com" to "protect", "@tienda.com" to "protect"), 1)
        val c = l.cambiosDominio("@Tienda.com", "delete")
        assertEquals(mapOf("@tienda.com" to "delete", "amiga@tienda.com" to "none"), c)
        val despues = l.con(c, 2).vigentes
        assertEquals(mapOf("otro@banco.com" to "protect", "@tienda.com" to "delete"), despues)
    }

    // ---- sync ----

    private class Remoto(var datos: Map<String, ReglaFecha>, val sesion: Boolean = true, val status: Int = 200) : ReglasRemoto {
        var gets = 0
        val puts = ArrayList<Map<String, ReglaFecha>>()
        override val haySesion get() = sesion
        override fun leer(): RespuestaReglas { gets++; return RespuestaReglas(status, datos) }
        override fun escribir(entradas: Map<String, ReglaFecha>): RespuestaReglas { puts += entradas; datos = entradas; return RespuestaReglas(200) }
    }

    private class Almacen(var datos: Map<String, ReglaFecha> = emptyMap()) : AlmacenReglas {
        override fun leer() = datos
        override fun fusionar(remoto: Map<String, ReglaFecha>): Fusion =
            SincronizadorReglas.fusionar(datos, remoto).also { datos = it.resultado }
    }

    @Test fun syncTraeLasDelPerfilEnviaLasLocalesYLasDosPartesTerminanIguales() {
        val remoto = Remoto(mapOf("web@x.com" to rf("delete", 100)))
        val a = Almacen(mapOf("pc@x.com" to rf("protect", 200)))
        assertEquals(ResultadoSyncReglas.Hecho(1, 1), SincronizadorReglas.sincronizar(a, remoto))
        assertEquals(rf("delete", 100), a.datos["web@x.com"])
        assertEquals(rf("protect", 200), remoto.datos["pc@x.com"])
        // second phone, empty: receives everything and sends nothing
        val b = Almacen()
        assertEquals(ResultadoSyncReglas.Hecho(2, 0), SincronizadorReglas.sincronizar(b, remoto))
        assertEquals(a.datos, b.datos)
        assertEquals(1, remoto.puts.size)
    }

    @Test fun syncSinSesionNoLlamaYSinServicioLasLocalesSiguenIntactas() {
        val sin = Remoto(emptyMap(), sesion = false)
        val a = Almacen(mapOf("a@x.com" to rf("delete", 5)))
        assertEquals(ResultadoSyncReglas.SinSesion, SincronizadorReglas.sincronizar(a, sin))
        assertEquals(0, sin.gets)
        for (st in listOf(404, 501)) {
            val caido = Remoto(emptyMap(), status = st)
            assertEquals(ResultadoSyncReglas.SinServicio, SincronizadorReglas.sincronizar(a, caido))
            assertTrue(caido.puts.isEmpty())
        }
        assertEquals(rf("delete", 5), a.datos["a@x.com"])
    }

    @Test fun syncMarcaSesionVencidaYErrores() {
        assertEquals(ResultadoSyncReglas.SesionVencida, SincronizadorReglas.sincronizar(Almacen(), Remoto(emptyMap(), status = 401)))
        assertEquals(ResultadoSyncReglas.SesionVencida, SincronizadorReglas.sincronizar(Almacen(), Remoto(emptyMap(), status = 403)))
        assertTrue(SincronizadorReglas.sincronizar(Almacen(), Remoto(emptyMap(), status = 500)) is ResultadoSyncReglas.Error)
    }

    @Test fun jsonDelContrato() {
        val body = ReglasJson.cuerpoPut(mapOf("@tienda.com" to rf("delete", 7)))
        assertEquals("""{"reglas":{"@tienda.com":{"regla":"delete","ts":7}}}""", body.toString())
        val txt = kotlinx.serialization.json.Json.parseToJsonElement("""{"reglas":{"A@X.com":{"regla":"protect","ts":9},"b@x.com":{"regla":"zzz","ts":1}}}""")
        assertEquals(mapOf("a@x.com" to rf("protect", 9)), ReglasJson.deRespuesta(txt as kotlinx.serialization.json.JsonObject))
    }
}
