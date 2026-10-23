package com.nonosky.nonimailtools.core.telemetria

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.IOException
import java.time.Instant
import java.time.temporal.ChronoUnit

/*
 * Telemetry client, contract v1 (TELEMETRIA.md, shared with the desktop app and the server).
 *   POST {base}/api/telemetria/v1/instalacion
 *   POST {base}/api/telemetria/v1/eventos
 * 200 → sent. 4xx → the batch is dropped (no retry). 5xx or no network → kept and retried.
 * At most 500 queued events (oldest dropped), 200 per batch, 256 KB per request.
 */

@Serializable
data class Evento(val ts: String, val tipo: String, val datos: JsonObject)

@Serializable
data class Instalacion(
    @SerialName("install_id") val installId: String,
    val app: String,
    val version: String,
    val os: String,
    @SerialName("os_version") val osVersion: String,
    val arch: String,
    val locale: String,
    @SerialName("zona_horaria") val zonaHoraria: String,
    @SerialName("origen_descarga") val origenDescarga: String,
    @SerialName("ia_local") val iaLocal: Boolean,
    val modelo: String?,
)

@Serializable
private data class LoteEventos(
    @SerialName("install_id") val installId: String,
    val app: String,
    val version: String,
    val eventos: List<Evento>,
)

object Telemetria {
    const val MAX_QUEUE = 500
    const val MAX_BATCH_EVENTS = 200
    const val MAX_BODY_BYTES = 256 * 1024
    const val MAX_STACK = 4000
    const val MAX_MESSAGE = 1000
    const val INSTALL_PATH = "/api/telemetria/v1/instalacion"
    const val EVENTS_PATH = "/api/telemetria/v1/eventos"

    val json = Json { encodeDefaults = true; explicitNulls = true; ignoreUnknownKeys = true }

    fun now(): String = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()

    fun userAgent(version: String, os: String, arch: String) = "NoniMailTools/$version ($os; $arch)"

    /** `arm64-v8a` → `arm64`, `x86_64` → `x64`… (same names as the desktop app). */
    fun archName(abi: String?): String = when (abi?.lowercase()) {
        null, "" -> "unknown"
        "arm64-v8a", "aarch64" -> "arm64"
        "armeabi-v7a", "armeabi" -> "arm"
        "x86_64", "amd64" -> "x64"
        "x86", "i686" -> "ia32"
        else -> abi.lowercase()
    }

    fun eventsBody(installId: String, app: String, version: String, events: List<Evento>): String =
        json.encodeToString(LoteEventos.serializer(), LoteEventos(installId, app, version, events))

    fun installBody(i: Instalacion): String = json.encodeToString(Instalacion.serializer(), i)

    /**
     * Splits [events] into request bodies: at most [maxEvents] per batch and [maxBytes] per
     * body. An event that cannot fit even alone is dropped (returned in `oversized`).
     */
    fun batches(
        events: List<Evento>,
        body: (List<Evento>) -> String,
        maxEvents: Int = MAX_BATCH_EVENTS,
        maxBytes: Int = MAX_BODY_BYTES,
    ): Batches {
        val out = ArrayList<List<Evento>>()
        val oversized = ArrayList<Evento>()
        var cur = ArrayList<Evento>()
        for (e in events) {
            if (body(listOf(e)).toByteArray().size > maxBytes) { oversized += e; continue }
            val next = cur + e
            if (next.size > maxEvents || body(next).toByteArray().size > maxBytes) {
                if (cur.isNotEmpty()) out += cur
                cur = arrayListOf(e)
            } else {
                cur = ArrayList(next)
            }
        }
        if (cur.isNotEmpty()) out += cur
        return Batches(out, oversized)
    }

    data class Batches(val batches: List<List<Evento>>, val oversized: List<Evento>)

    /** The installation record goes again when something changed or 24 h passed. */
    fun installDue(lastSentMs: Long, lastHash: String?, currentHash: String, nowMs: Long): Boolean =
        lastHash != currentHash || nowMs - lastSentMs >= 24 * 3_600_000L || lastSentMs <= 0

    // ---- event builders (fields that do not apply are omitted) ----

