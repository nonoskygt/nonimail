package com.nonosky.nonimailtools.core.licencias

/**
 * Personal account (public domain: Gmail, Hotmail…) or commercial (own domain).
 *
 * NoniMail Tools is free for personal accounts. An own-domain account is commercial use:
 * it can always simulate, but a real run needs a license.
 *
 * This is the SAME list as the web service (`syncromail/api/app/dominios.py`) and the
 * desktop app (`src/licencias/dominios.js`). If it changes there, it changes here.
 */
object Dominios {
    val PUBLICOS: Set<String> = setOf(
        "126.com", "163.com", "abv.bg", "aim.com", "alice.it", "aliyun.com", "aol.com", "att.net", "bellsouth.net",
        "bk.ru", "bol.com.br", "btinternet.com", "cantv.net", "centrum.cz", "charter.net", "comcast.net",
        "consultant.com", "cox.net", "daum.net", "earthlink.net", "email.com", "fastmail.com", "fastmail.fm",
        "fibertel.com.ar", "free.fr", "freenet.de", "frontier.com", "gmail.com", "gmx.com", "googlemail.com",
        "hanmail.net", "hey.com", "icloud.com", "ig.com.br", "inbox.com", "inbox.ru", "intelnett.com",
        "interia.pl", "juno.com", "keemail.me", "laposte.net", "libero.it", "list.ru", "mac.com", "mail.com",
        "mail.ru", "mailbox.org", "me.com", "movistar.es", "msn.com", "myself.com", "naver.com", "ntlworld.com",
        "o2.pl", "onet.pl", "ono.com", "optonline.net", "orange.fr", "passport.com", "pm.me", "post.com",
        "posteo.de", "prodigy.net.mx", "proton.me", "protonmail.ch", "protonmail.com", "qq.com", "rambler.ru",
        "rediffmail.com", "rocketmail.com", "sbcglobal.net", "seznam.cz", "sfr.fr", "sina.com", "sky.com",
        "sohu.com", "speedy.com.ar", "t-online.de", "talktalk.net", "telefonica.net", "terra.com", "terra.com.br",
        "terra.es", "tim.it", "tiscali.it", "turbonett.com", "tuta.com", "tuta.io", "tutamail.com", "tutanota.com",
        "tutanota.de", "uol.com.br", "usa.com", "verizon.net", "virgilio.it", "virginmedia.com", "wanadoo.fr",
        "web.de", "wp.pl", "ya.ru", "yandex.com", "yeah.net", "ymail.com", "zohomail.com",
    )

    /** Families with country domains: hotmail.es, outlook.com.mx, yahoo.com.ar, live.cl, gmx.de… */
    private val FAMILIAS = Regex(
        "^(hotmail|outlook|live|windowslive|yahoo|ymail|gmx|yandex|aol)" +
            "\\.(com|net|org|[a-z]{2}|(com|co|net|org)\\.[a-z]{2})$",
    )

    private val EMAIL = Regex("^[^@\\s]+@([^@\\s]+\\.[^@\\s]+)$")

    /** Domain of an address, lower-case, without a trailing dot ("" when it is not an address). */
    fun dominioDe(email: String?): String {
        val m = EMAIL.matchEntire((email ?: "").trim().lowercase()) ?: return ""
        return m.groupValues[1].trimEnd('.')
    }

    fun esCorreo(email: String?): Boolean = dominioDe(email).isNotEmpty()

    /** True when the address belongs to a public provider (personal use, free). */
    fun esPersonal(email: String?): Boolean {
        val d = dominioDe(email)
        return d.isNotEmpty() && (d in PUBLICOS || FAMILIAS.matches(d))
    }
}
