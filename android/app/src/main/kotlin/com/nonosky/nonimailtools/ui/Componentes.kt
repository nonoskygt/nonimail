package com.nonosky.nonimailtools.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.ui.theme.Cifras
import com.nonosky.nonimailtools.ui.theme.FormaControl
import com.nonosky.nonimailtools.ui.theme.FormaPastilla
import com.nonosky.nonimailtools.ui.theme.FormaTarjeta
import com.nonosky.nonimailtools.ui.theme.dulce

/** Warm-white card with a hairline border and a soft shadow (Dulce `--shadow-card`). */
@Composable
fun Tarjeta(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    hundida: Boolean = false,
    contenido: @Composable ColumnScope.() -> Unit,
) {
    val d = dulce
    val base = modifier
        .fillMaxWidth()
        .shadow(if (d.oscuro) 0.dp else 3.dp, FormaTarjeta, ambientColor = Color(0x1F46341C), spotColor = Color(0x2946341C))
        .background(if (hundida) d.panel2 else d.panel, FormaTarjeta)
        .border(1.dp, d.hair, FormaTarjeta)
    val m = if (onClick != null) base.clickable(onClick = onClick) else base
    Column(m.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = contenido)
}

@Composable
fun Titulo(texto: String, modifier: Modifier = Modifier) =
    Text(texto, modifier, style = MaterialTheme.typography.titleMedium, color = dulce.text)

@Composable
fun Etiqueta(texto: String, modifier: Modifier = Modifier) =
    Text(texto, modifier, style = MaterialTheme.typography.labelMedium, color = dulce.muted)

/** One-line hint under a control. */
@Composable
fun Pista(texto: String, modifier: Modifier = Modifier, error: Boolean = false) =
    Text(texto, modifier, style = MaterialTheme.typography.bodySmall, color = if (error) dulce.red else dulce.muted)

@Composable
fun BotonPrimario(
    texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, activo: Boolean = true, icono: ImageVector? = null,
) {
    val d = dulce
    Button(
        onClick = onClick, enabled = activo, shape = FormaControl,
        modifier = modifier.heightIn(min = 48.dp).then(
            if (activo) Modifier.shadow(6.dp, FormaControl, ambientColor = d.accentFill.copy(alpha = 0.25f), spotColor = d.accentFill.copy(alpha = 0.35f)) else Modifier,
        ),
        colors = ButtonDefaults.buttonColors(
            containerColor = d.accentFill, contentColor = Color.White,
            disabledContainerColor = d.panel2, disabledContentColor = d.placeholder,
        ),
        elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp, 0.dp, 0.dp),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
    ) {
        if (icono != null) { Icon(icono, null, Modifier.size(18.dp)); Box(Modifier.size(8.dp)) }
        Text(texto, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** «Ghost»: panel background with a border. */
@Composable
fun BotonSecundario(
    texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, activo: Boolean = true, icono: ImageVector? = null,
) {
    val d = dulce
    OutlinedButton(
        onClick = onClick, enabled = activo, shape = FormaControl,
        modifier = modifier.heightIn(min = 48.dp),
        border = BorderStroke(1.dp, d.border),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = d.panel, contentColor = d.text, disabledContentColor = d.placeholder),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
    ) {
        if (icono != null) { Icon(icono, null, Modifier.size(18.dp), tint = d.accent); Box(Modifier.size(8.dp)) }
        Text(texto, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun BotonTexto(texto: String, onClick: () -> Unit, modifier: Modifier = Modifier, activo: Boolean = true) =
    TextButton(onClick, modifier.heightIn(min = 48.dp), enabled = activo, shape = FormaControl,
        colors = ButtonDefaults.textButtonColors(contentColor = dulce.accent)) {
        Text(texto, fontWeight = FontWeight.SemiBold)
    }

/** Text field: `--field` background, accent border + 3dp halo on focus. */
@Composable
fun Campo(
    valor: String, onCambio: (String) -> Unit, etiqueta: String, modifier: Modifier = Modifier,
    placeholder: String? = null, error: String? = null, secreto: Boolean = false, teclado: KeyboardType = KeyboardType.Text,
    unaLinea: Boolean = true, minLineas: Int = 1, soloLectura: Boolean = false, sufijo: String? = null,
) {
    val d = dulce
    val fuente = remember { MutableInteractionSource() }
    val enfocado by fuente.collectIsFocusedAsState()
    var visible by remember { mutableStateOf(false) }
    Column(modifier) {
        Box(Modifier.then(if (enfocado) Modifier.border(3.dp, d.accentFill.copy(alpha = 0.18f), FormaControl) else Modifier).padding(if (enfocado) 0.dp else 0.dp)) {
            OutlinedTextField(
                value = valor, onValueChange = onCambio, label = { Text(etiqueta) }, modifier = Modifier.fillMaxWidth(),
                placeholder = placeholder?.let { { Text(it) } },
                singleLine = unaLinea, minLines = minLineas, readOnly = soloLectura, isError = error != null,
                shape = FormaControl, interactionSource = fuente,
                keyboardOptions = KeyboardOptions(keyboardType = if (secreto) KeyboardType.Password else teclado),
                visualTransformation = if (secreto && !visible) PasswordVisualTransformation() else VisualTransformation.None,
                suffix = sufijo?.let { { Text(it) } },
                trailingIcon = if (secreto) {
                    {
                        TextButton({ visible = !visible }) {
                            Text(stringResource(if (visible) R.string.ocultar else R.string.mostrar), color = d.accent, fontWeight = FontWeight.SemiBold)
                        }
                    }
                } else null,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = d.field, unfocusedContainerColor = d.field, disabledContainerColor = d.panel2,
                    focusedBorderColor = d.accentFill, unfocusedBorderColor = d.border, errorBorderColor = d.red,
                    focusedLabelColor = d.accent, unfocusedLabelColor = d.muted,
                    focusedTextColor = d.text, unfocusedTextColor = d.text, cursorColor = d.accentFill,
                    focusedPlaceholderColor = d.placeholder, unfocusedPlaceholderColor = d.placeholder,
                ),
            )
        }
        if (error != null) Pista(error, Modifier.padding(start = 4.dp, top = 4.dp), error = true)
    }
}

/** Label + switch on one row. */
@Composable
fun FilaInterruptor(texto: String, marcado: Boolean, onCambio: (Boolean) -> Unit, modifier: Modifier = Modifier, detalle: String? = null, activo: Boolean = true) {
    val d = dulce
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = activo, role = Role.Switch) { onCambio(!marcado) },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(texto, style = MaterialTheme.typography.bodyLarge, color = if (activo) d.text else d.muted)
            if (detalle != null) Pista(detalle)
        }
        Switch(
            checked = marcado, onCheckedChange = null, enabled = activo,
            colors = SwitchDefaults.colors(
                checkedTrackColor = d.accentFill, checkedThumbColor = Color.White, checkedBorderColor = d.accentFill,
                uncheckedTrackColor = d.panel2, uncheckedThumbColor = d.ink3, uncheckedBorderColor = d.border2,
            ),
        )
    }
}

