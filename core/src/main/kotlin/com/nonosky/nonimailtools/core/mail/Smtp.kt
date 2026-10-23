package com.nonosky.nonimailtools.core.mail

import com.nonosky.nonimailtools.core.ProviderPreset
import com.nonosky.nonimailtools.core.limpiar.EnviadorCorreo
import java.util.Properties
import javax.mail.Message
import javax.mail.Session
import javax.mail.internet.InternetAddress
import javax.mail.internet.MimeMessage

/** Sends the unsubscribe e-mails (mailto) with the same login as the IMAP account. */
object Smtp {
    /** SMTP server of [acc]: the provider's, or the IMAP host with «imap.» turned into «smtp.». */
    fun servidor(acc: ImapAccount, preset: ProviderPreset?): Triple<String, Int, String> {
        val host = preset?.smtpHost?.takeIf { it.isNotBlank() }
            ?: acc.host.replaceFirst(Regex("^imap\\.", RegexOption.IGNORE_CASE), "smtp.")
        return Triple(host, preset?.smtpPort ?: 465, preset?.smtpSecurity ?: "ssl")
    }

    fun enviador(acc: ImapAccount, preset: ProviderPreset?, timeoutMs: Int): EnviadorCorreo = EnviadorCorreo { para, asunto, cuerpo ->
        val (host, port, seg) = servidor(acc, preset)
        runCatching {
            val p = Properties().apply {
                put("mail.smtp.host", host); put("mail.smtp.port", port.toString()); put("mail.smtp.auth", "true")
                put("mail.smtp.connectiontimeout", timeoutMs.toString()); put("mail.smtp.timeout", timeoutMs.toString())
                put("mail.smtp.writetimeout", timeoutMs.toString())
                if (seg == "ssl") put("mail.smtp.ssl.enable", "true")
                else { put("mail.smtp.starttls.enable", "true"); put("mail.smtp.starttls.required", "true") }
                if (acc.oauth) { put("mail.smtp.auth.mechanisms", "XOAUTH2"); put("mail.smtp.auth.login.disable", "true"); put("mail.smtp.auth.plain.disable", "true") }
            }
            val s = Session.getInstance(p)
            val m = MimeMessage(s).apply {
                setFrom(InternetAddress(acc.email))
                setRecipients(Message.RecipientType.TO, InternetAddress.parse(para))
                subject = asunto
                setText(cuerpo, "UTF-8")
            }
            s.getTransport("smtp").use { t -> t.connect(host, port, acc.user, acc.password); t.sendMessage(m, m.allRecipients) }
            null
        }.getOrElse { it.message ?: it.javaClass.simpleName }
    }
}
