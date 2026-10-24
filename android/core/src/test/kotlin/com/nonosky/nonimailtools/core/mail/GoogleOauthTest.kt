package com.nonosky.nonimailtools.core.mail

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GoogleOauthTest {
    @Test fun `profile email is read and lower-cased`() {
        val body = """{"emailAddress":"Persona@Gmail.com","messagesTotal":10,"threadsTotal":4,"historyId":"99"}"""
        assertEquals("persona@gmail.com", GoogleOauth.correoDelPerfil(body))
    }

    @Test fun `bad profile bodies give null`() {
        assertNull(GoogleOauth.correoDelPerfil("""{"error":{"code":403}}"""))
        assertNull(GoogleOauth.correoDelPerfil("not json"))
    }

    @Test fun `oauth accounts use only XOAUTH2`() {
        val acc = ImapAccount("a@gmail.com", "imap.gmail.com", password = "ya29.token", oauth = true)
        val p = ImapConnection.sessionProperties(acc, ImapTimeouts())
        assertEquals("XOAUTH2", p.getProperty("mail.imaps.auth.mechanisms"))
        assertEquals("true", p.getProperty("mail.imaps.auth.login.disable"))
        val plain = ImapConnection.sessionProperties(acc.copy(oauth = false), ImapTimeouts())
        assertNull(plain.getProperty("mail.imaps.auth.mechanisms"))
    }

    @Test fun identityAsksOnlyOpenidEmailAndReadsTheAddressOfTheIdToken() {
        assertEquals(listOf("openid", "email"), GoogleOauth.SCOPES_IDENTIDAD)
        val payload = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("""{"email":"Ana@Gmail.com","aud":"x"}""".toByteArray())
        assertEquals("ana@gmail.com", GoogleOauth.correoDeIdToken("h.$payload.s"))
        assertEquals(null, GoogleOauth.correoDeIdToken("basura"))
    }
}
