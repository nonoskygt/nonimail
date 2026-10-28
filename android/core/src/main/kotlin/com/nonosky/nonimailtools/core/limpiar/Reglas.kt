package com.nonosky.nonimailtools.core.limpiar

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * Saved sender rules, same model as the desktop app (`lib/classify.js`, `lib/reglas-sync.js`).
 * A rule key is the sender's address in lower case or `@domain` (the whole domain). The rule of a
 * sender is an exception to the one of its domain; without its own, the domain's applies.
 */
object Reglas {
    const val ELIMINAR = "delete"
    const val PROTEGER = "protect"

    /** Only in the stored/synced form: «no rule», with the date of the removal. */
    const val NINGUNA = "none"

    /** Second level under a two-letter country TLD: tienda.com.gt, bbc.co.uk, empresa.gob.mx. */
    private val SEGUNDO_NIVEL = setOf("com", "net", "org", "co", "gov", "gob", "edu", "mil", "ac", "go")

    /**
     * Domain a sender is grouped by: the last two labels (empresa.com), three when the TLD has two
     * letters and the one before is a typical second level. Lower case; "" when it is not an address.
     */
    fun dominio(email: String?): String {
        val e = email ?: return ""
        val at = e.lastIndexOf('@')
        if (at < 0) return ""
        val p = e.substring(at + 1).trim().lowercase().split('.').filter { it.isNotEmpty() }
        if (p.size <= 2) return p.joinToString(".")
        val n = if (p.last().length == 2 && p[p.size - 2] in SEGUNDO_NIVEL) 3 else 2
        return p.takeLast(n).joinToString(".")
    }

    fun claveDominio(dominio: String) = "@" + dominio.trim().lowercase().removePrefix("@")

    fun esDominio(clave: String) = clave.startsWith("@")

    /** The rule that applies to [email]: its own, else its domain's, else null. */
    fun reglaDe(reglas: Map<String, String>, email: String): String? {
        val e = email.trim().lowercase()
        return reglas[e] ?: reglas[claveDominio(dominio(e))]
    }

    /** Valid: a rule that can be saved or synced. */
    fun esValida(regla: String?) = regla == ELIMINAR || regla == PROTEGER || regla == NINGUNA
}

/** A rule with the moment (epoch ms) it was last set. [Reglas.NINGUNA] is a removal that still travels. */
data class ReglaFecha(val regla: String, val ts: Long)

/** What a merge changed on each side. */
data class Fusion(
    val resultado: Map<String, ReglaFecha>,
    val cambiaLocal: List<String>,
    val cambiaRemoto: List<String>,
)

/** All rules of the phone, with the dates that make the sync merge possible. Immutable. */
data class LibroReglas(val entradas: Map<String, ReglaFecha> = emptyMap()) {

    /** The rules in force (delete / protect) by key. */
    val vigentes: Map<String, String> by lazy {
        entradas.filterValues { it.regla == Reglas.ELIMINAR || it.regla == Reglas.PROTEGER }.mapValues { it.value.regla }
    }

    /** Applies [cambios] (key → rule, «none» removes) with the date [ts]. */
    fun con(cambios: Map<String, String>, ts: Long): LibroReglas {
        if (cambios.isEmpty()) return this
        val m = LinkedHashMap(entradas)
        for ((k, r) in cambios) {
            val clave = k.trim().lowercase()
            if (clave.isEmpty() || clave == "@" || !Reglas.esValida(r)) continue
            m[clave] = ReglaFecha(r, ts)
        }
        return LibroReglas(m)
    }

    /**
     * Changes for choosing [quiere] (delete/protect) on one sender. When it matches what its domain
     * already decides there is no exception: the sender's own rule is removed.
     */
    fun cambiosRemitente(email: String, quiere: String): Map<String, String> {
        val e = email.trim().lowercase()
        val dr = vigentes[Reglas.claveDominio(Reglas.dominio(e))]
        return mapOf(e to if (dr != null && dr == quiere) Reglas.NINGUNA else quiere)
    }

    /**
     * Changes for choosing [regla] on a whole domain: its rule is saved and the exceptions of its
     * senders are erased, so the domain decides for all of them. [regla] «none» removes the domain rule.
     */
    fun cambiosDominio(dominio: String, regla: String): Map<String, String> {
        val d = dominio.trim().lowercase().removePrefix("@")
        val out = LinkedHashMap<String, String>()
        out[Reglas.claveDominio(d)] = regla
        for (k in vigentes.keys) if (!Reglas.esDominio(k) && Reglas.dominio(k) == d) out[k] = Reglas.NINGUNA
        return out
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        /** `{"<key>":{"regla":"delete|protect|none","ts":<ms>}}`; whatever is invalid is ignored. */
        fun leer(texto: String?): LibroReglas {
            if (texto.isNullOrBlank()) return LibroReglas()
            val o = runCatching { json.parseToJsonElement(texto).jsonObject }.getOrNull() ?: return LibroReglas()
            return LibroReglas(ReglasJson.entradas(o))
        }
    }

    fun escribir(): String = ReglasJson.cuerpo(entradas).toString()
}

/** The wire form shared by the storage and the sync (`GET/PUT /api/reglas-remitentes`). */
object ReglasJson {
    const val RUTA = "/api/reglas-remitentes"
    const val REQUIERE_COMPRA = "requiere_compra"

