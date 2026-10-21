package com.nonosky.nonimailtools.core.limpiar

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.net.HttpURLConnection
import java.net.URI

/** Local AI scoring through an Ollama server on the user's LAN. */
class Ollama(
    baseUrl: String,
    private val model: String,
    private val timeoutMs: Int,
    private val numCtx: Int = 4096,
    private val numPredict: Int = 16,
) {
    val base: String = baseUrl.trim().trimEnd('/')

    data class Probe(val version: String, val models: List<String>)

    /** `/api/version` + `/api/tags`: proves the server answers and lists its models. */
    fun probe(): Probe {
        val v = get("/api/version", 5_000)["version"]?.jsonPrimitive?.contentOrNull ?: "?"
        val models = get("/api/tags", 5_000)["models"]?.jsonArray
            ?.mapNotNull { (it as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull }
            ?.sorted().orEmpty()
        return Probe(v, models)
    }

    /** Quick (non-thinking) completion. Returns the raw response text (may be blank). */
    fun generate(prompt: String): String {
        val body = buildJsonObject {
            put("model", model)
            put("prompt", "$prompt\n/no_think")
            put("stream", false)
            put("think", false)
            putJsonObject("options") {
                put("temperature", 0)
                put("num_predict", numPredict)
                put("num_ctx", numCtx)
            }
        }
        val j = post("/api/generate", body.toString(), timeoutMs)
        (j["error"] as? JsonPrimitive)?.contentOrNull?.let { throw OllamaException(it) }
        return j["response"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    }

    private fun get(path: String, timeout: Int): JsonObject = request("GET", path, null, timeout)
    private fun post(path: String, body: String, timeout: Int): JsonObject = request("POST", path, body, timeout)

    private fun request(method: String, path: String, body: String?, timeout: Int): JsonObject {
        val conn = URI("$base$path").toURL().openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = minOf(timeout, 10_000)
            conn.readTimeout = timeout
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) }.orEmpty()
            val json = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull()
            if (code !in 200..299) {
                val err = (json?.get("error") as? JsonPrimitive)?.contentOrNull
                throw OllamaException(err ?: "HTTP $code")
            }
            return json ?: throw OllamaException("Invalid JSON from Ollama")
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        /**
         * Accepts "192.168.1.20", "192.168.1.20:11434" or a full URL; adds `http://` and the
         * default port when missing. Returns "" for blank input.
         */
        fun normalizeUrl(input: String?, defaultPort: Int): String {
            val s = (input ?: "").trim().trimEnd('/')
            if (s.isEmpty()) return ""
            val withScheme = if (s.contains("://")) s else "http://$s"
            val u = runCatching { URI(withScheme) }.getOrNull() ?: return withScheme
            if (u.host == null) return withScheme
            val port = if (u.port == -1 && !s.contains("://")) defaultPort else u.port
            val portPart = if (port == -1) "" else ":$port"
            val path = (u.rawPath ?: "").trimEnd('/')
            return "${u.scheme}://${u.host}$portPart$path"
        }

        fun buildPrompt(base: String, from: String, subjects: List<String>, bulk: Boolean, body: String): String =
            "$base\n\nEmail:\nFROM: $from\nSUBJECT: ${subjects.joinToString(" | ")}\nBULK: ${if (bulk) "si" else "no"}\nBODY: $body\n\nPuntaje (0-100):"

        private val LABELED = Regex("(?:respuesta|puntaje|puntuaci[oó]n|score)\\s*[:=]?\\s*\\**\\s*(\\d{1,3})\\b", RegexOption.IGNORE_CASE)
        private val BOLD = Regex("\\*\\*\\s*(\\d{1,3})\\s*\\*\\*")
        private val OUT_OF = Regex("(sobre|de)\\s*100", RegexOption.IGNORE_CASE)
        private val SLASH_100 = Regex("/\\s*100")
        private val RANGE = Regex("\\b0\\s*(-|a|to)\\s*100\\b", RegexOption.IGNORE_CASE)
        private val NUMBER = Regex("\\b(\\d{1,3})\\b")

        /** Same parsing as the desktop app: labeled number, bold number, else the last 0–100. */
        fun parseScore(text: String?, fallback: Int?): Int? {
            if (text == null) return fallback
            LABELED.find(text)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it in 0..100 }?.let { return it }
            BOLD.find(text)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it in 0..100 }?.let { return it }
            val cleaned = text.replace(OUT_OF, " ").replace(SLASH_100, " ").replace(RANGE, " ")
            return NUMBER.findAll(cleaned).mapNotNull { it.groupValues[1].toIntOrNull() }.filter { it in 0..100 }.lastOrNull()
                ?: fallback
        }
    }
}

class OllamaException(message: String) : Exception(message)
