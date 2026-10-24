package com.nonosky.nonimailtools.core.limpiar

import com.nonosky.nonimailtools.core.FiltroDefaults
import com.nonosky.nonimailtools.core.licencias.Dominios
import com.nonosky.nonimailtools.core.licencias.LicenseVerifier
import com.nonosky.nonimailtools.core.telemetria.Outcome
import com.nonosky.nonimailtools.core.telemetria.Poster
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.io.IOException

/**
 * Collective filter, contract v1 (the same one the desktop app speaks, `lib/filtro.js`):
 *  - which senders are reported and how each decision is built (pure functions);
 *  - the signed reputation that is downloaded once a day and that the engine always consults.
 * Never leaves the phone: a subject, a body, an address or the user's account. Only the registrable domain.
 */
object Filtro {
    const val PREFIJO_FIRMA = "NMTF1."

    private val NOREPLY = Regex(
        "^(no[-_.]?reply|do[-_.]?not[-_.]?reply|noresponder|no[-_.]?responder|newsletter|news|marketing|promo(s|ciones|tions)?|ofertas|offers|deals|mailer|mailing|notificacion(es)?|notifications?|boletin|info|hello|hola|ventas|campaign|updates?)$",
        RegexOption.IGNORE_CASE,
    )

    /** Second level under a country TLD: tienda.com.gt, bbc.co.uk, empresa.gob.mx. */
    private val SEGUNDO_NIVEL = setOf("com", "net", "org", "edu", "gov", "gob", "mil", "co", "ac", "or", "ne", "go")
    private val CORREO = Regex("^[^@\\s]+@([^@\\s]+\\.[^@\\s]+)$")

    /** Registrable domain (no public suffix list: two labels, or three under a country TLD with a typical second level). */
    fun dominioRegistrable(email: String?): String {
        val m = CORREO.matchEntire((email ?: "").trim().lowercase()) ?: return ""
        val p = m.groupValues[1].trimEnd('.').split('.')
        if (p.size <= 2) return p.joinToString(".")
        val n = p.size
        return (if (p[n - 1].length == 2 && p[n - 2] in SEGUNDO_NIVEL) p.takeLast(3) else p.takeLast(2)).joinToString(".")
    }

    fun esNoreply(email: String): Boolean = NOREPLY.matches(email.substringBefore('@'))

    /** Is this sender reported? Bulk (unsubscribe link or a noreply/marketing name) from an own domain (not Gmail, Hotmail…). */
    fun califica(email: String, conBaja: Boolean): Boolean {
        val d = dominioRegistrable(email)
        if (d.isEmpty() || Dominios.esPersonal("x@$d")) return false
        return conBaja || esNoreply(email)
    }

    /** Does the user contradict the engine? Engine ≥70 and the user keeps, or engine ≤30 and the user deletes. */
    fun corrigio(decision: String, puntaje: Int?): Boolean {
        if (puntaje == null) return false
        return if (decision == "eliminar" || decision == "baja") puntaje <= 30 else puntaje >= 70
    }

    private val PRIORIDAD = listOf("baja", "eliminar", "nunca", "conservar")

    @Serializable
    data class Senales(
        val baja: Boolean,
        val noreply: Boolean,
        val reglas: List<String>,
        val llm: Int? = null,
        val correos: Int,
    )

    @Serializable
    data class Decision(val dominio: String, val senales: Senales, val decision: String, val corrigio: Boolean)

    /** One sender and what the user decided: «baja», «eliminar», «nunca» (saved Keep rule) or «conservar». */
    data class Remitente(val s: SenderScore, val decision: String, val reglas: List<String> = emptyList())

    /** Names of the noise patterns a sender matches (their text is never sent). Only subject and from are known per sender. */
    fun reglasQueCoinciden(s: SenderScore, rules: Rules): List<String> = buildList {
        if (rules.subject != null && s.samples.any { rules.subject.containsMatchIn(it) }) add("subject")
        if (rules.from?.containsMatchIn("${s.name} <${s.email}>") == true) add("from")
    }

