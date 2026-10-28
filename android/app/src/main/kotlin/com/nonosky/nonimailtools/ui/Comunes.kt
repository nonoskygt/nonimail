package com.nonosky.nonimailtools.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.licencias.Tipo
import com.nonosky.nonimailtools.data.Cuenta
import com.nonosky.nonimailtools.ops.Fallo
import com.nonosky.nonimailtools.ui.theme.FormaControl
import com.nonosky.nonimailtools.ui.theme.FormaPastilla
import com.nonosky.nonimailtools.ui.theme.dulce

fun abrirUrl(ctx: Context, url: String) {
    runCatching {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

@Composable
fun nombreTipo(tipo: Tipo): String = stringResource(if (tipo == Tipo.LIMPIAR) R.string.tipo_limpiar else R.string.tipo_sincronizar)

/** The one-line, translated message for a failure. */
@Composable
fun textoFallo(f: Fallo): String = when (f.tipo) {
    Fallo.Tipo2.AUTENTICACION -> stringResource(R.string.err_autenticacion)
    Fallo.Tipo2.CONEXION -> stringResource(R.string.err_conexion)
    Fallo.Tipo2.SIN_PAPELERA -> stringResource(R.string.err_sin_papelera)
    Fallo.Tipo2.SIN_LICENCIA -> stringResource(R.string.err_sin_licencia)
    Fallo.Tipo2.CUENTA_ILEGIBLE -> stringResource(R.string.err_cuenta_ilegible)
    Fallo.Tipo2.GOOGLE_REAUTH -> stringResource(R.string.err_google_reauth)
    Fallo.Tipo2.OTRO -> stringResource(R.string.err_generico)
}

/** Dropdown that looks like a field and picks one of the accounts. */
@Composable
fun SelectorCuenta(
    etiqueta: String, cuentas: List<Cuenta>, elegida: Cuenta?, onElegir: (Cuenta) -> Unit, modifier: Modifier = Modifier,
) {
    val d = dulce
    var abierto by remember { mutableStateOf(false) }
    Box(modifier) {
        Column(
            Modifier.fillMaxWidth().heightIn(min = 56.dp)
                .background(d.field, FormaControl).border(1.dp, d.border, FormaControl)
                .clickable(role = Role.DropdownList) { abierto = true }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        ) {
            Etiqueta(etiqueta)
            Fila {
                Text(
                    elegida?.email ?: "—", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge,
                    color = d.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Icon(Icons.Filled.KeyboardArrowDown, null, tint = d.muted)
            }
        }
        DropdownMenu(abierto, { abierto = false }, containerColor = d.panel, shape = FormaControl) {
            for (c in cuentas) {
                DropdownMenuItem(
                    text = { Text(c.email, color = d.text) },
                    trailingIcon = { if (c.id == elegida?.id) Icon(Icons.Filled.Check, null, tint = d.accent) },
                    onClick = { onElegir(c); abierto = false },
                )
            }
        }
    }
}

/**
 * Locked card shown when a private-domain account tries a real run without the subscription (or an old
 * license). Scanning and simulating stay free. Signing in brings the subscription by itself.
 */
@Composable
fun PuertaLicencia(tipo: Tipo, cuenta: String) {
    val ctx = LocalContext.current
    val d = dulce
    val sesion by com.nonosky.nonimailtools.NmtApp.instance.servicio.email.collectAsState()
    Tarjeta(hundida = true) {
        Fila(espacio = 8.dp) {
            Icon(Icons.Filled.Lock, null, tint = d.amber, modifier = Modifier.size(20.dp))
            Titulo(stringResource(R.string.puerta_titulo, nombreTipo(tipo)))
        }
        Etiqueta(cuenta)
        var entrando by remember { mutableStateOf(false) }
        Fila {
            BotonPrimario(stringResource(R.string.suscribirse), { abrirUrl(ctx, BuildConfig.SUBSCRIBE_URL) }, Modifier.weight(1f))
            if (sesion.isEmpty()) BotonSecundario(stringResource(R.string.iniciar_sesion), { entrando = true }, Modifier.weight(1f))
        }
        if (entrando) DialogoSesion(onCerrar = { entrando = false }, onAbierta = { entrando = false })
    }
}

/** Score 0–100 as a measured track; [corte] draws the hardness cut line through it. */
@Composable
fun PistaPuntaje(puntaje: Int, corte: Int, protegido: Boolean, modifier: Modifier = Modifier) {
    val d = dulce
    val sobre = !protegido && puntaje >= corte
    val color = when { protegido -> d.teal; sobre -> d.accentFill; else -> d.ink3 }
    Box(modifier.fillMaxWidth().height(8.dp)) {
        Box(Modifier.fillMaxSize().clip(FormaPastilla).background(d.panel2))
        Box(Modifier.fillMaxHeight().fillMaxWidth(puntaje.coerceIn(0, 100) / 100f).clip(FormaPastilla).background(color))
        // The cut line: everything from here to the right is selected.
        Box(Modifier.fillMaxWidth(corte.coerceIn(0, 100) / 100f).fillMaxHeight(), contentAlignment = Alignment.CenterEnd) {
            Box(Modifier.width(2.dp).fillMaxHeight().background(d.text.copy(alpha = 0.7f)))
        }
    }
}

@Composable
fun fraseFase(texto: String) = Text(texto, style = MaterialTheme.typography.bodyMedium, color = dulce.muted, fontWeight = FontWeight.Medium)

private val FondoTerminal = androidx.compose.ui.graphics.Color(0xFF14121A)
private val TextoTerminal = androidx.compose.ui.graphics.Color(0xFFD9D4E6)

/** Live terminal window (dark, monospace, follows the last line). Tapping the title folds it. */
@Composable
fun VentanaTerminal(titulo: String, lineas: List<String>, modifier: Modifier = Modifier) {
    val d = dulce
    var abierta by androidx.compose.runtime.saveable.rememberSaveable(titulo) { mutableStateOf(true) }
    val lista = androidx.compose.foundation.lazy.rememberLazyListState()
    androidx.compose.runtime.LaunchedEffect(lineas.size) { if (lineas.isNotEmpty()) lista.scrollToItem(lineas.size - 1) }
    Column(modifier.fillMaxWidth().clip(FormaControl).background(FondoTerminal)) {
        Text(
            (if (abierta) "▾ " else "▸ ") + titulo,
            style = MaterialTheme.typography.labelMedium, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
            color = d.accent, modifier = Modifier.fillMaxWidth().clickable { abierta = !abierta }.padding(horizontal = 10.dp, vertical = 8.dp),
        )
        if (abierta) {
            androidx.compose.foundation.lazy.LazyColumn(
                Modifier.fillMaxWidth().height(150.dp).padding(start = 10.dp, end = 10.dp, bottom = 8.dp), state = lista,
            ) {
                items(lineas.size) { i ->
                    Text(
                        lineas[i], style = MaterialTheme.typography.bodySmall, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        color = TextoTerminal, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

/**
 * Phone use above the terminals while a job runs: RAM of the phone, CPU of the app (100% = one core)
 * and, for the AI, where the model runs. Android does not let an app read the GPU load, so the engine is shown.
 */
@Composable
fun MedidorUso(conIa: Boolean, modifier: Modifier = Modifier) {
    val app = com.nonosky.nonimailtools.NmtApp.instance
    val uso by app.operaciones.uso.collectAsState()
    val u = uso ?: return
    val tercero = when {
        !conIa -> stringResource(R.string.medidor_nucleos, u.nucleos)
        app.operaciones.motorIa.isNotEmpty() -> stringResource(R.string.medidor_ia, app.operaciones.motorIa)
        else -> stringResource(R.string.medidor_sin_ia)
    }
    Text(
        stringResource(R.string.medidor, "${u.ramUsadaMb} / ${u.ramTotalMb} MB", u.cpuPct, tercero),
        modifier.fillMaxWidth(), style = MaterialTheme.typography.labelMedium.merge(com.nonosky.nonimailtools.ui.theme.Cifras),
        color = dulce.muted,
    )
}
