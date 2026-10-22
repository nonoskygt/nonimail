package com.nonosky.nonimailtools.core.ia

import kotlinx.serialization.Serializable

/** One downloadable on-device model. The list lives in `defaults.json` (`localAi.models`), never in code. */
@Serializable
data class ModeloIa(
    /** "basico", "mediano" or "grande". Also the key stored in the settings. */
    val id: String,
    val url: String,
    val bytes: Long,
    /** Lowercase hex SHA-256 of the file (Hugging Face `x-linked-etag`). */
    val sha256: String,
    val archivo: String,
    /** Qwen3-style models need `/no_think` to answer with the bare number. */
    val sinPensar: Boolean = false,
)

@Serializable
data class IaLocalDefaults(
    val ramMultiple: Int,
    val ramExtraMb: Int,
    val diskExtraMb: Int,
    val models: List<ModeloIa>,
)

object Recomendador {
    private const val MB = 1024L * 1024L

    /**
     * The largest tier with RAM >= ramMultiple x size + ramExtra and free storage >= size + diskExtra.
     * If none fits, the smallest one (Básico).
     */
    fun recomendar(cfg: IaLocalDefaults, ramBytes: Long, libreBytes: Long): ModeloIa {
        val porTamano = cfg.models.sortedBy { it.bytes }
        return porTamano.lastOrNull {
            ramBytes >= cfg.ramMultiple * it.bytes + cfg.ramExtraMb * MB &&
                libreBytes >= it.bytes + cfg.diskExtraMb * MB
        } ?: porTamano.first()
    }
}

object ProgresoDescarga {
    /** Parsed `Content-Range: bytes 100-999/1000`. */
    data class Rango(val inicio: Long, val fin: Long, val total: Long)

    private val RANGO = Regex("""bytes\s+(\d+)-(\d+)/(\d+)""", RegexOption.IGNORE_CASE)

    fun parseContentRange(cabecera: String?): Rango? {
        val m = RANGO.find(cabecera ?: return null) ?: return null
        val (a, b, t) = m.destructured
        return Rango(a.toLong(), b.toLong(), t.toLong())
    }

    fun mb(bytes: Long): Long = Math.round(bytes / (1024.0 * 1024.0))

    /** "37% (210 / 555 MB)" */
    fun texto(hecho: Long, total: Long): String {
        val pct = if (total > 0) (hecho * 100 / total).toInt().coerceIn(0, 100) else 0
        return "$pct% (${mb(hecho)} / ${mb(total)} MB)"
    }
}
