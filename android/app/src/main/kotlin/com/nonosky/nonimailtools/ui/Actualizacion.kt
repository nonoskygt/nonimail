package com.nonosky.nonimailtools.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.actualizar.EstadoAct
import com.nonosky.nonimailtools.ui.theme.dulce

/** Opens «Install unknown apps» for this package. */
private fun abrirPermisoInstalar(ctx: android.content.Context) {
    runCatching {
        ctx.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/**
 * «Versión X lista · Instalar» above the tabs while an update is verified and waiting.
 * Without the «install unknown apps» permission it shows one line and a button that opens that screen.
 */
@Composable
fun BannerActualizacion() {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val e by app.actualizaciones.estado.collectAsState()
    val puede by app.actualizaciones.puedeInstalar.collectAsState()
    val ocupada by app.operaciones.ocupada.collectAsState()
    val version = when (val s = e) {
        is EstadoAct.Lista -> s.version
        is EstadoAct.Instalando -> s.version
        else -> return
    }
    Tarjeta(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp)) {
        Fila {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.act_banner, version), style = MaterialTheme.typography.titleSmall, color = d.text)
                val linea = when {
                    !puede -> R.string.act_permiso
                    ocupada -> R.string.act_espera
                    e is EstadoAct.Instalando -> R.string.act_instalando
                    else -> null
                }
                if (linea != null) Pista(stringResource(linea))
            }
            if (!puede) BotonPrimario(stringResource(R.string.permitir), { abrirPermisoInstalar(ctx) })
            else BotonPrimario(stringResource(R.string.act_instalar), { app.actualizaciones.instalarDesdeToque() }, activo = !ocupada)
        }
    }
}

@Composable
private fun lineaEstado(e: EstadoAct): String? = when (e) {
    EstadoAct.Reposo -> null
    EstadoAct.Buscando -> stringResource(R.string.act_buscando)
    is EstadoAct.AlDia -> stringResource(R.string.act_al_dia, e.version)
    is EstadoAct.Descargando -> stringResource(R.string.act_disponible, e.version)
    is EstadoAct.Lista -> stringResource(R.string.act_lista_linea, e.version)
    is EstadoAct.Instalando -> stringResource(R.string.act_instalando)
    EstadoAct.Fallo -> stringResource(R.string.act_fallo)
    EstadoAct.SoloRelease -> stringResource(R.string.act_debug)
}

/** Settings: the automatic-update switch, the current version and «Buscar actualizaciones» with its one-line result. */
@Composable
fun BloqueActualizacion() {
    val app = NmtApp.instance
    val v by app.ajustes.valores.collectAsState()
    val e by app.actualizaciones.estado.collectAsState()
    Titulo(stringResource(R.string.act_titulo))
    FilaInterruptor(
        stringResource(R.string.act_auto), v.actualizarAuto, { app.actualizaciones.cambiarAuto(it) },
        detalle = stringResource(R.string.act_auto_linea),
    )
    Pista(stringResource(R.string.act_version, BuildConfig.VERSION_NAME))
    val ocupado = e is EstadoAct.Buscando || e is EstadoAct.Descargando || e is EstadoAct.Instalando
    BotonSecundario(
        stringResource(R.string.act_buscar), { app.actualizaciones.buscarAhora() }, Modifier.fillMaxWidth(),
        activo = !ocupado, icono = Icons.Filled.Refresh,
    )
    lineaEstado(e)?.let { Pista(it, error = e is EstadoAct.Fallo) }
}
