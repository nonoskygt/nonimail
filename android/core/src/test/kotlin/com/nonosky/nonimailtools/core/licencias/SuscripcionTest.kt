package com.nonosky.nonimailtools.core.licencias

import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import java.util.Base64

/** Subscription proof `NMTS1.` (same Ed25519 key as the `NMT1.` licenses) and the gate that uses it. */
class SuscripcionTest {
    private fun par() = Ed25519KeyPairGenerator().apply { init(Ed25519KeyGenerationParameters(SecureRandom())) }.generateKeyPair()
    private val pair = par()
    private val pub = (pair.public as Ed25519PublicKeyParameters).encoded
    private val priv = pair.private as Ed25519PrivateKeyParameters
    private val verificador = SubscriptionVerifier(pub)
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    private val ahora = 1_800_000_000L

    private fun token(payload: String, prefijo: String = "NMTS1", firma: Ed25519PrivateKeyParameters = priv): String {
        val cabeza = "$prefijo." + b64.encodeToString(payload.toByteArray())
        val s = Ed25519Signer().apply { init(true, firma); update(cabeza.toByteArray(Charsets.US_ASCII), 0, cabeza.length) }
        return cabeza + "." + b64.encodeToString(s.generateSignature())
    }

    private fun payload(cuentas: String = """["ana@empresa.com","b@otra.com"]""", exp: Long = 1_800_500_000L, v: Int = 1) =
        """{"v":$v,"uid":"42","cuentas":$cuentas,"periodo":"mensual","iat":1799900000,"exp":$exp}"""

    @Test fun comprobanteValido() {
        val c = verificador.read(token(payload()))
        assertNotNull(c)
        assertEquals(listOf("ana@empresa.com", "b@otra.com"), c!!.cuentas)
        assertEquals("mensual", c.periodo)
        assertEquals(1_800_500_000L, c.exp)
        assertTrue(c.cubre(" Ana@Empresa.com ", ahora))
        assertFalse(c.cubre("otra@empresa.com", ahora))
    }

    @Test fun firmaMalaOtraLlaveOPrefijoNmt1NoValen() {
        val bueno = token(payload())
        val partes = bueno.split('.')
        val forjado = "NMTS1." + b64.encodeToString(payload(cuentas = """["intruso@empresa.com"]""").toByteArray()) + "." + partes[2]
        assertNull(verificador.read(forjado))
        assertNull(verificador.read(token(payload(), firma = par().private as Ed25519PrivateKeyParameters)))
        // A license key (NMT1.) is not a subscription proof, even with a valid signature.
        assertNull(verificador.read(token(payload(), prefijo = "NMT1")))
        assertNull(verificador.read("basura"))
        assertNull(verificador.read(token(payload(v = 2))))
        assertNull(SubscriptionVerifier(null).read(bueno))
    }

    @Test fun vencidoNoCubre() {
        val c = verificador.read(token(payload(exp = ahora - 1)))!!
        assertFalse(c.vigente(ahora))
        assertFalse(c.cubre("ana@empresa.com", ahora))
    }

    @Test fun puertaComercialAbreConSuscripcionYSinEllaSoloSimula() {
        val c = verificador.read(token(payload()))!!
        val g = LicenseGate.check(listOf("ana@empresa.com"), Tipo.LIMPIAR, emptyList(), ahora, c)
        assertTrue(g.permitido); assertFalse(g.personal)
        assertEquals(Fuente.SUSCRIPCION, g.fuente); assertEquals(c.exp, g.vence)
        // also for sync, whatever the other account is
        assertTrue(LicenseGate.check(listOf("ana@gmail.com", "ana@empresa.com"), Tipo.SINCRONIZAR, emptyList(), ahora, c).permitido)
        // not listed, expired, or no proof: scan and simulate only
        assertFalse(LicenseGate.check(listOf("otra@empresa.com"), Tipo.LIMPIAR, emptyList(), ahora, c).permitido)
        assertFalse(LicenseGate.check(listOf("ana@empresa.com"), Tipo.LIMPIAR, emptyList(), c.exp + 1, c).permitido)
        val sin = LicenseGate.check(listOf("ana@empresa.com"), Tipo.LIMPIAR, emptyList(), ahora)
        assertFalse(sin.permitido); assertNull(sin.fuente)
    }

    @Test fun personalLibreYLicenciaSigueValiendo() {
        val g = LicenseGate.check(listOf("ana@gmail.com"), Tipo.LIMPIAR, emptyList(), ahora, null)
        assertTrue(g.permitido); assertTrue(g.personal); assertNull(g.fuente)
        val lic = Licencia("L1", "ana@empresa.com", "limpiar", "web", 0, ahora + 100, "NMT1.x.y")
        val l = LicenseGate.check(listOf("ana@empresa.com"), Tipo.LIMPIAR, listOf(lic), ahora, null)
        assertTrue(l.permitido); assertEquals(Fuente.LICENCIA, l.fuente)
    }
}
