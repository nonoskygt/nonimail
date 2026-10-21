package com.nonosky.nonimailtools.ui.theme

import kotlin.math.pow

/*
 * Tokens of the «Dulce» theme (TEMA-DULCE.md). Plain Kotlin on purpose: ARGB ints, no
 * Compose types, so the palette can be unit-tested (contrast, values) on any JVM.
 */

/** Light or dark twin. */
enum class Modo(val id: String) {
    AUTO("auto"), CLARO("claro"), OSCURO("oscuro");

    companion object {
        val Predeterminado = AUTO
        fun of(id: String?): Modo = entries.firstOrNull { it.id == id } ?: Predeterminado

        /** `auto` follows the device clock: light 06:00–17:59, dark otherwise. */
        fun esOscuro(modo: Modo, hora: Int): Boolean = when (modo) {
            CLARO -> false
            OSCURO -> true
            AUTO -> hora !in 6..17
        }
    }
}

/** One accent preset. [oscuroTexto] is the value used as text/icon on dark surfaces. */
data class Acento(
    val id: String,
    val claro: Int,
    val claroPress: Int,
    val oscuroTexto: Int,
    val oscuroRelleno: Int,
    val oscuroPress: Int,
) {
    companion object {
        val Todos = listOf(
            Acento("carmesi", 0xFFB8283F.toInt(), 0xFF9E2135.toInt(), 0xFFEA7A8F.toInt(), 0xFFB8364E.toInt(), 0xFFA52F45.toInt()),
            Acento("verde-azulado", 0xFF17695C.toInt(), 0xFF10544A.toInt(), 0xFF63C9B7.toInt(), 0xFF1C7D6D.toInt(), 0xFF17695C.toInt()),
            Acento("violeta", 0xFF7A45AD.toInt(), 0xFF643893.toInt(), 0xFFC6A6EC.toInt(), 0xFF7D4FB0.toInt(), 0xFF6A3F99.toInt()),
            Acento("azul", 0xFF2C5D9E.toInt(), 0xFF234C83.toInt(), 0xFF8DB8EC.toInt(), 0xFF2F63A8.toInt(), 0xFF27548F.toInt()),
            Acento("ambar", 0xFF8A5A14.toInt(), 0xFF724A10.toInt(), 0xFFE2AC52.toInt(), 0xFF8F5E16.toInt(), 0xFF7A4F12.toInt()),
            Acento("verde", 0xFF1D6F40.toInt(), 0xFF175B34.toInt(), 0xFF5CC98A.toInt(), 0xFF1F7A47.toInt(), 0xFF1A6A3D.toInt()),
        )
        val Predeterminado = Todos[0]
        fun of(id: String?): Acento = Todos.firstOrNull { it.id == id } ?: Predeterminado
    }
}

/** Surface and ink tokens of one mode. Glows are ARGB with their alpha. */
data class Superficies(
    val bg: Int, val bg2: Int, val panel: Int, val panel2: Int,
    val border: Int, val border2: Int, val hair: Int,
    val text: Int, val muted: Int, val ink3: Int, val field: Int, val placeholder: Int,
    val teal: Int, val green: Int, val amber: Int, val red: Int,
    val glowA: Int, val glowB: Int,
    val oscuro: Boolean,
) {
    companion object {
        val Claro = Superficies(
            bg = 0xFFF3F0E9.toInt(), bg2 = 0xFFECE8DF.toInt(), panel = 0xFFFCFBF8.toInt(), panel2 = 0xFFF6F3ED.toInt(),
            border = 0xFFE3DDD1.toInt(), border2 = 0xFFD4CCBE.toInt(), hair = 0xFFE6E0D5.toInt(),
            text = 0xFF27241F.toInt(), muted = 0xFF5C574E.toInt(), ink3 = 0xFF6B655A.toInt(),
            field = 0xFFFFFEFB.toInt(), placeholder = 0xFF7A7366.toInt(),
            teal = 0xFF17695C.toInt(), green = 0xFF1D6F40.toInt(), amber = 0xFF8A5A14.toInt(), red = 0xFFB42318.toInt(),
            glowA = argb(0.10, 214, 160, 72), glowB = argb(0.05, 184, 40, 63),
            oscuro = false,
        )
        val Oscuro = Superficies(
            bg = 0xFF1A1E25.toInt(), bg2 = 0xFF171A20.toInt(), panel = 0xFF21262E.toInt(), panel2 = 0xFF272C35.toInt(),
            border = 0xFF343A45.toInt(), border2 = 0xFF434A57.toInt(), hair = 0xFF2F353F.toInt(),
            text = 0xFFEBE7DF.toInt(), muted = 0xFFB3B8C1.toInt(), ink3 = 0xFF9AA0AB.toInt(),
            field = 0xFF1D2128.toInt(), placeholder = 0xFF8D939E.toInt(),
            teal = 0xFF63C9B7.toInt(), green = 0xFF5CC98A.toInt(), amber = 0xFFE2AC52.toInt(), red = 0xFFF68D80.toInt(),
            glowA = argb(0.075, 198, 54, 80), glowB = argb(0.06, 96, 165, 170),
            oscuro = true,
        )
        fun de(oscuro: Boolean) = if (oscuro) Oscuro else Claro
    }
}

fun argb(alpha: Double, r: Int, g: Int, b: Int): Int =
    ((alpha * 255).toInt() shl 24) or (r shl 16) or (g shl 8) or b

/** Mix [fg] over [bg] at [alpha] (0..1); both opaque ARGB. */
fun mezclar(fg: Int, bg: Int, alpha: Double): Int {
    fun ch(s: Int) = (((fg shr s) and 255) * alpha + ((bg shr s) and 255) * (1 - alpha)).toInt()
    return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
}

/** WCAG relative luminance of an opaque ARGB color. */
fun luminancia(c: Int): Double {
    fun lin(v: Int): Double { val s = v / 255.0; return if (s <= 0.03928) s / 12.92 else ((s + 0.055) / 1.055).pow(2.4) }
    return 0.2126 * lin((c shr 16) and 255) + 0.7152 * lin((c shr 8) and 255) + 0.0722 * lin(c and 255)
}

fun contraste(a: Int, b: Int): Double {
    val la = luminancia(a); val lb = luminancia(b)
    return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
}

/** The accent resolved for a mode: text value, fill value, press value and tint. */
data class AcentoActivo(val texto: Int, val relleno: Int, val press: Int, val tinte: Int) {
    companion object {
        fun de(a: Acento, s: Superficies): AcentoActivo =
            if (s.oscuro) AcentoActivo(a.oscuroTexto, a.oscuroRelleno, a.oscuroPress, mezclar(a.oscuroTexto, s.panel, 0.16))
            else AcentoActivo(a.claro, a.claro, a.claroPress, mezclar(a.claro, s.panel, 0.10))
    }
}
