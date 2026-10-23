package com.nonosky.nonimailtools.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.nonosky.nonimailtools.R

/** Dulce tokens as Compose colors, for what Material 3 has no role for. */
@Immutable
class Dulce(
    val s: Superficies,
    val acento: AcentoActivo,
) {
    val bg = Color(s.bg); val bg2 = Color(s.bg2); val panel = Color(s.panel); val panel2 = Color(s.panel2)
    val border = Color(s.border); val border2 = Color(s.border2); val hair = Color(s.hair)
    val text = Color(s.text); val muted = Color(s.muted); val ink3 = Color(s.ink3)
    val field = Color(s.field); val placeholder = Color(s.placeholder)
    val teal = Color(s.teal); val green = Color(s.green); val amber = Color(s.amber); val red = Color(s.red)
    val glowA = Color(s.glowA); val glowB = Color(s.glowB)
    val accent = Color(acento.texto)        // text and icons
    val accentFill = Color(acento.relleno)  // buttons and switches (white text on top)
    val accentPress = Color(acento.press)
    val accentTint = Color(acento.tinte)
    val oscuro get() = s.oscuro
}

val LocalDulce = staticCompositionLocalOf<Dulce> { error("DulceTheme missing") }

/** Shorthand: `dulce.panel`, `dulce.accent`… */
val dulce: Dulce @Composable get() = LocalDulce.current

val Figtree = FontFamily(
    Font(R.font.figtree_regular, FontWeight.Normal),
    Font(R.font.figtree_medium, FontWeight.Medium),
    Font(R.font.figtree_semibold, FontWeight.SemiBold),
    Font(R.font.figtree_bold, FontWeight.Bold),
    Font(R.font.figtree_extrabold, FontWeight.ExtraBold),
)

/** 10 dp controls, 14 dp cards, fully round pills. */
val FormaControl = RoundedCornerShape(10.dp)
val FormaTarjeta = RoundedCornerShape(14.dp)
val FormaPastilla = RoundedCornerShape(percent = 50)

private val Shapes = Shapes(
    extraSmall = FormaControl, small = FormaControl, medium = FormaTarjeta, large = FormaTarjeta, extraLarge = FormaTarjeta,
)

private fun estilo(size: Int, line: Int, weight: FontWeight, spacing: Double = 0.0) =
    TextStyle(fontFamily = Figtree, fontSize = size.sp, lineHeight = line.sp, fontWeight = weight, letterSpacing = spacing.em)

/** Titles carry -0.012em, as in the web theme. */
private val Tipografia = Typography(
    displaySmall = estilo(32, 38, FontWeight.ExtraBold, -0.012),
    headlineMedium = estilo(26, 32, FontWeight.Bold, -0.012),
    headlineSmall = estilo(22, 28, FontWeight.Bold, -0.012),
    titleLarge = estilo(20, 26, FontWeight.Bold, -0.012),
    titleMedium = estilo(16, 22, FontWeight.SemiBold, -0.012),
    titleSmall = estilo(14, 20, FontWeight.SemiBold, -0.005),
    bodyLarge = estilo(16, 24, FontWeight.Normal),
    bodyMedium = estilo(14, 20, FontWeight.Normal),
    bodySmall = estilo(12, 16, FontWeight.Normal),
    labelLarge = estilo(14, 20, FontWeight.SemiBold),
    labelMedium = estilo(12, 16, FontWeight.Medium),
    labelSmall = estilo(11, 16, FontWeight.Medium),
)

/** Tabular numerals for counts, bytes and scores. */
val Cifras = TextStyle(fontFamily = Figtree, fontFeatureSettings = "tnum")

/** Maps the Dulce tokens onto a Material 3 scheme (TEMA-DULCE.md, section Android). Dynamic color is never used. */
fun esquema(d: Dulce): ColorScheme {
    val onPrimary = Color.White
    val base = if (d.oscuro) darkColorScheme() else lightColorScheme()
    return base.copy(
        background = d.bg, onBackground = d.text,
        surface = d.panel, onSurface = d.text,
        surfaceVariant = d.panel2, onSurfaceVariant = d.muted,
        surfaceContainerLowest = d.field, surfaceContainerLow = d.panel, surfaceContainer = d.panel2,
        surfaceContainerHigh = d.panel2, surfaceContainerHighest = d.panel2, surfaceBright = d.panel, surfaceDim = d.bg2,
        surfaceTint = d.accentFill,
        outline = d.border2, outlineVariant = d.border,
        // Filled things take the fill value; text/icons that need the accent read it from `dulce.accent`.
        primary = d.accentFill, onPrimary = onPrimary,
        primaryContainer = d.accentTint, onPrimaryContainer = d.accent,
        secondary = d.accent, onSecondary = onPrimary,
        secondaryContainer = d.accentTint, onSecondaryContainer = d.accent,
        tertiary = d.teal, onTertiary = onPrimary,
        tertiaryContainer = d.panel2, onTertiaryContainer = d.teal,
        error = d.red, onError = if (d.oscuro) Color(0xFF1A1E25) else onPrimary,
        errorContainer = d.panel2, onErrorContainer = d.red,
        inverseSurface = d.text, inverseOnSurface = d.bg, inversePrimary = d.accent,
        scrim = Color.Black,
    )
}

@Composable
fun DulceTheme(modo: Modo, acento: Acento, oscuroAhora: Boolean?, content: @Composable () -> Unit) {
    val oscuro = oscuroAhora ?: when (modo) {
        Modo.CLARO -> false
        Modo.OSCURO -> true
        Modo.AUTO -> isSystemInDarkTheme()
    }
    val s = Superficies.de(oscuro)
    val d = Dulce(s, AcentoActivo.de(acento, s))
    CompositionLocalProvider(LocalDulce provides d) {
        MaterialTheme(colorScheme = esquema(d), typography = Tipografia, shapes = Shapes, content = content)
    }
}

/** Page background: cream canvas with a faint amber glow top-right and a second one bottom-left. */
fun Modifier.fondoDulce(d: Dulce): Modifier = this
    .background(d.bg)
    .drawBehind {
        val w = size.width; val h = size.height
        val r1 = maxOf(w, h) * 0.9f
        drawRect(Brush.radialGradient(listOf(d.glowA, Color.Transparent), center = Offset(w * 0.88f, -h * 0.12f), radius = r1))
        val r2 = maxOf(w, h) * 0.75f
        drawRect(Brush.radialGradient(listOf(d.glowB, Color.Transparent), center = Offset(-w * 0.08f, h * 1.08f), radius = r2))
    }
