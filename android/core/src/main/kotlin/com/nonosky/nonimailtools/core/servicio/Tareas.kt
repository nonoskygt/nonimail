package com.nonosky.nonimailtools.core.servicio

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.IOException

/** IMAP login a permanent task uses on the server. [tls]: implicit TLS (port 993), like the desktop `secure`. */
data class CredencialTarea(val correo: String, val host: String, val puerto: Int, val usuario: String, val password: String, val tls: Boolean)

/** A permanent task on the server (`/api/tareas`). Dates are ISO 8601 as the service sends them. */
data class Tarea(
    val id: String,
    val tipo: String,
    val cuenta: String,
    val destino: String?,
    val cadaDias: Int?,
    val cadaMinutos: Int?,
    val dureza: Int?,
    val estado: String,
    val motivo: String?,
    val ultimaCorrida: String?,
    val proximaCorrida: String?,
    val ultimoOk: Boolean?,
    val ultimoResumen: String?,
) {
    /** Same task = same kind and same accounts. */
    fun es(tipo: String, cuenta: String, destino: String? = null): Boolean =
        this.tipo == tipo && this.cuenta.equals(cuenta.trim(), ignoreCase = true) &&
            (tipo == LIMPIAR || this.destino.orEmpty().equals(destino.orEmpty().trim(), ignoreCase = true))

    companion object {
        const val LIMPIAR = "limpiar"
        const val SINCRONIZAR = "sincronizar"
        const val ACTIVA = "activa"
        const val PAUSADA = "pausada"
        const val ERROR = "error"
    }
}

/** Outcome of a call to `/api/tareas`. */
sealed interface ResultadoTareas<out T> {
    data class Ok<T>(val valor: T) : ResultadoTareas<T>
    /** [codigo]: the service's `codigo` (e.g. `credenciales`); [detalle]: its `detail`, shown as is for a 400. */
    data class Error(val status: Int, val codigo: String?, val detalle: String?) : ResultadoTareas<Nothing>
    data object SinRed : ResultadoTareas<Nothing>
}

