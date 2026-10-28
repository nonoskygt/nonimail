package com.nonosky.nonimailtools.core.servicio

import com.nonosky.nonimailtools.core.Defaults
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** `GET /api/plan` and `/api/tareas` as the apps read and write them (SERVICIO.md). */
class ServicioTest {
    private val planJson = """
        {"activa_en_servicio":true,
         "precios":{"moneda":"USD","mensual":[{"desde":1,"hasta":4,"precio":"3.00"},{"desde":5,"hasta":19,"precio":"2.50"},{"desde":20,"hasta":null,"precio":"2.00"}],
                    "anual":[{"desde":1,"hasta":4,"precio":"29.00"},{"desde":5,"hasta":19,"precio":"24.00"},{"desde":20,"hasta":null,"precio":"19.00"}]},
         "suscripcion":{"estado":"activa","periodo":"anual","cantidad":3,"cuentas":["Ana@Empresa.com"],"pagado_hasta":"2027-10-28T00:00:00+00:00","vigente":true,"precio_por_cuenta":"29.00","total":"87.00"},
         "compro_alguna_vez":true,"web_permitida":true,"token":"NMTS1.a.b"}
    """.trimIndent()

    @Test fun leeElPlan() {
        val p = Plan.parse(planJson)!!
        assertTrue(p.comproAlgunaVez)
        assertEquals("NMTS1.a.b", p.token)
        val s = p.suscripcion!!
        assertTrue(s.vigente); assertEquals("anual", s.periodo); assertEquals(3, s.cantidad); assertEquals(listOf("ana@empresa.com"), s.cuentas)
        val pr = p.precios!!
        assertEquals(3, pr.filas.size)
        assertNull(pr.filas[2].first.hasta)
        assertEquals("USD 3", pr.monto(pr.filas[0].first.precio))
        assertEquals("USD 2.50", pr.monto(pr.filas[1].first.precio))
        assertEquals("USD 29", pr.monto(pr.filas[0].second!!.precio))
        val gratis = Plan.parse("""{"suscripcion":null,"token":null,"compro_alguna_vez":false}""")!!
        assertNull(gratis.suscripcion); assertNull(gratis.token); assertNull(gratis.precios)
        assertNull(Plan.parse("no es json"))
    }

    @Test fun losPreciosDeDefaultsSonLaTablaDelServicio() {
        val pr = Defaults.instance.planes
        assertEquals("USD", pr.moneda)
        assertEquals(listOf(1, 5, 20), pr.mensual.map { it.desde })
        assertEquals(listOf("3.00", "2.50", "2.00"), pr.mensual.map { it.precio })
        assertEquals(listOf("29.00", "24.00", "19.00"), pr.anual.map { it.precio })
        assertEquals(listOf(1, 3, 7, 14, 30), Defaults.instance.servicio.cadaDias)
        assertTrue(Defaults.instance.servicio.cadaDiasDefault in Defaults.instance.servicio.cadaDias)
        assertEquals(50, Defaults.instance.iaNonosky.maxItems)
    }

    private class Falso(val r: RespuestaHttp) : Transporte {
        val pedidos = ArrayList<Triple<String, String, String?>>()
        override fun pedir(metodo: String, url: String, cuerpo: String?, token: String?, timeoutMs: Int): RespuestaHttp { pedidos += Triple(metodo, url, cuerpo); return r }
    }

    private val tareaJson = """{"id":"t1","tipo":"limpiar","cuenta":{"correo":"ana@empresa.com","host":"imap.x"},"destino":null,"cada_dias":7,"cada_minutos":null,"dureza":50,
        "estado":"pausada","motivo":"suscripcion","ultima_corrida":"2026-10-27T10:00:00Z","proxima_corrida":null,"ultimo_resultado":{"ok":true,"resumen":"12 a la papelera"}}"""

