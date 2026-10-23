package com.nonosky.nonimailtools.lang

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/** In-app language: "" = the device's, otherwise "es" or "en". */
object Idioma {
    val Soportados = listOf("es", "en")

    /** Locale for a stored tag; null when the device language should be used. */
    fun localeDe(tag: String): Locale? = if (tag in Soportados) Locale.forLanguageTag(tag) else null

    fun envolver(base: Context, tag: String): Context {
        val loc = localeDe(tag) ?: return base
        Locale.setDefault(loc)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(loc)
        return base.createConfigurationContext(cfg)
    }

    /** "es" for any Spanish locale, else "en": what the strings resolve to. */
    fun efectivo(tag: String, dispositivo: Locale = Locale.getDefault()): String =
        if (tag in Soportados) tag else if (dispositivo.language == "es") "es" else "en"
}