    fun inicio() = Evento(now(), "inicio", JsonObject(emptyMap()))

    fun cuenta(cuenta: String, proveedor: String, personal: Boolean) = Evento(now(), "cuenta", buildJsonObject {
        put("cuenta", cuenta.lowercase()); put("proveedor", proveedor); put("personal", personal)
    })

    fun limpiar(
        cuenta: String, fase: String, dryRun: Boolean, revisados: Int?, remitentes: Int?, movidos: Int?,
        duracionS: Long, resultado: String, licencia: Boolean,
    ) = Evento(now(), "limpiar", buildJsonObject {
        put("cuenta", cuenta.lowercase()); put("fase", fase); put("dry_run", dryRun)
        revisados?.let { put("revisados", it) }; remitentes?.let { put("remitentes", it) }; movidos?.let { put("movidos", it) }
        put("duracion_s", duracionS); put("resultado", resultado); put("licencia", licencia)
    })

    fun sincronizar(
        origen: String, destino: String, dryRun: Boolean, carpetas: Int, mensajes: Int, copiados: Int, bytes: Long,
        duracionS: Long, resultado: String, licencia: Boolean,
    ) = Evento(now(), "sincronizar", buildJsonObject {
        put("origen", origen.lowercase()); put("destino", destino.lowercase()); put("dry_run", dryRun)
        put("carpetas", carpetas); put("mensajes", mensajes); put("copiados", copiados); put("bytes", bytes)
        put("duracion_s", duracionS); put("resultado", resultado); put("licencia", licencia)
    })

    fun licencia(cuenta: String, tipo: String, canal: String, venceIso: String) = Evento(now(), "licencia", buildJsonObject {
        put("cuenta", cuenta.lowercase()); put("tipo", tipo); put("canal", canal); put("vence", venceIso)
    })

    /** Error event, already scrubbed: [own] are the user's accounts (kept), [secrets] are blanked. */
    fun error(mensaje: String, pila: String?, contexto: String, cuenta: String?, own: Collection<String>, secrets: Collection<String> = emptyList()) =
        Evento(now(), "error", buildJsonObject {
            put("mensaje", Depurador.scrub(mensaje, own, secrets).take(MAX_MESSAGE))
            if (!pila.isNullOrBlank()) put("pila", Depurador.scrub(pila, own, secrets).take(MAX_STACK))
            put("contexto", contexto)
            if (!cuenta.isNullOrBlank()) put("cuenta", cuenta.lowercase())
        })
}

/**
 * Removes what must never leave the device: passwords and tokens, full license keys, and
 * e-mail addresses that are not the user's own accounts.
 */
object Depurador {
    private val EMAIL = Regex("[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}")
    private val LICENSE = Regex("NMT1\\.[A-Za-z0-9_\\-]+\\.[A-Za-z0-9_\\-]+")
    private val KEY_VALUE = Regex(
        "(?i)\\b(password|passwd|pwd|pass|contrase(?:ñ|n)a|secret|token|api[_-]?key|authorization|cookie)\\b(\\s*[:=]\\s*|\\s+)(\"[^\"]*\"|'[^']*'|[^\\s,;&]+)",
    )
    private val BEARER = Regex("(?i)\\b(bearer|basic)\\s+[A-Za-z0-9._~+/=\\-]{6,}")
    private val IMAP_LOGIN = Regex("(?i)\\b(LOGIN)\\s+(\"[^\"]*\"|\\S+)\\s+(\"[^\"]*\"|\\S+)")
    private val IMAP_AUTH = Regex("(?i)\\b(AUTHENTICATE\\s+\\S+)\\s+\\S+")
    private val LONG_TOKEN = Regex("(?<![A-Za-z0-9+/_=\\-])[A-Za-z0-9+/_=\\-]{32,}(?![A-Za-z0-9+/_=\\-])")

    const val MASK = "***"
    const val EMAIL_MASK = "<correo>"

