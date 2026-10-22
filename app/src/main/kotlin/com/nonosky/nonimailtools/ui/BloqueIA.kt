package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.ia.ModeloIa
import com.nonosky.nonimailtools.core.ia.ProgresoDescarga
import com.nonosky.nonimailtools.ia.EstadoIa
import com.nonosky.nonimailtools.ui.theme.FormaControl
import com.nonosky.nonimailtools.ui.theme.dulce
import com.nonosky.nonimailtools.util.bytesLegibles

/** The cards fit three in a row down to this width; narrower screens stack them. */
private val ANCHO_FILA = 400.dp

@Composable
private fun nombreNivel(id: String) = stringResource(
    when (id) { "basico" -> R.string.ia_basico; "mediano" -> R.string.ia_mediano; else -> R.string.ia_grande },
)

/**
 * AI choice: Básico / Mediano / Grande (a model on the phone) or «Servidor en mi red» (Ollama).
 * One progress bar covers verifying, downloading and setting up the chosen model.
 */
@Composable
fun BloqueIA() {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val v by app.ajustes.valores.collectAsState()
    val estado by app.ia.estado.collectAsState()
    val enCursoId by app.ia.modeloEnCurso.collectAsState()
    val niveles = Defaults.instance.localAi.models.sortedBy { it.bytes }
    val equipo = remember { app.ia.equipo(ctx) }
    val recomendado = remember { app.ia.recomendado(ctx).id }
    val trabajando = estado.enCurso
    val elegido = v.iaModoEfectivo

    Titulo(stringResource(R.string.ia_local))
    Pista(stringResource(R.string.ia_ram, bytesLegibles(equipo.ramBytes), bytesLegibles(equipo.libreBytes)))

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val enFila = maxWidth >= ANCHO_FILA
        val tarjetas: @Composable (Modifier, ModeloIa) -> Unit = { mod, m ->
            NivelTarjeta(
                nombre = nombreNivel(m.id), tamano = bytesLegibles(m.bytes), horizontal = !enFila,
                elegido = elegido == m.id, recomendado = m.id == recomendado, activo = !trabajando,
                onClick = { app.ajustes.iaModo(m.id) }, modifier = mod,
            )
        }
        if (enFila) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (m in niveles) tarjetas(Modifier.weight(1f), m)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (m in niveles) tarjetas(Modifier.fillMaxWidth(), m)
            }
        }
    }
    Pastilla(
        stringResource(R.string.ia_servidor_red), elegido == "red",
        { if (!trabajando) app.ajustes.iaModo("red") }, Modifier.fillMaxWidth(),
    )

    val modelo = niveles.firstOrNull { it.id == elegido }
    if (modelo != null) {
        val e = if (enCursoId == modelo.id) estado else EstadoIa.Inactivo
        PasoModelo(modelo, e, listo = v.iaListoId == modelo.id && (e is EstadoIa.Inactivo || e is EstadoIa.Listo))
    }
    if (elegido == "red") PanelServidorRed()
}

@Composable
private fun PasoModelo(m: ModeloIa, e: EstadoIa, listo: Boolean) {
    val app = NmtApp.instance
    val omitir = { app.ajustes.iaModo(""); app.ia.reiniciar() }
    when {
        listo -> Sello(stringResource(R.string.ia_listo), Tono.OK, icono = Icons.Filled.Check)
        e.enCurso -> {
            fraseFase(
                when (e) {
                    is EstadoIa.Descargando -> stringResource(R.string.ia_fase_descargando, ProgresoDescarga.texto(e.hecho, e.total))
                    EstadoIa.Configurando -> stringResource(R.string.ia_fase_configurando)
                    else -> stringResource(R.string.ia_fase_verificando)
                },
            )
            BarraProgreso(if (e is EstadoIa.Descargando && e.total > 0) e.hecho.toFloat() / e.total else null)
            // Always visible while verifying, downloading or setting up; it stops the job for real.
            BotonSecundario(stringResource(R.string.cancelar), { app.ia.cancelar() }, Modifier.fillMaxWidth(), icono = Icons.Filled.Close)
        }
        e is EstadoIa.Error || e is EstadoIa.Cancelado -> {
            val msg = when (e) {
                is EstadoIa.Error -> stringResource(
                    when (e.codigo) {
                        "espacio" -> R.string.ia_err_espacio
                        "integridad" -> R.string.ia_err_integridad
                        "motor" -> R.string.ia_err_motor
                        else -> R.string.ia_err_red
                    },
                )
                else -> stringResource(R.string.ia_cancelado)
            }
            Pista(msg, error = e is EstadoIa.Error)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                BotonPrimario(stringResource(R.string.reintentar), { app.ia.iniciar(m) }, Modifier.weight(1f))
                BotonSecundario(stringResource(R.string.omitir), omitir, Modifier.weight(1f))
            }
        }
        else -> BotonPrimario(
            stringResource(R.string.ia_descargar, bytesLegibles(m.bytes)), { app.ia.iniciar(m) }, Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun NivelTarjeta(
    nombre: String, tamano: String, horizontal: Boolean, elegido: Boolean, recomendado: Boolean, activo: Boolean,
    onClick: () -> Unit, modifier: Modifier = Modifier,
) {
    val d = dulce
    val base = modifier
        .background(if (elegido) d.accentTint else d.panel, FormaControl)
        .border(1.dp, if (elegido) d.accentFill else d.border, FormaControl)
        .clickable(enabled = activo, role = Role.RadioButton, onClick = onClick)
        .padding(10.dp)
    val titulo: @Composable () -> Unit = {
        Column {
            Text(nombre, style = MaterialTheme.typography.titleSmall, color = if (elegido) d.accent else d.text, fontWeight = FontWeight.SemiBold)
            Text(tamano, style = MaterialTheme.typography.bodySmall, color = d.muted)
        }
    }
    if (horizontal) {
        Row(base, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            titulo()
            if (recomendado) Sello(stringResource(R.string.ia_recomendado), Tono.OK, Modifier.padding(start = 8.dp))
        }
    } else {
        Column(base, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            titulo()
            if (recomendado) Sello(stringResource(R.string.ia_recomendado), Tono.OK)
        }
    }
}