    /** One decision per domain (with several senders the strongest wins). At most [max] rows. */
    fun armarDecisiones(remitentes: List<Remitente>, max: Int = 500): List<Decision> {
        val por = LinkedHashMap<String, Decision>()
        for (r in remitentes) {
            val s = r.s
            if (!califica(s.email, s.unsubscribe)) continue
            val dominio = dominioRegistrable(s.email)
            val llm = if (s.reason == Reason.IA) s.score else null
            val fila = Decision(
                dominio, Senales(s.unsubscribe, esNoreply(s.email), r.reglas.distinct(), llm, s.count), r.decision, corrigio(r.decision, s.score),
            )
            val prev = por[dominio]
            if (prev == null) { por[dominio] = fila; continue }
            val a = prev.senales
            val llmMax = listOfNotNull(a.llm, llm).maxOrNull()
            val decision = if (PRIORIDAD.indexOf(fila.decision) < PRIORIDAD.indexOf(prev.decision)) fila else prev
            por[dominio] = Decision(
                dominio,
                Senales(a.baja || fila.senales.baja, a.noreply || fila.senales.noreply, (a.reglas + fila.senales.reglas).distinct(), llmMax, a.correos + fila.senales.correos),
                decision.decision, decision.corrigio,
            )
        }
        return por.values.take(max)
    }

    // ---- signed reputation ----

    /**
     * Canonical JSON: keys sorted recursively, no spaces, non-ASCII left as is. Same bytes as Python's
     * `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` and the desktop `canonico`.
     * Numbers keep the text they came with (the service signs integers).
     */
    fun canonico(v: JsonElement): String = when (v) {
        is JsonNull -> "null"
        is JsonPrimitive -> if (v.isString) comillas(v.content) else v.content
        is JsonArray -> v.joinToString(",", "[", "]") { canonico(it) }
        is JsonObject -> v.entries.sortedBy { it.key }.joinToString(",", "{", "}") { comillas(it.key) + ":" + canonico(it.value) }
    }

    private fun comillas(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            c == '\b' -> sb.append("\\b")
            c == '\u000c' -> sb.append("\\f")
            c.code < 0x20 -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c)
        }
        return sb.append('"').toString()
    }

    /** Ed25519 signature of `NMTF1.` + canonical JSON of {v, generado, dominios}, base64url in `firma`. */
    fun verificar(doc: JsonObject, clavePublica: ByteArray?): Boolean {
        if (clavePublica == null) return false
        val firma = (doc["firma"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return false
        val bytes = LicenseVerifier.decodeB64Url(firma) ?: return false
        val cuerpo = JsonObject(listOf("v", "generado", "dominios").mapNotNull { k -> doc[k]?.let { k to it } }.toMap())
        return LicenseVerifier.verifyEd25519(clavePublica, (PREFIJO_FIRMA + canonico(cuerpo)).toByteArray(Charsets.UTF_8), bytes)
    }

    data class Veredicto(val score: Int, val eliminar: Boolean, val pct: Int)

    /** The reputation layer's verdict, only with enough samples; null leaves the sender to the next layer. */
    fun veredicto(pct: Int?, n: Long?, f: FiltroDefaults): Veredicto? {
        if (pct == null || n == null || n < f.minN) return null
        return when {
            pct >= f.alto -> Veredicto(95, true, pct)
            pct <= f.bajo -> Veredicto(5, false, pct)
            else -> null
        }
    }
}

/** The downloaded reputation, already signature-checked: percentage of users who delete, per domain. */
class Reputacion private constructor(private val dominios: Map<String, Pair<Int, Long>>, val generado: String) {

    /** `(eliminar_pct, n)` of the sender's registrable domain, or null. */
    fun buscar(email: String): Pair<Int, Long>? = dominios[Filtro.dominioRegistrable(email)]

    fun veredicto(email: String, f: FiltroDefaults): Filtro.Veredicto? =
        buscar(email)?.let { Filtro.veredicto(it.first, it.second, f) }

    val tamano get() = dominios.size

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** Parses and verifies; null when it is not JSON, has no domains or the signature does not hold. */
        fun leer(texto: String, clavePublica: ByteArray?): Reputacion? {
            val doc = runCatching { json.parseToJsonElement(texto).jsonObject }.getOrNull() ?: return null
            if (!Filtro.verificar(doc, clavePublica)) return null
            val ds = doc["dominios"] as? JsonObject ?: return null
            val m = HashMap<String, Pair<Int, Long>>()
            for ((d, v) in ds) {
                val o = v as? JsonObject ?: continue
                val pct = (o["eliminar_pct"] as? JsonPrimitive)?.doubleOrNull ?: continue
                val n = (o["n"] as? JsonPrimitive)?.doubleOrNull ?: continue
                if (pct % 1.0 != 0.0) continue
                m[d.lowercase()] = pct.toInt() to n.toLong()
            }
            return Reputacion(m, (doc["generado"] as? JsonPrimitive)?.contentOrNull.orEmpty())
        }
    }
}

