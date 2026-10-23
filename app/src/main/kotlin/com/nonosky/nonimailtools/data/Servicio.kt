package com.nonosky.nonimailtools.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.licencias.LicenseResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Outcome of signing in to the web service. */
sealed interface Acceso {
    /** Signed in; [importadas] licenses came down and passed the offline check. */
    data class Abierta(val importadas: Int) : Acceso
    /** New e-mail: the service sent a 6-digit code. */
    data object PideCodigo : Acceso
    data class Fallo(val motivo: Motivo) : Acceso
    enum class Motivo { CREDENCIALES, CODIGO, DEMASIADOS, RED, SERVICIO }
}

/**
 * Session with the NoniMail Tools web service (the same account as the website). Only private-domain
 * accounts need it: it brings down the licenses bought for them. The real gate stays the signed key,
 * verified offline by [RepoLicencias]; nothing is accepted just because the service says so.
 * Blocking calls: never on the main thread.
 */
class Servicio(private val ctx: Context, private val ajustes: Ajustes, private val licencias: RepoLicencias, scope: CoroutineScope) {
    private val kToken = stringPreferencesKey("servicio_token")
    private val kEmail = stringPreferencesKey("servicio_email")
    private val json = Json { ignoreUnknownKeys = true }

    /** E-mail of the open session, "" when signed out. */
    val email: StateFlow<String> = ctx.nmtStore.data.map { it[kEmail] ?: "" }
        .stateIn(scope, SharingStarted.Eagerly, runBlocking { ctx.nmtStore.data.first()[kEmail] ?: "" })

    private fun token(): String? = runBlocking { ctx.nmtStore.data.first()[kToken] }?.let { Secretos.descifrar(it) }

    private data class Resp(val status: Int, val body: JsonObject?)

    private fun llamar(metodo: String, ruta: String, cuerpo: JsonObject? = null, token: String? = null): Resp {
        val c = URL(ajustes.valores.value.serviceUrl.trimEnd('/') + ruta).openConnection() as HttpURLConnection
        try {
            c.requestMethod = metodo
            c.connectTimeout = BuildConfig.HTTP_TIMEOUT_MS
            c.readTimeout = BuildConfig.HTTP_TIMEOUT_MS
            c.setRequestProperty("Accept", "application/json")
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            if (cuerpo != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(cuerpo.toString().toByteArray()) }
            }
            val st = c.responseCode
            val txt = runCatching { (if (st < 400) c.inputStream else c.errorStream)?.use { it.readBytes().toString(Charsets.UTF_8) } }.getOrNull()
            return Resp(st, txt?.let { runCatching { json.parseToJsonElement(it).jsonObject }.getOrNull() })
        } finally {
            c.disconnect()
        }
    }

    private fun motivo(st: Int) = when (st) {
        401, 403 -> Acceso.Motivo.CREDENCIALES
        429 -> Acceso.Motivo.DEMASIADOS
        else -> Acceso.Motivo.SERVICIO
    }

    private fun abrir(email: String, r: Resp, siFalla: Acceso.Motivo? = null): Acceso {
        val tok = r.body?.get("access_token")?.jsonPrimitive?.contentOrNull
        if (r.status !in 200..299 || tok.isNullOrBlank()) return Acceso.Fallo(siFalla ?: motivo(r.status))
        runBlocking { ctx.nmtStore.edit { it[kToken] = Secretos.cifrar(tok); it[kEmail] = email } }
        return Acceso.Abierta(runCatching { traerLicencias() }.getOrDefault(0))
    }

    fun acceder(email: String, clave: String): Acceso = try {
        val e = email.trim().lowercase()
        val r = llamar("POST", "/api/auth/acceder", buildJsonObject { put("email", e); put("password", clave) })
        if (r.status == 202 || r.body?.get("codigo") != null) Acceso.PideCodigo else abrir(e, r)
    } catch (_: IOException) { Acceso.Fallo(Acceso.Motivo.RED) }

    fun confirmar(email: String, codigo: String, clave: String): Acceso = try {
        val e = email.trim().lowercase()
        val r = llamar("POST", "/api/auth/register-confirm", buildJsonObject { put("email", e); put("code", codigo.filter(Char::isDigit)); put("password", clave) })
        abrir(e, r, if (r.status in 400..499 && r.status != 429) Acceso.Motivo.CODIGO else null)
    } catch (_: IOException) { Acceso.Fallo(Acceso.Motivo.RED) }

    /** Brings down the licenses of the open session; each one goes through the offline check. Returns how many entered. */
    fun traerLicencias(): Int {
        val tok = token() ?: return 0
        val r = llamar("GET", "/api/licencias", token = tok)
        if (r.status == 401 || r.status == 403) { cerrar(); return 0 }
        if (r.status !in 200..299) return 0
        val filas = r.body?.get("licencias")?.jsonArray ?: return 0
        var n = 0
        for (f in filas) {
            val o = runCatching { f.jsonObject }.getOrNull() ?: continue
            val clave = o["clave"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val estado = o["estado"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase()
            if (clave.isEmpty() || Regex("anulad|revocad|cancelad").containsMatchIn(estado)) continue
            if (licencias.agregar(clave) is LicenseResult.Ok) n++
        }
        return n
    }

    fun cerrar() {
        runBlocking { ctx.nmtStore.edit { it.remove(kToken); it.remove(kEmail) } }
    }
}
