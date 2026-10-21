package com.nonosky.nonimailtools.core.telemetria

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

class TelemetriaTest {
    @get:Rule val tmp = TemporaryFolder()
    private val own = listOf("ana@empresa.com")

    @Test fun scrubKeepsOwnAccountsAndMasksOthers() {
        val s = Depurador.scrub("fallo ana@empresa.com y bob@otro.org", own)
        assertTrue("ana@empresa.com" in s); assertFalse("bob@otro.org" in s)
    }

    @Test fun scrubRemovesPasswordsTokensAndKeys() {
        val key = "NMT1.eyJ2IjoxfQ.c2lnbmF0dXJl"
        val s = Depurador.scrub(
            "password=Sup3rSecreta! token: abc123 Authorization: Bearer abcdef123456 a LOGIN ana@empresa.com \"miClave\" $key " +
                "clave-suelta-xyz789",
            own, secrets = listOf("clave-suelta-xyz789"),
        )
        for (leak in listOf("Sup3rSecreta", "abc123", "abcdef123456", "miClave", "c2lnbmF0dXJl", "clave-suelta-xyz789", "eyJ2IjoxfQ")) {
            assertFalse("leaked $leak in $s", leak in s)
        }
    }

    @Test fun scrubMasksLongOpaqueTokens() {
        val s = Depurador.scrub("x " + "A".repeat(40) + " y", own)
        assertFalse("AAAAAAAA" in s)
    }

    @Test fun errorEventIsScrubbedAndCapped() {
        val e = Telemetria.error("no entra bob@otro.org pass=hunter22", "at foo.Bar(x) ".repeat(900), "limpiar", "Ana@Empresa.com", own)
        val d = e.datos
        assertFalse("bob@otro.org" in d["mensaje"]!!.jsonPrimitive.content)
        assertFalse("hunter22" in d["mensaje"]!!.jsonPrimitive.content)
        assertEquals(Telemetria.MAX_STACK, d["pila"]!!.jsonPrimitive.content.length)
        assertEquals("ana@empresa.com", d["cuenta"]!!.jsonPrimitive.content)
        assertEquals("error", e.tipo)
    }

    @Test fun installBodyMatchesContract() {
        val j = Json.parseToJsonElement(
            Telemetria.installBody(Instalacion("id", "android", "1.0.0", "android", "14 (API 34)", "arm64", "es-GT", "America/Guatemala", "github", true, null)),
        ).jsonObject
        assertEquals(
            setOf("install_id", "app", "version", "os", "os_version", "arch", "locale", "zona_horaria", "origen_descarga", "ia_local", "modelo"),
            j.keys,
        )
        assertEquals("android", j["app"]!!.jsonPrimitive.content)
    }

    @Test fun eventsOmitNotApplicableFields() {
        val e = Telemetria.limpiar("a@b.com", "escaneo", true, 10, 3, null, 5, "ok", false)
        assertFalse("movidos" in e.datos)
        assertEquals(setOf("cuenta", "fase", "dry_run", "revisados", "remitentes", "duracion_s", "resultado", "licencia"), e.datos.keys)
    }

    @Test fun userAgentAndArch() {
        assertEquals("NoniMailTools/1.0.0 (android; arm64)", Telemetria.userAgent("1.0.0", "android", Telemetria.archName("arm64-v8a")))
        assertEquals("x64", Telemetria.archName("x86_64"))
    }

    private fun ev(i: Int, pad: Int = 0) = Evento("2026-10-21T00:00:00Z", "inicio", buildJsonObject {
        put("n", i); if (pad > 0) put("p", "x".repeat(pad))
    })

    @Test fun batchesRespectEventAndByteLimits() {
        val body = { l: List<Evento> -> Telemetria.eventsBody("i", "android", "1", l) }
        val b = Telemetria.batches((1..450).map { ev(it) }, body)
        assertEquals(listOf(200, 200, 50), b.batches.map { it.size })
        // 100 KB events: two fit in 256 KB, the third starts a new batch; a 300 KB event is dropped.
        val big = Telemetria.batches(listOf(ev(1, 100_000), ev(2, 100_000), ev(3, 100_000), ev(4, 300_000)), body)
        assertEquals(listOf(2, 1), big.batches.map { it.size })
        assertEquals(1, big.oversized.size)
        assertTrue(big.batches.all { body(it).toByteArray().size <= Telemetria.MAX_BODY_BYTES })
    }

