package com.nonosky.nonimailtools.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.mail.ImapAccount
import com.nonosky.nonimailtools.core.mail.ImapTimeouts
import com.nonosky.nonimailtools.core.mail.Security
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.UUID

/** A mailbox. [clave] is the password ENCRYPTED with the Keystore key; it is never stored or logged in clear. */
@Serializable
data class Cuenta(
    val id: String,
    val email: String,
    /** gmail | outlook | yahoo | icloud | imap (telemetry names them gmail|outlook|imap|yahoo|icloud|otro). */
    val proveedor: String,
    val host: String,
    val port: Int,
    val security: String,
    val user: String,
    val clave: String,
    /** "password" (default, [clave] holds the encrypted password) or "oauth" (Google; no secret stored, token fetched per use). */
    val auth: String = AUTH_CLAVE,
) {
    val esOauth get() = auth == AUTH_OAUTH
    override fun toString() = "Cuenta($email)"
}

const val AUTH_CLAVE = "password"
const val AUTH_OAUTH = "oauth"

val Cuenta.timeouts: ImapTimeouts get() = ImapTimeouts(BuildConfig.IMAP_CONNECT_TIMEOUT_MS, BuildConfig.IMAP_TIMEOUT_MS)

class RepoCuentas(private val ctx: Context, scope: CoroutineScope) {
    private val key = stringPreferencesKey("cuentas_json")
    private val json = Json { ignoreUnknownKeys = true }
    private val ser = ListSerializer(Cuenta.serializer())
    private val scope0 = scope

    private fun parse(s: String?): List<Cuenta> = s?.let { runCatching { json.decodeFromString(ser, it) }.getOrNull() }.orEmpty()

    private val inicial: List<Cuenta> = runBlocking { parse(ctx.nmtStore.data.first()[key]) }
    val cuentas: StateFlow<List<Cuenta>> =
        ctx.nmtStore.data.map { parse(it[key]) }.stateIn(scope, SharingStarted.Eagerly, inicial)

    fun get(id: String?): Cuenta? = cuentas.value.firstOrNull { it.id == id }
    fun porEmail(email: String): Cuenta? = cuentas.value.firstOrNull { it.email.equals(email, ignoreCase = true) }

    /** Passwords in clear, only for scrubbing logs and telemetry. Never logged. */
    fun secretos(): List<String> =
        (cuentas.value.mapNotNull { Secretos.descifrar(it.clave) } + listOfNotNull(GoogleAuth.ultimoToken)).filter { it.length >= 4 }

    /**
     * Login data for the engines. Blocking for OAuth accounts (asks Google for a fresh access
     * token, silent when already granted): call it off the main thread. Throws [GoogleReautenticar]
     * when the person has to sign in with Google again.
     */
    fun imap(c: Cuenta): ImapAccount? {
        if (c.esOauth) {
            val token = GoogleAuth.tokenSilencioso(ctx)
            return ImapAccount(c.email, c.host, c.port, Security.of(c.security), c.user.ifBlank { c.email }, token, oauth = true)
        }
        val pw = Secretos.descifrar(c.clave) ?: return null
        return ImapAccount(c.email, c.host, c.port, Security.of(c.security), c.user.ifBlank { c.email }, pw)
    }

    /** Adds or replaces (same id, or same e-mail). Returns the stored account. */
    fun guardar(id: String?, email: String, proveedor: String, host: String, port: Int, security: String, user: String, password: String?, auth: String = AUTH_CLAVE): Cuenta {
        val actual = cuentas.value.firstOrNull { it.id == id } ?: porEmail(email)
        val clave = if (auth == AUTH_OAUTH) "" else if (password.isNullOrEmpty()) actual?.clave ?: "" else Secretos.cifrar(password)
        val nueva = Cuenta(actual?.id ?: UUID.randomUUID().toString(), email.trim().lowercase(), proveedor, host.trim(), port, security, user.trim(), clave, auth)
        val lista = cuentas.value.filter { it.id != nueva.id } + nueva
        escribir(lista)
        return nueva
    }

    fun borrar(id: String) = escribir(cuentas.value.filter { it.id != id })

    private fun escribir(lista: List<Cuenta>) {
        // Optimistic: callers (and the very next screen) see the change at once.
        runBlocking { ctx.nmtStore.edit { it[key] = json.encodeToString(ser, lista) } }
    }
}
