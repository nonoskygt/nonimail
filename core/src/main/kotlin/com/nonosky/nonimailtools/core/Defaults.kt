package com.nonosky.nonimailtools.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Tunable defaults (regexes, score levels, provider presets, folder names, LLM prompt).
 * They live in `defaults.json` next to this class, not in code, so they can be reviewed
 * and changed without touching the logic.
 */
@Serializable
data class Defaults(
    val heuristics: HeuristicPatterns,
    val scores: ScoreLevels,
    val cleaning: CleaningDefaults,
    val sync: SyncDefaults,
    val llm: LlmDefaults,
    val providers: List<ProviderPreset>,
    val folders: FolderNames,
) {
    fun provider(id: String): ProviderPreset? = providers.firstOrNull { it.id == id }

    /** The preset whose domain list contains the address' domain, if any. */
    fun providerForEmail(email: String): ProviderPreset? {
        val d = com.nonosky.nonimailtools.core.licencias.Dominios.dominioDe(email)
        if (d.isEmpty()) return null
        providers.firstOrNull { d in it.domains }?.let { return it }
        // Country variants of the public families: hotmail.es, outlook.com.mx, yahoo.com.ar…
        if (!com.nonosky.nonimailtools.core.licencias.Dominios.esPersonal(email)) return null
        val family = d.substringBefore('.')
        return providers.firstOrNull { p -> p.domains.any { it.substringBefore('.') == family } }
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        val instance: Defaults by lazy { parse(resourceText("defaults.json")) }

        fun parse(text: String): Defaults = json.decodeFromString(serializer(), text)

        internal fun resourceText(name: String): String {
            val stream = Defaults::class.java.getResourceAsStream(name)
                ?: error("Missing bundled resource $name")
            return stream.use { it.readBytes().toString(Charsets.UTF_8) }
        }
    }
}

@Serializable
data class HeuristicPatterns(
    val keepOverride: String,
    val subject: String,
    val from: String,
    val body: String,
)

@Serializable
data class ScoreLevels(
    val contact: Int,
    val protected: Int,
    val promo: Int,
    val automaticBulk: Int,
    val bulk: Int,
    val automatic: Int,
    val person: Int,
)

@Serializable
data class CleaningDefaults(
    val scanMode: String,
    val scanCount: Int,
    val scanDays: Int,
    val hardness: Int,
    val band: Int,
    val maxSamples: Int,
    val sentScanMax: Int,
    val bodyMaxChars: Int,
    val fetchBatch: Int,
)

@Serializable
data class SyncDefaults(
    val fetchBatch: Int,
    val progressEvery: Int,
    val maxErrorSamples: Int,
)

@Serializable
data class LlmDefaults(
    val numCtx: Int,
    val numPredict: Int,
    val prompt: String,
)

@Serializable
data class ProviderPreset(
    val id: String,
    val telemetry: String,
    val host: String,
    val port: Int,
    val security: String,
    val domains: List<String>,
    val appPassword: Boolean,
)

@Serializable
data class FolderNames(
    val trash: List<String>,
    val sent: List<String>,
)
