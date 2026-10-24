package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.telemetria.Outcome
import com.nonosky.nonimailtools.core.telemetria.Poster
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/** Mirrors `escritorio/test/filtro.test.js`. */
class FiltroTest {
    @get:Rule val tmp = TemporaryFolder()
    private val cfg = Defaults.instance.filtro

    private fun s(email: String, score: Int, unsub: Boolean = false, count: Int = 14, reason: Reason = Reason.MASIVO) =
        SenderScore(email, email, count, 0, emptyList(), unsub, unsub, score, reason, score)

    @Test fun calificaSoloMasivosDeDominioPropioYCorrigioComparaConElMotor() {
        assertTrue(Filtro.califica("ofertas@tienda.com", true))
        assertTrue(Filtro.califica("noreply@banco.com.gt", false))
        assertFalse("persona sin baja ni patron", Filtro.califica("ana@amiga.com", false))
        assertFalse("dominio publico", Filtro.califica("noreply@gmail.com", true))
        assertFalse(Filtro.califica("x@hotmail.es", true))
        assertEquals("tienda.com.gt", Filtro.dominioRegistrable("A@News.Tienda.com.gt"))
        assertTrue(Filtro.corrigio("conservar", 70)); assertFalse(Filtro.corrigio("nunca", 69))
        assertTrue(Filtro.corrigio("eliminar", 30)); assertFalse(Filtro.corrigio("baja", 31))
        assertFalse(Filtro.corrigio("eliminar", null))
    }

    @Test fun unaDecisionPorDominioGanaLaMasFuerte() {
        val l = Filtro.armarDecisiones(
            listOf(
                Filtro.Remitente(s("noreply@tienda.com", 92, true, 14, Reason.IA), "conservar", listOf("subject")),
                Filtro.Remitente(s("promo@news.tienda.com", 80, true, 6), "baja", listOf("from")),
                Filtro.Remitente(s("ana@amiga.com", 5), "conservar"),
            ),
        )
        assertEquals(1, l.size)
        val d = l[0]
        assertEquals("tienda.com", d.dominio); assertEquals("baja", d.decision)
        assertEquals(Filtro.Senales(true, true, listOf("subject", "from"), 92, 20), d.senales)
        assertFalse(d.corrigio)
    }

    @Test fun cuerpoDeLasDecisionesOmiteLlmVacioYSigueElContrato() {
        val dir = tmp.newFolder()
        val cola = ColaDecisiones(java.io.File(dir, "c.jsonl"), 3)
        cola.add(Filtro.armarDecisiones(listOf(Filtro.Remitente(s("noreply@a.com", 50, false), "eliminar"))))
        val cuerpos = ArrayList<String>()
        val env = EnviadorDecisiones(cola, Poster { _, b, _ -> cuerpos += b; 200 }, "https://x/api/filtro/v1/decisiones", "iid", "android", "1.6.0", "ua", 500)
        assertEquals(Outcome.SENT, env.enviar())
        assertEquals(1, cuerpos.size)
        val o = Json.parseToJsonElement(cuerpos[0]).jsonObject
        assertEquals("iid", o["install_id"].toString().trim('"')); assertEquals("android", o["app"].toString().trim('"'))
        assertTrue(""""decisiones":[{"dominio":"a.com","senales":{"baja":false,"noreply":true,"reglas":[],"correos":14},"decision":"eliminar","corrigio":false}]""" in cuerpos[0])
        assertTrue(cola.all().isEmpty())
    }

    @Test fun colaSeRecortaYReintentaConCincoCientos() {
        val cola = ColaDecisiones(tmp.newFile(), 2)
        val mk = { d: String -> Filtro.Decision(d, Filtro.Senales(true, false, emptyList(), null, 1), "eliminar", false) }
        cola.add(listOf(mk("a.com"), mk("b.com"), mk("c.com")))
        assertEquals(listOf("b.com", "c.com"), cola.all().map { it.dominio })
        assertEquals(Outcome.RETRY, EnviadorDecisiones(cola, Poster { _, _, _ -> 503 }, "u", "i", "android", "1", "ua", 500).enviar())
        assertEquals(2, cola.all().size)
        assertEquals(Outcome.RETRY, EnviadorDecisiones(cola, Poster { _, _, _ -> throw IOException("sin red") }, "u", "i", "android", "1", "ua", 500).enviar())
        assertEquals(Outcome.SENT, EnviadorDecisiones(cola, Poster { _, _, _ -> 400 }, "u", "i", "android", "1", "ua", 500).enviar())
        assertTrue("4xx descarta", cola.all().isEmpty())
    }

    // ---- signed reputation ----

    private val par = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val pub: ByteArray = par.public.encoded.takeLast(32).toByteArray()

    private fun firmar(base: String): String {
        val sig = Signature.getInstance("Ed25519").apply { initSign(par.private); update((Filtro.PREFIJO_FIRMA + Filtro.canonico(Json.parseToJsonElement(base))).toByteArray(Charsets.UTF_8)) }.sign()
        return Json.parseToJsonElement(base).jsonObject.let { o -> o.toString().dropLast(1) + ""","firma":"${Base64.getUrlEncoder().withoutPadding().encodeToString(sig)}"}""" }
    }

    private val base = """{"v":1,"generado":"2026-10-22T00:00:00Z","dominios":{"tiendamoda.com":{"eliminar_pct":94,"n":37},"ñandú.gt":{"n":12,"eliminar_pct":3},"dudoso.com":{"eliminar_pct":50,"n":99},"poco.com":{"eliminar_pct":99,"n":3}}}"""

    @Test fun canonicoOrdenaClavesYNoEscapaNoAscii() {
        assertEquals(
            """{"dominios":{"tiendamoda.com":{"eliminar_pct":94,"n":37},"ñandú.gt":{"eliminar_pct":3,"n":12}},"generado":"2026-10-22T00:00:00Z","v":1}""",
            Filtro.canonico(Json.parseToJsonElement("""{"v":1,"generado":"2026-10-22T00:00:00Z","dominios":{"tiendamoda.com":{"eliminar_pct":94,"n":37},"ñandú.gt":{"n":12,"eliminar_pct":3}}}""")),
        )
        assertEquals("""{"a":"x\"y\\\n\u0001"}""", Filtro.canonico(Json.parseToJsonElement("""{"a":"x\"y\\\n\u0001"}""")))
    }

    @Test fun firmaValidaAlteradaYDeOtraClave() {
        val doc = firmar(base)
        assertNotNull(Reputacion.leer(doc, pub))
        assertNull("alterada", Reputacion.leer(doc.replace("\"eliminar_pct\":94", "\"eliminar_pct\":10"), pub))
        val otra = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().public.encoded.takeLast(32).toByteArray()
        assertNull(Reputacion.leer(doc, otra))
        assertNull("sin clave", Reputacion.leer(doc, null))
        assertNull("sin firma", Reputacion.leer(base, pub))
    }

    @Test fun veredictoSoloConMuestrasSuficientesYExtremos() {
        val rep = Reputacion.leer(firmar(base), pub)!!
        assertEquals(Filtro.Veredicto(95, true, 94), rep.veredicto("news@promo.tiendamoda.com", cfg))
        assertEquals(Filtro.Veredicto(5, false, 3), rep.veredicto("x@ñandú.gt", cfg))
        assertNull("en el medio no decide", rep.veredicto("x@dudoso.com", cfg))
        assertNull("n < minN", rep.veredicto("x@poco.com", cfg))
        assertNull("dominio desconocido", rep.veredicto("x@nada.com", cfg))
    }
}
