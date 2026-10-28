package com.nonosky.nonimailtools.core.licencias

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject

/**
 * The subscription proof the service hands out with `GET /api/plan`:
 * `NMTS1.<payload b64url>.<signature b64url>`, signed with the same Ed25519 key as the `NMT1.` licenses
 * (signature over the ASCII bytes of `NMTS1.<payload b64url>`).
 * `payload = {v:1, uid, cuentas:[lowercase e-mail], periodo, iat, exp}` (Unix seconds). It lasts a few days at
 * most: the app renews it while signed in and keeps the last one to work offline.
 */
data class Comprobante(
    val uid: String,
    val cuentas: List<String>,
    val periodo: String,
    val iat: Long,
    val exp: Long,
    val token: String,
) {
    fun vigente(nowSec: Long): Boolean = exp > nowSec

    /** True when [cuenta] (any case, any spaces) is covered and the proof has not expired. */
    fun cubre(cuenta: String, nowSec: Long): Boolean = vigente(nowSec) && cuenta.trim().lowercase() in cuentas
}

class SubscriptionVerifier(private val publicKey: ByteArray?) {

    /** The proof when the signature and the shape are right. Does NOT look at the expiry (see [Comprobante.vigente]). */
    fun read(token: String?): Comprobante? {
        val t = (token ?: "").trim()
        val parts = t.split('.')
        if (parts.size != 3 || parts[0] != PREFIX) return null
        val pub = publicKey ?: return null
        val sig = LicenseVerifier.decodeB64Url(parts[2]) ?: return null
        if (!LicenseVerifier.verifyEd25519(pub, "${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII), sig)) return null
        val p = LicenseVerifier.decodeB64Url(parts[1])?.let {
            runCatching { Json.parseToJsonElement(it.toString(Charsets.UTF_8)).jsonObject }.getOrNull()
        } ?: return null
        val v = (p["v"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        val exp = (p["exp"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        val cuentas = p["cuentas"] as? JsonArray
        if (v != 1.0 || exp == null || !exp.isFinite() || cuentas == null) return null
        return Comprobante(
            uid = p.str("uid").orEmpty(),
            cuentas = cuentas.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.trim()?.lowercase()?.takeIf { c -> c.isNotEmpty() } },
            periodo = p.str("periodo").orEmpty(),
            iat = (p["iat"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toLong() ?: 0L,
            exp = exp.toLong(),
            token = t,
        )
    }

    companion object {
        const val PREFIX = "NMTS1"

        /** Verifier with the production key bundled with the app. */
        fun bundled(): SubscriptionVerifier = SubscriptionVerifier(LicenseVerifier.bundledPublicKey())

        private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.contentOrNull
    }
}