/** Fully round chip, single choice. */
@Composable
fun Pastilla(texto: String, elegida: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, icono: ImageVector? = null, activa: Boolean = true) {
    val d = dulce
    val fondo by animateColorAsState(if (elegida) d.accentTint else d.panel, label = "pastilla")
    Row(
        modifier.heightIn(min = 40.dp)
            .background(fondo, FormaPastilla)
            .border(1.dp, if (elegida) d.accentFill else d.border, FormaPastilla)
            .clickable(enabled = activa, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icono != null) Icon(icono, null, Modifier.size(16.dp), tint = if (elegida) d.accent else d.muted)
        Text(
            texto, style = MaterialTheme.typography.labelLarge, color = if (elegida) d.accent else if (activa) d.text else d.muted,
            fontWeight = if (elegida) FontWeight.SemiBold else FontWeight.Medium, maxLines = 1,
        )
    }
}

/** A line of text inside a status chip: success, warning or error colored. */
enum class Tono { OK, AVISO, ERROR, NEUTRO }

@Composable
fun Sello(texto: String, tono: Tono, modifier: Modifier = Modifier, icono: ImageVector? = null) {
    val d = dulce
    val c = when (tono) { Tono.OK -> d.green; Tono.AVISO -> d.amber; Tono.ERROR -> d.red; Tono.NEUTRO -> d.muted }
    Row(
        modifier.background(c.copy(alpha = 0.12f), FormaPastilla).padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icono != null) Icon(icono, null, Modifier.size(14.dp), tint = c)
        Text(texto, style = MaterialTheme.typography.labelMedium, color = c, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun BarraProgreso(fraccion: Float?, modifier: Modifier = Modifier) {
    val d = dulce
    if (fraccion == null) LinearProgressIndicator(modifier.fillMaxWidth().height(6.dp), color = d.accentFill, trackColor = d.panel2)
    else LinearProgressIndicator({ fraccion }, modifier.fillMaxWidth().height(6.dp), color = d.accentFill, trackColor = d.panel2)
}

/** A number/label pair with tabular figures. */
@Composable
fun Cifra(valor: String, etiqueta: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(valor, style = MaterialTheme.typography.titleLarge.merge(Cifras), color = dulce.text)
        Etiqueta(etiqueta)
    }
}

@Composable
fun Contenido(modifier: Modifier = Modifier, contenido: @Composable ColumnScope.() -> Unit) =
    Column(modifier, verticalArrangement = Arrangement.spacedBy(16.dp), content = contenido)

@Composable
fun Fila(modifier: Modifier = Modifier, espacio: Dp = 12.dp, contenido: @Composable RowScope.() -> Unit) =
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(espacio), content = contenido)

fun Modifier.descripcion(texto: String) = semantics { contentDescription = texto }
