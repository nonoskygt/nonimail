package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.IaNonoskyDefaults
import com.nonosky.nonimailtools.core.servicio.RespuestaHttp
import com.nonosky.nonimailtools.core.servicio.Transporte
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/** «IA de Nonosky»: batches, trimming, category mapping and the failures that leave the heuristics. */
class IaNonoskyTest {
    private val limites = IaNonoskyDefaults(path = "/api/ia/v1/clasificar", maxItems = 50, maxSubjects = 5, maxChars = 200, timeoutMs = 1000)
    private val puntajes = mapOf("PERSONAL" to 3, "TRANSACCION" to 10, "PROMOCION" to 95)

    private class Falso(val responder: (Int, List<String>) -> RespuestaHttp) : Transporte {
        val pedidos = ArrayList<Pair<String, String>>()
        val tokens = ArrayList<String?>()
        override fun pedir(metodo: String, url: String, cuerpo: String?, token: String?, timeoutMs: Int): RespuestaHttp {
            pedidos += url to cuerpo.orEmpty(); tokens += token
            val ids = Json.parseToJsonElement(cuerpo!!).jsonObject["items"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }
            return responder(pedidos.size, ids)
        }
    }

    private fun items(n: Int) = (1..n).map { IaNonosky.Item("r$it@x.com", "R$it <r$it@x.com>", listOf("Oferta $it"), true) }
    private fun fila(id: String, c: String?): String {
        val valor = if (c == null) "null" else "\"" + c + "\""
        return "{\"id\":\"" + id + "\",\"categoria\":" + valor + "}"
    }

    private fun respuesta(ids: List<String>, cat: (String) -> String?): RespuestaHttp {
        val filas = ids.joinToString(",") { fila(it, cat(it)) }
        return RespuestaHttp(200, "{\"modelo\":\"m\",\"resultados\":[" + filas + "]}")
    }

    @Test fun lotesDe50ConElTokenDeLaSesion() {
        val http = Falso { _, ids -> respuesta(ids) { "PROMOCION" } }
        val r = IaNonosky("https://servicio.example/", limites, { "tok" }, http).clasificar(items(120))
        assertEquals(3, http.pedidos.size)                       // 50 + 50 + 20
        assertEquals("https://servicio.example/api/ia/v1/clasificar", http.pedidos[0].first)
        assertEquals(listOf("tok", "tok", "tok"), http.tokens)
        assertEquals(120, r.categorias.size)
        assertNull(r.fallo); assertEquals("m", r.modelo)
    }

    @Test fun recortaAsuntosYNuncaMandaElCuerpo() {
        val largo = "x".repeat(300)
        val ia = IaNonosky("https://s.example", limites, { "t" }, Falso { _, ids -> respuesta(ids) { null } })
        val cuerpo = Json.parseToJsonElement(ia.cuerpo(listOf(IaNonosky.Item("a@x.com", "A <a@x.com>", List(8) { largo }, false)))).jsonObject
        val item = cuerpo["items"]!!.jsonArray[0].jsonObject
        val asuntos = item["subjects"]!!.jsonArray
        assertEquals(5, asuntos.size)
        assertTrue(asuntos.all { it.jsonPrimitive.content.length == 200 })
        assertEquals(setOf("id", "from", "subjects", "bulk"), item.keys)
    }

    @Test fun categoriaAPuntajeYNullDejaLaHeuristica() {
        val http = Falso { _, ids -> respuesta(ids) { id -> if (id.startsWith("r1@")) "promocion" else if (id.startsWith("r2@")) null else "RARA" } }
        val r = IaNonosky("https://s.example", limites, { "t" }, http).clasificar(items(3))
        assertEquals("PROMOCION", r.categorias["r1@x.com"])
        assertEquals(95, IaNonosky.puntaje(r.categorias["r1@x.com"], puntajes))
        assertTrue(r.categorias.containsKey("r2@x.com")); assertNull(IaNonosky.puntaje(r.categorias["r2@x.com"], puntajes))
        assertNull(IaNonosky.puntaje(r.categorias["r3@x.com"], puntajes)) // unknown word: heuristics
    }

    @Test fun fallosParanSinExcepcionYGuardanLoYaClasificado() {
        for ((st, motivo) in listOf(402 to IaNonosky.Motivo.SIN_SUSCRIPCION, 429 to IaNonosky.Motivo.TOPE_DIARIO, 503 to IaNonosky.Motivo.NO_DISPONIBLE, 401 to IaNonosky.Motivo.SESION)) {
            val http = Falso { n, ids -> if (n == 1) respuesta(ids) { "PERSONAL" } else RespuestaHttp(st, """{"codigo":"x"}""") }
            val r = IaNonosky("https://s.example", limites, { "t" }, http).clasificar(items(120))
            assertEquals(motivo, r.fallo)
            assertEquals(2, http.pedidos.size)                   // stops at the failed batch
            assertEquals(50, r.categorias.size)                   // the first batch is kept
        }
        val sinRed = IaNonosky("https://s.example", limites, { "t" }, Transporte { _, _, _, _, _ -> throw IOException("sin red") }).clasificar(items(2))
        assertEquals(IaNonosky.Motivo.SIN_RED, sinRed.fallo)
        val sinSesion = Falso { _, ids -> respuesta(ids) { "PERSONAL" } }
        assertEquals(IaNonosky.Motivo.SESION, IaNonosky("https://s.example", limites, { null }, sinSesion).clasificar(items(2)).fallo)
        assertFalse(sinSesion.pedidos.isNotEmpty())
        assertEquals(IaNonosky.Motivo.OTRO, IaNonosky("https://s.example", limites, { "t" }, Falso { _, _ -> RespuestaHttp(200, "no es json") }).clasificar(items(1)).fallo)
    }
}
