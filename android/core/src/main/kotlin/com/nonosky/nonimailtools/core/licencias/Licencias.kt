package com.nonosky.nonimailtools.core.licencias

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.Base64

/** The two functions a license unlocks. Values match the service and the desktop app. */
enum class Tipo(val id: String) {
    LIMPIAR("limpiar"),
    SINCRONIZAR("sincronizar");

    companion object {
        fun of(id: String?): Tipo? = entries.firstOrNull { it.id == id }
    }
}

/** A stored, signature-checked license. [exp] and [iat] are Unix seconds. */
@Serializable
data class Licencia(
    val lid: String,
    val cuenta: String,
    val tipo: String,
    val canal: String,
    val iat: Long,
    val exp: Long,
    val clave: String,
) {
    fun vigente(nowSec: Long): Boolean = exp > nowSec
}

/** Why a key was rejected. The app maps each one to a localized one-liner. */
enum class LicenseError { FORMAT, NO_PUBLIC_KEY, SIGNATURE, DAMAGED, INCOMPLETE, EXPIRED }

sealed interface LicenseResult {
    data class Ok(val licencia: Licencia) : LicenseResult
    data class Error(val error: LicenseError, val cuenta: String? = null) : LicenseResult
}

/**
 * Offline verification of `NMT1.<payload b64url>.<signature b64url>` keys.
 * The signature is Ed25519 over the ASCII bytes of `NMT1.<payload b64url>`.
 * `payload = {v:1, lid, cuenta, tipo, canal, iat, exp}`.
 */
class LicenseVerifier(private val publicKey: ByteArray?) {

    /** Checks signature and shape. Does NOT look at the expiry (see [add]). */
    fun read(key: String?): LicenseResult {
        val clave = (key ?: "").trim()
        val parts = clave.split('.')
        if (parts.size != 3 || parts[0] != PREFIX) return LicenseResult.Error(LicenseError.FORMAT)
        val pub = publicKey ?: return LicenseResult.Error(LicenseError.NO_PUBLIC_KEY)
        val sig = decodeB64Url(parts[2]) ?: return LicenseResult.Error(LicenseError.SIGNATURE)
        if (!verifyEd25519(pub, "${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII), sig)) {
            return LicenseResult.Error(LicenseError.SIGNATURE)
        }
        val payload = decodeB64Url(parts[1])?.let {
            runCatching { Json.parseToJsonElement(it.toString(Charsets.UTF_8)).jsonObject }.getOrNull()
        } ?: return LicenseResult.Error(LicenseError.DAMAGED)

        val v = payload.num("v")
        val cuenta = payload.str("cuenta")?.trim()?.lowercase()
        val tipo = payload.str("tipo")
        val exp = payload.num("exp")
        if (v != 1.0 || cuenta.isNullOrEmpty() || Tipo.of(tipo) == null || exp == null || !exp.isFinite()) {
            return LicenseResult.Error(LicenseError.INCOMPLETE)
        }
        val lid = payload.str("lid")?.takeIf { it.isNotBlank() } ?: sha256Hex(clave).take(24)
        return LicenseResult.Ok(
            Licencia(
                lid = lid,
                cuenta = cuenta,
                tipo = tipo!!,
                canal = payload.str("canal") ?: "app",
                iat = payload.num("iat")?.toLong() ?: 0L,
                exp = exp.toLong(),
                clave = clave,
            ),
        )
    }

    /** [read] plus the expiry check: an expired license is not added. */
    fun add(key: String?, nowSec: Long): LicenseResult = when (val r = read(key)) {
        is LicenseResult.Ok ->
            if (r.licencia.exp <= nowSec) LicenseResult.Error(LicenseError.EXPIRED, r.licencia.cuenta) else r
        is LicenseResult.Error -> r
    }

    companion object {
        const val PREFIX = "NMT1"

        /** DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410); the raw key follows. */
        private val ED25519_SPKI_PREFIX = byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        )

        /** Raw 32-byte Ed25519 key from a PEM `PUBLIC KEY` block, or null when it is not one. */
        fun publicKeyFromPem(pem: String): ByteArray? {
            val b64 = pem.lineSequence().map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("-----") }
                .joinToString("")
            val der = runCatching { Base64.getDecoder().decode(b64) }.getOrNull() ?: return null
            if (der.size != ED25519_SPKI_PREFIX.size + 32) return null
            if (!der.copyOfRange(0, ED25519_SPKI_PREFIX.size).contentEquals(ED25519_SPKI_PREFIX)) return null
            return der.copyOfRange(ED25519_SPKI_PREFIX.size, der.size)
        }