/** Client of the permanent tasks (`GET/POST /api/tareas`, `PATCH/DELETE /api/tareas/{id}`). Blocking. */
class TareasApi(
    private val baseUrl: String,
    private val ruta: String,
    private val token: () -> String?,
    private val timeoutMs: Int,
    private val http: Transporte = TransporteUrl,
    /** Lowest hardness of a server cleaning (`servicio.durezaMin`): POST and PATCH never send less. */
    private val durezaMin: Int = 0,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private fun <T> llamar(metodo: String, ruta: String, cuerpo: JsonObject?, leer: (String?) -> T): ResultadoTareas<T> {
        val tok = token() ?: return ResultadoTareas.Error(401, null, null)
        val r = try { http.pedir(metodo, TransporteUrl.url(baseUrl, ruta), cuerpo?.toString(), tok, timeoutMs) } catch (_: IOException) { return ResultadoTareas.SinRed }
        if (!r.ok) {
            val o = r.cuerpo?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }
            val det = o?.get("detail")
            val codigo = (o?.get("codigo") as? JsonPrimitive)?.contentOrNull ?: ((det as? JsonObject)?.get("codigo") as? JsonPrimitive)?.contentOrNull
            val detalle = (det as? JsonPrimitive)?.contentOrNull ?: ((det as? JsonObject)?.get("detail") as? JsonPrimitive)?.contentOrNull
            return ResultadoTareas.Error(r.status, codigo, detalle)
        }
        return runCatching { ResultadoTareas.Ok(leer(r.cuerpo)) }.getOrElse { ResultadoTareas.Error(r.status, "respuesta", it.message) }
    }

    fun listar(): ResultadoTareas<List<Tarea>> = llamar("GET", ruta, null) { t ->
        val o = json.parseToJsonElement(t.orEmpty()).jsonObject
        (o["tareas"] as? JsonArray)?.mapNotNull { e -> (e as? JsonObject)?.let { runCatching { tarea(it) }.getOrNull() } }.orEmpty()
    }

    fun crearLimpiar(cuenta: CredencialTarea, cadaDias: Int, dureza: Int): ResultadoTareas<Tarea> =
        llamar("POST", ruta, cuerpoCrear(Tarea.LIMPIAR, cuenta, null, cadaDias, dureza, durezaMin)) { tarea(json.parseToJsonElement(it.orEmpty()).jsonObject) }

    fun crearSincronizar(cuenta: CredencialTarea, destino: CredencialTarea): ResultadoTareas<Tarea> =
        llamar("POST", ruta, cuerpoCrear(Tarea.SINCRONIZAR, cuenta, destino, null, null, durezaMin)) { tarea(json.parseToJsonElement(it.orEmpty()).jsonObject) }

    fun cambiar(id: String, activa: Boolean? = null, cadaDias: Int? = null, dureza: Int? = null, password: String? = null, passwordDestino: String? = null): ResultadoTareas<Tarea> =
        llamar("PATCH", "$ruta/$id", cuerpoCambio(activa, cadaDias, dureza, password, passwordDestino, durezaMin)) { tarea(json.parseToJsonElement(it.orEmpty()).jsonObject) }

    fun borrar(id: String): ResultadoTareas<Unit> = llamar("DELETE", "$ruta/$id", null) { }

    companion object {
        /** The hardness a server cleaning really uses: never below [durezaMin], never above 100. */
        fun durezaEfectiva(dureza: Int, durezaMin: Int): Int = maxOf(durezaMin, dureza).coerceIn(0, 100)

        private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
        private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull

        private fun correoDe(e: Any?): String? = when (e) {
            is JsonObject -> e.str("correo")
            is JsonPrimitive -> e.contentOrNull
            else -> null
        }

        fun tarea(o: JsonObject): Tarea {
            val ult = o["ultimo_resultado"] as? JsonObject
            return Tarea(
                id = o.str("id") ?: error("task without id"),
                tipo = o.str("tipo").orEmpty(),
                cuenta = correoDe(o["cuenta"]).orEmpty().lowercase(),
                destino = correoDe(o["destino"])?.lowercase(),
                cadaDias = o.int("cada_dias"),
                cadaMinutos = o.int("cada_minutos"),
                dureza = o.int("dureza"),
                estado = o.str("estado").orEmpty(),
                motivo = o.str("motivo"),
                ultimaCorrida = o.str("ultima_corrida"),
                proximaCorrida = o.str("proxima_corrida"),
                ultimoOk = (ult?.get("ok") as? JsonPrimitive)?.booleanOrNull,
                ultimoResumen = ult?.str("resumen"),
            )
        }

        private fun credencial(c: CredencialTarea): JsonObject = buildJsonObject {
            put("correo", c.correo.trim().lowercase()); put("host", c.host.trim()); put("puerto", c.puerto)
            put("usuario", c.usuario.ifBlank { c.correo.trim().lowercase() }); put("password", c.password); put("tls", c.tls)
        }

        /** The `POST /api/tareas` body; the consent is always sent, the dialog asked for it. */
        fun cuerpoCrear(tipo: String, cuenta: CredencialTarea, destino: CredencialTarea?, cadaDias: Int?, dureza: Int?, durezaMin: Int = 0): JsonObject = buildJsonObject {
            put("tipo", tipo)
            put("cuenta", credencial(cuenta))
            if (destino != null) put("destino", credencial(destino))
            if (cadaDias != null) put("cada_dias", cadaDias)
            if (dureza != null) put("dureza", durezaEfectiva(dureza, durezaMin))
            put("consentimiento", true)
        }

        fun cuerpoCambio(activa: Boolean?, cadaDias: Int?, dureza: Int?, password: String?, passwordDestino: String?, durezaMin: Int = 0): JsonObject = buildJsonObject {
            if (activa != null) put("activa", activa)
            if (cadaDias != null) put("cada_dias", cadaDias)
            if (dureza != null) put("dureza", durezaEfectiva(dureza, durezaMin))
            if (password != null) put("password", password)
            if (passwordDestino != null) put("password_destino", passwordDestino)
        }
    }
}