    @Test fun creaLaTareaConConsentimientoYCredenciales() {
        val http = Falso(RespuestaHttp(201, tareaJson))
        val api = TareasApi("https://s.example/", "/api/tareas", { "tok" }, 1000, http)
        val c = CredencialTarea("Ana@Empresa.com", "imap.x", 993, "", "secreta", true)
        val r = api.crearLimpiar(c, 7, 120)
        assertTrue(r is ResultadoTareas.Ok)
        val t = (r as ResultadoTareas.Ok).valor
        assertEquals("pausada", t.estado); assertEquals("suscripcion", t.motivo); assertEquals("12 a la papelera", t.ultimoResumen)
        assertTrue(t.es("limpiar", "ANA@empresa.com")); assertFalse(t.es("sincronizar", "ana@empresa.com"))
        val (metodo, url, cuerpo) = http.pedidos.single()
        assertEquals("POST", metodo); assertEquals("https://s.example/api/tareas", url)
        val o = Json.parseToJsonElement(cuerpo!!).jsonObject
        assertEquals("true", o["consentimiento"]!!.jsonPrimitive.content)
        assertEquals("100", o["dureza"]!!.jsonPrimitive.content)          // clamped to 0-100
        assertEquals("ana@empresa.com", o["cuenta"]!!.jsonObject["correo"]!!.jsonPrimitive.content)
        assertEquals("ana@empresa.com", o["cuenta"]!!.jsonObject["usuario"]!!.jsonPrimitive.content)
        assertNull(o["destino"])
    }

    @Test fun erroresDelServicio() {
        fun con(st: Int, body: String) = TareasApi("https://s.example", "/api/tareas", { "t" }, 1000, Falso(RespuestaHttp(st, body))).borrar("t1")
        assertEquals(ResultadoTareas.Error(402, null, "sin lugar"), con(402, """{"detail":"sin lugar"}"""))
        assertEquals("credenciales", (con(422, """{"detail":"x","codigo":"credenciales"}""") as ResultadoTareas.Error).codigo)
        assertTrue(con(204, "") is ResultadoTareas.Ok)
        assertEquals(ResultadoTareas.Error(401, null, null), TareasApi("https://s.example", "/api/tareas", { null }, 1000, Falso(RespuestaHttp(200, ""))).borrar("t1"))
        val lista = TareasApi("https://s.example", "/api/tareas", { "t" }, 1000, Falso(RespuestaHttp(200, """{"tareas":[$tareaJson,{"sin":"id"}]}"""))).listar()
        assertEquals(1, (lista as ResultadoTareas.Ok).valor.size)
        assertNotNull(TareasApi.cuerpoCambio(null, 3, null, null, null)["cada_dias"])
    }

    @Test fun duplicadaTopeYDurezaMinima() {
        // 409: the same task already exists; 400 with or without the service's text (task limit, bad data)
        fun crear(st: Int, body: String) = TareasApi("https://s.example", "/api/tareas", { "t" }, 1000, Falso(RespuestaHttp(st, body)), durezaMin = 30)
            .crearLimpiar(CredencialTarea("a@empresa.com", "imap.x", 993, "", "p", true), 7, 50)
        assertEquals(409, (crear(409, """{"detail":"ya existe"}""") as ResultadoTareas.Error).status)
        assertEquals("Llegó al máximo de 20 tareas.", (crear(400, """{"detail":"Llegó al máximo de 20 tareas."}""") as ResultadoTareas.Error).detalle)
        assertNull((crear(400, """{"detail":[{"msg":"x"}]}""") as ResultadoTareas.Error).detalle)

        // the automatic cleaning never goes below durezaMin, in POST and in PATCH
        val http = Falso(RespuestaHttp(201, tareaJson))
        val api = TareasApi("https://s.example", "/api/tareas", { "t" }, 1000, http, durezaMin = Defaults.instance.servicio.durezaMin)
        assertEquals(30, Defaults.instance.servicio.durezaMin)
        api.crearLimpiar(CredencialTarea("a@empresa.com", "imap.x", 993, "", "p", true), 7, 10)
        api.cambiar("t1", dureza = 5)
        api.cambiar("t1", dureza = 80)
        val durezas = http.pedidos.map { Json.parseToJsonElement(it.third!!).jsonObject["dureza"]!!.jsonPrimitive.content }
        assertEquals(listOf("30", "30", "80"), durezas)
        assertEquals("PATCH", http.pedidos[1].first)
        assertEquals(30, TareasApi.durezaEfectiva(0, 30)); assertEquals(100, TareasApi.durezaEfectiva(150, 30))
    }
}