    /** `codigo` of an error answer, at the top level or inside `detail` (FastAPI). */
    fun codigo(cuerpo: JsonObject?): String? {
        val top = (cuerpo?.get("codigo") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
        if (top != null) return top
        val det = cuerpo?.get("detail") as? JsonObject
        return (det?.get("codigo") as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
    }

    /** From `{"<key>":{"regla":…,"ts":…}}`; keys lower-cased, invalid rules dropped, a missing ts is 0. */
    fun entradas(o: JsonObject): Map<String, ReglaFecha> {
        val out = LinkedHashMap<String, ReglaFecha>()
        for ((k, v) in o) {
            val f = runCatching { v.jsonObject }.getOrNull() ?: continue
            val regla = (f["regla"] as? JsonPrimitive)?.contentOrNull ?: continue
            if (!Reglas.esValida(regla)) continue
            val ts = (f["ts"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toLong() ?: 0L
            out[k.trim().lowercase()] = ReglaFecha(regla, ts)
        }
        return out
    }

    /** The map as the service stores it. */
    fun cuerpo(entradas: Map<String, ReglaFecha>): JsonObject = buildJsonObject {
        for ((k, v) in entradas) put(k, buildJsonObject { put("regla", v.regla); put("ts", v.ts) })
    }

    /** The `PUT` body: `{"reglas":{…}}`. */
    fun cuerpoPut(entradas: Map<String, ReglaFecha>): JsonObject = buildJsonObject { put("reglas", cuerpo(entradas)) }

    /** The rules out of a `GET` answer `{"reglas":{…}}` (empty when the body has none). */
    fun deRespuesta(cuerpo: JsonObject?): Map<String, ReglaFecha> =
        (cuerpo?.get("reglas") as? JsonObject)?.let(::entradas).orEmpty()
}

/** The service side of the rules sync, so the merge logic runs on any JVM. */
interface ReglasRemoto {
    val haySesion: Boolean

    /** Answer of `GET /api/reglas-remitentes`: HTTP status and the rules it carried. */
    fun leer(): RespuestaReglas

    /** `PUT /api/reglas-remitentes` with the whole merged map. */
    fun escribir(entradas: Map<String, ReglaFecha>): RespuestaReglas
}

data class RespuestaReglas(val status: Int, val entradas: Map<String, ReglaFecha> = emptyMap(), val codigo: String? = null) {
    val ok get() = status in 200..299

    /** 404 `{codigo: "requiere_compra"}`: the account never bought the service; the rules stay on the phone. */
    val requiereCompra get() = status == 404 && codigo == ReglasJson.REQUIERE_COMPRA
}

/** Where the phone keeps its rules. [fusionar] must read, merge and write as one step. */
interface AlmacenReglas {
    fun leer(): Map<String, ReglaFecha>
    fun fusionar(remoto: Map<String, ReglaFecha>): Fusion
}

sealed interface ResultadoSyncReglas {
    data object SinSesion : ResultadoSyncReglas

    /** 404 / 501: the service does not have the endpoint yet. Everything keeps working locally. */
    data object SinServicio : ResultadoSyncReglas

    /** 404 `requiere_compra`: preferences in the cloud need one purchase at least. Everything keeps working locally. */
    data object RequiereCompra : ResultadoSyncReglas

    /** 401 / 403: the session expired. */
    data object SesionVencida : ResultadoSyncReglas
    data class Error(val detalle: String) : ResultadoSyncReglas
    data class Hecho(val traidas: Int, val enviadas: Int) : ResultadoSyncReglas
}

object SincronizadorReglas {

    /**
     * Pure merge. The newer date wins per key; a removal is a rule «none» with its own date, so it
     * travels too. Rules that are not delete/protect/none are ignored. Same as `fusionar` of the desktop app.
     */
    fun fusionar(local: Map<String, ReglaFecha>, remoto: Map<String, ReglaFecha>): Fusion {
        val out = LinkedHashMap<String, ReglaFecha>()
        val cambiaLocal = ArrayList<String>()
        val cambiaRemoto = ArrayList<String>()
        for (k in LinkedHashSet<String>().apply { addAll(local.keys); addAll(remoto.keys) }) {
            val l = local[k]?.takeIf { Reglas.esValida(it.regla) }
            val r = remoto[k]?.takeIf { Reglas.esValida(it.regla) }
            val ganadora = when {
                r == null -> l
                l == null -> r
                else -> if (r.ts > l.ts) r else l
            } ?: continue
            out[k] = ganadora
            if (l == null || l != ganadora) cambiaLocal += k
            if (r == null || r != ganadora) cambiaRemoto += k
        }
        return Fusion(out, cambiaLocal, cambiaRemoto)
    }

    /** One round: GET, merge into the store, PUT what the service lacks. Never throws. */
    fun sincronizar(almacen: AlmacenReglas, remoto: ReglasRemoto): ResultadoSyncReglas {
        if (!remoto.haySesion) return ResultadoSyncReglas.SinSesion
        return try {
            val got = remoto.leer()
            when {
                got.requiereCompra -> return ResultadoSyncReglas.RequiereCompra
                got.status == 404 || got.status == 501 -> return ResultadoSyncReglas.SinServicio
                got.status == 401 || got.status == 403 -> return ResultadoSyncReglas.SesionVencida
                !got.ok -> return ResultadoSyncReglas.Error("servicio ${got.status}")
            }
            val f = almacen.fusionar(got.entradas)
            if (f.cambiaRemoto.isNotEmpty()) {
                val put = remoto.escribir(f.resultado)
                when {
                    put.requiereCompra -> return ResultadoSyncReglas.RequiereCompra
                    put.status == 401 || put.status == 403 -> return ResultadoSyncReglas.SesionVencida
                    !put.ok -> return ResultadoSyncReglas.Error("servicio ${put.status}")
                }
            }
            ResultadoSyncReglas.Hecho(f.cambiaLocal.size, f.cambiaRemoto.size)
        } catch (e: java.io.IOException) {
            ResultadoSyncReglas.Error(e.message ?: e.javaClass.simpleName)
        }
    }
}
