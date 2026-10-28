package com.nonosky.nonimailtools.core.servicio

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

/** One price step: from [desde] accounts up to [hasta] (null = no upper end), [precio] per account. */
@Serializable
data class Tramo(val desde: Int, val hasta: Int? = null, val precio: String)

/** Price table of the subscription, per account (same shape as `precios` in `GET /api/plan`). */
@Serializable
data class Precios(val moneda: String, val mensual: List<Tramo>, val anual: List<Tramo>) {
    /** Rows of the table: monthly step and the yearly one with the same start. */
    val filas: List<Pair<Tramo, Tramo?>> get() = mensual.sortedBy { it.desde }.map { m -> m to anual.firstOrNull { it.desde == m.desde } }

    /** «USD 3», «USD 2.50»: only a «.00» ending is dropped. */
    fun monto(precio: String): String = "$moneda ${precio.trim().removeSuffix(".00")}"
}

/** `suscripcion` in `GET /api/plan`. */
data class SuscripcionInfo(
    val estado: String,
    val periodo: String,
    val cantidad: Int,
    val cuentas: List<String>,
    val pagadoHasta: String?,
    val vigente: Boolean,
    val precioPorCuenta: String?,
    val total: String?,
)

/** `GET /api/plan` → `{activa_en_servicio, precios, suscripcion, compro_alguna_vez, web_permitida, token}`. */
data class Plan(
    val activaEnServicio: Boolean,
    val precios: Precios?,
    val suscripcion: SuscripcionInfo?,
    val comproAlgunaVez: Boolean,
    val webPermitida: Boolean,
    val token: String?,
) {
    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** Null when [texto] is not a plan answer. */
        fun parse(texto: String?): Plan? {
            val o = texto?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() } ?: return null
            return Plan(
                activaEnServicio = o.bool("activa_en_servicio") ?: true,
                precios = (o["precios"] as? JsonObject)?.let(::precios),
                suscripcion = (o["suscripcion"] as? JsonObject)?.let { s ->
                    SuscripcionInfo(
                        estado = s.str("estado").orEmpty(),
                        periodo = s.str("periodo").orEmpty(),
                        cantidad = (s["cantidad"] as? JsonPrimitive)?.intOrNull ?: 0,
                        cuentas = (s["cuentas"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.lowercase() }.orEmpty(),
                        pagadoHasta = s.str("pagado_hasta"),
                        vigente = s.bool("vigente") ?: false,
                        precioPorCuenta = s.str("precio_por_cuenta"),
                        total = s.str("total"),
                    )
                },
                comproAlgunaVez = o.bool("compro_alguna_vez") ?: false,
                webPermitida = o.bool("web_permitida") ?: false,
                token = o.str("token")?.takeIf { it.isNotBlank() },
            )
        }

        /** The price table, or null when it is missing or has no steps. */
        fun precios(o: JsonObject): Precios? {
            fun tramos(e: JsonElement?): List<Tramo> = (e as? JsonArray)?.mapNotNull { t ->
                val x = t as? JsonObject ?: return@mapNotNull null
                val desde = (x["desde"] as? JsonPrimitive)?.intOrNull ?: return@mapNotNull null
                val precio = (x["precio"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
                Tramo(desde, (x["hasta"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull, precio)
            }.orEmpty().sortedBy { it.desde }
            val m = tramos(o["mensual"]); val a = tramos(o["anual"])
            if (m.isEmpty() || a.isEmpty()) return null
            return Precios(o.str("moneda") ?: "USD", m, a)
        }

        private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
        private fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.booleanOrNull
    }
}
