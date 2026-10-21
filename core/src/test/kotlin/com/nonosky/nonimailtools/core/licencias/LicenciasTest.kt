package com.nonosky.nonimailtools.core.licencias

import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import java.util.Base64

class LicenciasTest {
    private val pair = Ed25519KeyPairGenerator().apply { init(Ed25519KeyGenerationParameters(SecureRandom())) }.generateKeyPair()
    private val pub = (pair.public as Ed25519PublicKeyParameters).encoded
    private val priv = pair.private as Ed25519PrivateKeyParameters
    private val verifier = LicenseVerifier(pub)
    private val b64 = Base64.getUrlEncoder().withoutPadding()

    private fun key(payload: String, signWith: Ed25519PrivateKeyParameters = priv): String {
        val head = "NMT1." + b64.encodeToString(payload.toByteArray())
        val s = Ed25519Signer().apply { init(true, signWith); update(head.toByteArray(Charsets.US_ASCII), 0, head.length) }
        return head + "." + b64.encodeToString(s.generateSignature())
    }

    private fun payload(cuenta: String = "ana@empresa.com", tipo: String = "limpiar", exp: Long = 2_000_000_000L, v: Int = 1) =
        """{"v":$v,"lid":"L1","cuenta":"$cuenta","tipo":"$tipo","canal":"web","iat":1700000000,"exp":$exp}"""

    @Test fun validKeyIsAccepted() {
        val r = verifier.add(key(payload()), 1_800_000_000L)
        assertTrue(r is LicenseResult.Ok)
        val l = (r as LicenseResult.Ok).licencia
        assertEquals("ana@empresa.com", l.cuenta)
        assertEquals("limpiar", l.tipo)
        assertEquals("web", l.canal)
        assertEquals(2_000_000_000L, l.exp)
    }

    @Test fun tamperedPayloadFails() {
        val good = key(payload(cuenta = "ana@empresa.com"))
        val parts = good.split('.')
        val forged = "NMT1." + b64.encodeToString(payload(cuenta = "otro@empresa.com").toByteArray()) + "." + parts[2]
        assertEquals(LicenseError.SIGNATURE, (verifier.read(forged) as LicenseResult.Error).error)
    }

    @Test fun tamperedSignatureFails() {
        val parts = key(payload()).split('.')
        val sig = Base64.getUrlDecoder().decode(parts[2]).also { it[0] = (it[0].toInt() xor 1).toByte() }
        val bad = "${parts[0]}.${parts[1]}.${b64.encodeToString(sig)}"
        assertEquals(LicenseError.SIGNATURE, (verifier.read(bad) as LicenseResult.Error).error)
    }

    @Test fun keySignedByAnotherKeyFails() {
        val other = Ed25519KeyPairGenerator().apply { init(Ed25519KeyGenerationParameters(SecureRandom())) }.generateKeyPair()
        val k = key(payload(), other.private as Ed25519PrivateKeyParameters)
        assertEquals(LicenseError.SIGNATURE, (verifier.read(k) as LicenseResult.Error).error)
    }

    @Test fun badFormatAndMissingPublicKey() {
        assertEquals(LicenseError.FORMAT, (verifier.read("hola") as LicenseResult.Error).error)
        assertEquals(LicenseError.FORMAT, (verifier.read("XXX1.a.b") as LicenseResult.Error).error)
        assertEquals(LicenseError.NO_PUBLIC_KEY, (LicenseVerifier(null).read(key(payload())) as LicenseResult.Error).error)
    }

    @Test fun incompleteAndExpired() {
        assertEquals(LicenseError.INCOMPLETE, (verifier.read(key(payload(tipo = "otra"))) as LicenseResult.Error).error)
        assertEquals(LicenseError.INCOMPLETE, (verifier.read(key(payload(v = 2))) as LicenseResult.Error).error)
        val exp = verifier.add(key(payload(exp = 1_000L)), 2_000L)
        assertEquals(LicenseError.EXPIRED, (exp as LicenseResult.Error).error)
        // read() ignores the expiry; add() does not.
        assertTrue(verifier.read(key(payload(exp = 1_000L))) is LicenseResult.Ok)
    }

    @Test fun bundledProductionKeyLoads() {
        val pem = LicenseVerifier::class.java.getResourceAsStream("/com/nonosky/nonimailtools/core/clave-publica.pem")!!
            .readBytes().toString(Charsets.US_ASCII)
        assertNotNull(LicenseVerifier.publicKeyFromPem(pem))
        // A random key is not signed by production.
        assertTrue(LicenseVerifier.bundled().read(key(payload())) is LicenseResult.Error)
    }

    private fun lic(cuenta: String, tipo: String, exp: Long) = Licencia("x", cuenta, tipo, "app", 0, exp, "k")

    @Test fun gatePersonalIsFree() {
        val g = LicenseGate.check(listOf("ana@gmail.com", "b@hotmail.es"), Tipo.SINCRONIZAR, emptyList(), 10)
        assertTrue(g.permitido && g.personal)
    }

    @Test fun gateCommercialNeedsLicensePerFunction() {
        val now = 1_000L
        val ls = listOf(lic("ana@empresa.com", "limpiar", 5_000))
        assertTrue(LicenseGate.check(listOf("ana@empresa.com"), Tipo.LIMPIAR, ls, now).permitido)
        assertTrue(!LicenseGate.check(listOf("ana@empresa.com"), Tipo.SINCRONIZAR, ls, now).permitido)
        assertTrue(!LicenseGate.check(listOf("ana@empresa.com"), Tipo.LIMPIAR, ls, 6_000).permitido)
        assertTrue(!LicenseGate.check(listOf("otra@empresa.com"), Tipo.LIMPIAR, ls, now).permitido)
    }

    @Test fun buyUrl() {
        assertEquals(
            "https://mt.nonosky.com/licencias.html?cuenta=ana%40empresa.com&tipo=sincronizar&canal=app",
            LicenseGate.buyUrl("https://mt.nonosky.com/", "Ana@Empresa.com", Tipo.SINCRONIZAR),
        )
    }
}
