package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.IaNonoskyDefaults
import com.nonosky.nonimailtools.core.servicio.Transporte
import com.nonosky.nonimailtools.core.servicio.TransporteUrl
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.io.IOException

/**
 * «IA de Nonosky»: the subscription's AI on the server (`POST /api/ia/v1/clasificar`). Only sender, subjects
 * (trimmed) and the bulk flag go out, never the body. The answer is one category per sender, turned into a
 * score with the same `categoryScores` as the AI on the phone.
 */
class IaNonosky(
    private val baseUrl: String,
    private val limites: IaNonoskyDefaults,
    private val token: () -> String?,
    private val http: Transporte = TransporteUrl,
) {
    data class Item(val id: String, val from: String, val subjects: List<String>, val bulk: Boolean)

    /** Why the AI of the server stopped answering: the scan goes on with the heuristics. */
    enum class Motivo { SIN_SUSCRIPCION, TOPE_DIARIO, NO_DISPONIBLE, SESION, SIN_RED, OTRO }

    /**
     * [categorias]: id -> category word (null when the server had no answer for it).
     * [fallo]: set when a batch failed; the ids of the batches that did go through are still in [categorias].
     */
    data class Resultado(val categorias: Map<String, String?>, val modelo: String?, val fallo: Motivo?)

    private val json = Json { ignoreUnknownKeys = true }

    /** The JSON body of one batch, with the subjects cut to the limits. */
    fun cuerpo(lote: List<Item>): String = buildJsonObject {
        putJsonArray("items") {
            for (x in lote) addJsonObject {
                put("id", x.id)
                put("from", x.from)
                putJsonArray("subjects") { for (s in x.subjects.take(limites.maxSubjects)) add(s.take(limites.maxChars)) }
                put("bulk", x.bulk)
            }
        }
    }.toString()

    /** Classifies [items] in batches of [IaNonoskyDefaults.maxItems]; stops at the first failed batch. Never throws. */
    fun clasificar(items: List<Item>): Resultado {
        val out = LinkedHashMap<String, String?>()
        var modelo: String? = null
        val tok = token() ?: return Resultado(out, null, Motivo.SESION)
        for (lote in items.chunked(limites.maxItems.coerceAtLeast(1))) {
            val r = try {
                http.pedir("POST", TransporteUrl.url(baseUrl, limites.path), cuerpo(lote), tok, limites.timeoutMs)
            } catch (_: IOException) {
                return Resultado(out, modelo, Motivo.SIN_RED)
            } catch (_: Exception) {
                return Resultado(out, modelo, Motivo.OTRO)
            }
            if (!r.ok) return Resultado(out, modelo, motivo(r.status))
            val o = r.cuerpo?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() }
                ?: return Resultado(out, modelo, Motivo.OTRO)
            modelo = (o["modelo"] as? JsonPrimitive)?.contentOrNull ?: modelo
            for (e in (o["resultados"] as? JsonArray).orEmpty()) {
                val x = e as? JsonObject ?: continue
                val id = (x["id"] as? JsonPrimitive)?.contentOrNull ?: continue
                val cat = (x["categoria"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull?.trim()?.uppercase()
                out[id] = cat?.takeIf { it.isNotEmpty() }
            }
        }
        return Resultado(out, modelo, null)
    }

    companion object {
        fun motivo(status: Int): Motivo = when (status) {
            402 -> Motivo.SIN_SUSCRIPCION
            429 -> Motivo.TOPE_DIARIO
            404, 501, 502, 503, 504 -> Motivo.NO_DISPONIBLE
            401, 403 -> Motivo.SESION
            else -> Motivo.OTRO
        }

        /** Category -> score with `categoryScores`; null (or unknown) leaves the heuristic score. */
        fun puntaje(categoria: String?, categoryScores: Map<String, Int>): Int? = categoria?.let { categoryScores[it.uppercase()] }
    }
}