    fun scrub(text: String, own: Collection<String>, secrets: Collection<String> = emptyList()): String {
        var s = text
        for (secret in secrets) if (secret.length >= 4) s = s.replace(secret, MASK)
        s = LICENSE.replace(s, "NMT1.$MASK")
        s = IMAP_LOGIN.replace(s) { "${it.groupValues[1]} ${it.groupValues[2]} $MASK" }
        s = IMAP_AUTH.replace(s) { "${it.groupValues[1]} $MASK" }
        s = BEARER.replace(s) { "${it.groupValues[1]} $MASK" }
        s = KEY_VALUE.replace(s) { "${it.groupValues[1]}${it.groupValues[2]}$MASK" }
        val mine = own.map { it.trim().lowercase() }.toSet()
        s = EMAIL.replace(s) { if (it.value.lowercase() in mine) it.value else EMAIL_MASK }
        s = LONG_TOKEN.replace(s, MASK)
        return s
    }
}

/** Persistent FIFO of events, as JSON lines. Keeps at most [max] (oldest dropped). */
class ColaEventos(private val file: File, private val max: Int = Telemetria.MAX_QUEUE) {

    @Synchronized
    fun add(e: Evento) = addAll(listOf(e))

    @Synchronized
    fun addAll(events: List<Evento>) {
        if (events.isEmpty()) return
        write((read() + events).takeLast(max))
    }

    @Synchronized
    fun all(): List<Evento> = read()

    @Synchronized
    fun size(): Int = read().size

    /** Drops the first [n] events (the ones just sent or rejected). */
    @Synchronized
    fun removeFirst(n: Int) {
        if (n <= 0) return
        write(read().drop(n))
    }

    @Synchronized
    fun clear() {
        file.delete()
    }

    private fun read(): List<Evento> {
        if (!file.exists()) return emptyList()
        return file.readLines(Charsets.UTF_8).mapNotNull { line ->
            if (line.isBlank()) null else runCatching { Telemetria.json.decodeFromString(Evento.serializer(), line) }.getOrNull()
        }
    }

    private fun write(events: List<Evento>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(events.joinToString("") { Telemetria.json.encodeToString(Evento.serializer(), it) + "\n" }, Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.delete()
            tmp.renameTo(file)
        }
    }
}

/** HTTP transport: returns the status code, throws [IOException] when there is no answer. */
fun interface Poster {
    @Throws(IOException::class)
    fun post(url: String, body: String, userAgent: String): Int
}

enum class Outcome { SENT, DROPPED, RETRY }

/** Sends the queue in order, one batch at a time, following the contract's retry rules. */
class Enviador(
    private val queue: ColaEventos,
    private val poster: Poster,
    private val baseUrl: String,
    private val installId: String,
    private val app: String,
    private val version: String,
    private val userAgent: String,
) {
    private fun url(path: String) = baseUrl.trim().trimEnd('/') + path

    fun classify(code: Int): Outcome = when (code) {
        in 200..299 -> Outcome.SENT
        in 400..499 -> Outcome.DROPPED
        else -> Outcome.RETRY
    }

    fun sendInstall(i: Instalacion): Outcome = try {
        classify(poster.post(url(Telemetria.INSTALL_PATH), Telemetria.installBody(i), userAgent))
    } catch (e: IOException) {
        Outcome.RETRY
    }

    /** Flushes the whole queue. RETRY means something is left for later. */
    fun flushEvents(): Outcome {
        while (true) {
            val events = queue.all()
            if (events.isEmpty()) return Outcome.SENT
            val b = Telemetria.batches(events, { Telemetria.eventsBody(installId, app, version, it) })
            if (b.batches.isEmpty()) { queue.clear(); return Outcome.SENT }
            // Oversized events at the head are dropped so they cannot block the queue.
            val first = b.batches.first()
            val headDrop = events.indexOf(first.first())
            if (headDrop > 0) { queue.removeFirst(headDrop); continue }
            val outcome = try {
                classify(poster.post(url(Telemetria.EVENTS_PATH), Telemetria.eventsBody(installId, app, version, first), userAgent))
            } catch (e: IOException) {
                Outcome.RETRY
            }
            when (outcome) {
                Outcome.SENT, Outcome.DROPPED -> queue.removeFirst(first.size)
                Outcome.RETRY -> return Outcome.RETRY
            }
        }
    }
}
