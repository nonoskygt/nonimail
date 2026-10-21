package com.nonosky.nonimailtools.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The few icons that Material's core set lacks, drawn here so the app does not pull the whole
 * extended icon library (thousands of classes) into the APK.
 */
object Iconos {
    private fun icono(nombre: String, bloque: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(nombre, 24.dp, 24.dp, 24f, 24f).path(fill = SolidColor(Color.Black), pathFillType = PathFillType.NonZero, pathBuilder = bloque).build()

    /** Shield (protected sender). */
    val Escudo: ImageVector by lazy {
        icono("Escudo") {
            moveTo(12f, 2f); lineTo(4f, 5f); verticalLineTo(11f)
            curveTo(4f, 16.5f, 7.4f, 21.3f, 12f, 22.5f)
            curveTo(16.6f, 21.3f, 20f, 16.5f, 20f, 11f)
            verticalLineTo(5f); close()
        }
    }

    /** Four-point spark (clean). */
    val Brillo: ImageVector by lazy {
        icono("Brillo") {
            moveTo(12f, 2f); lineTo(14.4f, 9.6f); lineTo(22f, 12f); lineTo(14.4f, 14.4f)
            lineTo(12f, 22f); lineTo(9.6f, 14.4f); lineTo(2f, 12f); lineTo(9.6f, 9.6f); close()
        }
    }

    /** Key (licenses). */
    val Llave: ImageVector by lazy {
        icono("Llave") {
            moveTo(12.65f, 10f)
            curveTo(11.83f, 7.67f, 9.61f, 6f, 7f, 6f)
            curveToRelative(-3.31f, 0f, -6f, 2.69f, -6f, 6f)
            reflectiveCurveToRelative(2.69f, 6f, 6f, 6f)
            curveToRelative(2.61f, 0f, 4.83f, -1.67f, 5.65f, -4f)
            horizontalLineTo(17f); verticalLineToRelative(4f); horizontalLineToRelative(4f)
            verticalLineToRelative(-4f); horizontalLineToRelative(2f); verticalLineToRelative(-4f); close()
            moveTo(7f, 14f)
            curveToRelative(-1.1f, 0f, -2f, -0.9f, -2f, -2f)
            reflectiveCurveToRelative(0.9f, -2f, 2f, -2f)
            reflectiveCurveToRelative(2f, 0.9f, 2f, 2f)
            reflectiveCurveToRelative(-0.9f, 2f, -2f, 2f); close()
        }
    }

    /** Battery. */
    val Bateria: ImageVector by lazy {
        icono("Bateria") {
            moveTo(15.67f, 4f); horizontalLineTo(14f); verticalLineTo(2f); horizontalLineToRelative(-4f); verticalLineToRelative(2f)
            horizontalLineTo(8.33f); curveTo(7.6f, 4f, 7f, 4.6f, 7f, 5.33f); verticalLineToRelative(15.33f)
            curveTo(7f, 21.4f, 7.6f, 22f, 8.33f, 22f); horizontalLineToRelative(7.33f)
            curveToRelative(0.74f, 0f, 1.34f, -0.6f, 1.34f, -1.33f); verticalLineTo(5.33f)
            curveTo(17f, 4.6f, 16.4f, 4f, 15.67f, 4f); close()
            moveTo(13f, 18f); horizontalLineToRelative(-2f); verticalLineToRelative(-2f); horizontalLineToRelative(2f); close()
            moveTo(13f, 14f); horizontalLineToRelative(-2f); verticalLineTo(9f); horizontalLineToRelative(2f); close()
        }
    }
}