        /** The production key bundled with the app (`clave-publica.pem`). */
        fun bundled(): LicenseVerifier = LicenseVerifier(bundledPublicKey())

        /** Raw bytes of the bundled key; the signed sender reputation is checked with the same one. */
        fun bundledPublicKey(): ByteArray? {
            val pem = LicenseVerifier::class.java.getResourceAsStream("/com/nonosky/nonimailtools/core/clave-publica.pem")
                ?.use { it.readBytes().toString(Charsets.US_ASCII) }
            return pem?.let { publicKeyFromPem(it) }
        }

        fun verifyEd25519(publicKey: ByteArray, message: ByteArray, signature: ByteArray): Boolean = runCatching {
            if (publicKey.size != 32 || signature.size != 64) return false
            val signer = Ed25519Signer()
            signer.init(false, Ed25519PublicKeyParameters(publicKey, 0))
            signer.update(message, 0, message.size)
            signer.verifySignature(signature)
        }.getOrDefault(false)

        fun decodeB64Url(s: String): ByteArray? =
            runCatching { Base64.getUrlDecoder().decode(s.trimEnd('=')) }.getOrNull()

        private fun sha256Hex(s: String): String =
            MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

        private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.contentOrNull
        private fun JsonObject.num(k: String): Double? =
            (this[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
    }
}

/** What opened the gate for a private-domain account. */
enum class Fuente { LICENCIA, SUSCRIPCION }

/** Result of the gate: may this account run this function for real? */
data class Gate(
    val permitido: Boolean,
    val personal: Boolean,
    val cuenta: String,
    val tipo: Tipo,
    /** Expiry (Unix seconds) of the license or subscription proof that opened the gate, if one did. */
    val vence: Long? = null,
    /** Null for personal accounts and when nothing opened the gate. */
    val fuente: Fuente? = null,
)

object LicenseGate {
    /**
     * Personal accounts pass. With commercial accounts, one valid license of [tipo] for any of them,
     * or a valid subscription proof ([suscripcion], `NMTS1.`) that lists one of them, opens the gate
     * (same rule as the desktop app). Otherwise: scan and simulate only.
     */
    fun check(cuentas: List<String>, tipo: Tipo, licencias: List<Licencia>, nowSec: Long, suscripcion: Comprobante? = null): Gate {
        val lista = cuentas.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        val comerciales = lista.filterNot { Dominios.esPersonal(it) }
        if (comerciales.isEmpty()) return Gate(true, true, lista.firstOrNull() ?: "", tipo)
        for (c in comerciales) {
            val best = licencias
                .filter { it.cuenta == c && it.tipo == tipo.id && it.vigente(nowSec) }
                .maxByOrNull { it.exp }
            if (best != null) return Gate(true, false, c, tipo, best.exp, Fuente.LICENCIA)
            if (suscripcion != null && suscripcion.cubre(c, nowSec)) return Gate(true, false, c, tipo, suscripcion.exp, Fuente.SUSCRIPCION)
        }
        return Gate(false, false, comerciales.first(), tipo)
    }

    /** `{serviceUrl}/licencias.html?cuenta=<email>&tipo=<tipo>&canal=app` (resolved like the desktop app). */
    fun buyUrl(serviceUrl: String, cuenta: String, tipo: Tipo): String {
        val base = URI(serviceUrl.trim()).resolve("/licencias.html")
        fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        return "$base?cuenta=${enc(cuenta.trim().lowercase())}&tipo=${enc(tipo.id)}&canal=app"
    }
}