/** Decisions waiting to be sent, as JSON lines on disk. Keeps at most [max] (oldest dropped). */
class ColaDecisiones(private val file: File, private val max: Int) {
    private val json = Json { encodeDefaults = true; explicitNulls = false }

    @Synchronized fun add(lista: List<Filtro.Decision>) {
        if (lista.isEmpty()) return
        write((read() + lista).takeLast(max))
    }

    @Synchronized fun all(): List<Filtro.Decision> = read()
    @Synchronized fun removeFirst(n: Int) { if (n > 0) write(read().drop(n)) }
    @Synchronized fun clear() { file.delete() }

    private fun read(): List<Filtro.Decision> =
        if (!file.exists()) emptyList()
        else file.readLines(Charsets.UTF_8).mapNotNull { l -> if (l.isBlank()) null else runCatching { json.decodeFromString(Filtro.Decision.serializer(), l) }.getOrNull() }

    private fun write(l: List<Filtro.Decision>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(l.joinToString("") { json.encodeToString(Filtro.Decision.serializer(), it) + "\n" }, Charsets.UTF_8)
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
    }
}

@Serializable
private data class LoteDecisiones(
    @SerialName("install_id") val installId: String,
    val app: String,
    val version: String,
    val decisiones: List<Filtro.Decision>,
)

/** Sends the queued decisions in batches: 2xx sent, 4xx dropped, 5xx or no network kept for later. */
class EnviadorDecisiones(
    private val cola: ColaDecisiones,
    private val poster: Poster,
    private val url: String,
    private val installId: String,
    private val app: String,
    private val version: String,
    private val userAgent: String,
    private val maxBatch: Int,
) {
    private val json = Json { encodeDefaults = true; explicitNulls = false }

    private fun cuerpo(l: List<Filtro.Decision>) = json.encodeToString(LoteDecisiones.serializer(), LoteDecisiones(installId, app, version, l))

    fun enviar(): Outcome {
        while (true) {
            val todas = cola.all()
            if (todas.isEmpty()) return Outcome.SENT
            var n = minOf(maxBatch, todas.size)
            var body = cuerpo(todas.take(n))
            while (body.toByteArray().size > Telemetria.MAX_BODY_BYTES && n > 1) { n = maxOf(1, n / 2); body = cuerpo(todas.take(n)) }
            if (body.toByteArray().size > Telemetria.MAX_BODY_BYTES) { cola.removeFirst(1); continue }
            val code = try { poster.post(url, body, userAgent) } catch (e: IOException) { return Outcome.RETRY }
            when (code) {
                in 200..299, in 400..499 -> cola.removeFirst(n)
                else -> return Outcome.RETRY
            }
        }
    }
}