    @Test fun queueKeepsAtMost500DroppingOldest() {
        val q = ColaEventos(tmp.newFile("q.jsonl"))
        q.addAll((1..520).map { ev(it) })
        assertEquals(500, q.size())
        assertEquals("21", q.all().first().datos["n"]!!.jsonPrimitive.content)
        q.removeFirst(10)
        assertEquals(490, q.size())
    }

    private class FakePoster(val codes: MutableList<Int>, val fail: Boolean = false) : Poster {
        val calls = mutableListOf<Pair<String, String>>()
        override fun post(url: String, body: String, userAgent: String): Int {
            calls += url to body
            if (fail) throw IOException("sin red")
            return if (codes.size > 1) codes.removeAt(0) else codes[0]
        }
    }

    private fun sender(q: ColaEventos, p: Poster) = Enviador(q, p, "https://mt.nonosky.com/", "iid", "android", "1.0.0", "ua")

    @Test fun okClearsTheQueueAndHitsTheRightUrl() {
        val q = ColaEventos(tmp.newFile("a.jsonl")); q.addAll((1..250).map { ev(it) })
        val p = FakePoster(mutableListOf(200))
        assertEquals(Outcome.SENT, sender(q, p).flushEvents())
        assertEquals(0, q.size()); assertEquals(2, p.calls.size)
        assertEquals("https://mt.nonosky.com/api/telemetria/v1/eventos", p.calls[0].first)
    }

    @Test fun clientErrorDropsTheBatchWithoutRetry() {
        val q = ColaEventos(tmp.newFile("b.jsonl")); q.addAll((1..5).map { ev(it) })
        assertEquals(Outcome.SENT, sender(q, FakePoster(mutableListOf(422))).flushEvents())
        assertEquals(0, q.size())
    }

    @Test fun serverErrorAndNoNetworkKeepTheQueue() {
        val q = ColaEventos(tmp.newFile("c.jsonl")); q.addAll((1..5).map { ev(it) })
        assertEquals(Outcome.RETRY, sender(q, FakePoster(mutableListOf(503))).flushEvents())
        assertEquals(5, q.size())
        assertEquals(Outcome.RETRY, sender(q, FakePoster(mutableListOf(200), fail = true)).flushEvents())
        assertEquals(5, q.size())
        assertEquals(Outcome.RETRY, sender(q, FakePoster(mutableListOf(200), fail = true)).sendInstall(
            Instalacion("i", "android", "1", "android", "14", "arm64", "es", "UTC", "desconocido", false, null),
        ))
    }

    @Test fun oversizedHeadEventDoesNotBlockTheQueue() {
        val q = ColaEventos(tmp.newFile("d.jsonl")); q.addAll(listOf(ev(1, 300_000), ev(2)))
        val p = FakePoster(mutableListOf(200))
        assertEquals(Outcome.SENT, sender(q, p).flushEvents())
        assertEquals(0, q.size()); assertEquals(1, p.calls.size)
    }

    @Test fun installDueRules() {
        assertTrue(Telemetria.installDue(0, null, "h", 1000))
        assertTrue(Telemetria.installDue(1000, "a", "b", 2000))
        assertFalse(Telemetria.installDue(1000, "a", "a", 2000))
        assertTrue(Telemetria.installDue(1000, "a", "a", 1000 + 24 * 3_600_000L))
    }

    @Test fun rotatingLogScrubsAndRotates() {
        val dir = tmp.newFolder("logs")
        val r = Registro(dir, maxBytes = 200, files = 3, own = { own }, secrets = { listOf("Clave-Secreta-1") })
        r.i("t", "entra bob@otro.org con Clave-Secreta-1 y ana@empresa.com")
        val text = r.readAll()
        assertFalse("bob@otro.org" in text); assertFalse("Clave-Secreta-1" in text); assertTrue("ana@empresa.com" in text)
        repeat(30) { r.i("t", "linea de relleno numero $it con texto para pasar el limite") }
        assertTrue(dir.listFiles()!!.size in 2..3)
        r.clear(); assertEquals("", r.readAll())
    }
}
