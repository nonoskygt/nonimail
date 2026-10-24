package com.nonosky.nonimailtools.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.data.Cuenta
import com.nonosky.nonimailtools.data.GoogleReautenticar
import com.nonosky.nonimailtools.data.timeouts
import com.nonosky.nonimailtools.ui.theme.FormaTarjeta
import com.nonosky.nonimailtools.ui.theme.dulce
import kotlinx.coroutines.launch
import java.io.File

@Composable
fun AjustesScreen(modifier: Modifier = Modifier) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val v by app.ajustes.valores.collectAsState()
    val cuentas by app.cuentas.cuentas.collectAsState()
    var editando by remember { mutableStateOf<Cuenta?>(null) }
    var agregando by remember { mutableStateOf(false) }
    var borrando by remember { mutableStateOf<Cuenta?>(null) }
    var verLog by remember { mutableStateOf(false) }
    var servicio by remember(v.serviceUrl) { mutableStateOf(v.serviceUrl) }

    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text(stringResource(R.string.tab_ajustes), style = MaterialTheme.typography.headlineMedium, color = d.text, modifier = Modifier.padding(top = 8.dp)) }

        item {
            Tarjeta {
                Titulo(stringResource(R.string.cuentas))
                if (cuentas.isEmpty()) Pista(stringResource(R.string.sin_cuentas))
                for (c in cuentas) FilaCuenta(c, { editando = c }, { borrando = c })
                BotonSecundario(stringResource(R.string.agregar_cuenta), { agregando = true }, Modifier.fillMaxWidth(), icono = Icons.Filled.Add)
            }
        }
        item { BloqueSincronizacion() }
        item { BloqueLicencias() }
        item { Tarjeta { BloqueIdioma() } }
        item { Tarjeta { BloqueApariencia() } }
        item { Tarjeta { BloqueIA() } }
        item { Tarjeta { BloqueActualizacion() } }
        item { Tarjeta { BloqueTelemetria() } }
        item { Column(verticalArrangement = Arrangement.spacedBy(16.dp)) { BloquePermisos() } }
        item {
            Tarjeta {
                Titulo(stringResource(R.string.servicio))
                Campo(servicio, { servicio = it; app.ajustes.serviceUrl(it) }, stringResource(R.string.servicio_url), placeholder = BuildConfig.SERVICE_URL, teclado = KeyboardType.Uri)
                BotonTexto(stringResource(R.string.restaurar), { servicio = BuildConfig.SERVICE_URL; app.ajustes.serviceUrl("") })
            }
        }
        item {
            Tarjeta {
                Titulo(stringResource(R.string.registros))
                Fila {
                    BotonSecundario(stringResource(R.string.ver_registros), { verLog = true }, Modifier.weight(1f), icono = Icons.Filled.Info)
                    BotonSecundario(stringResource(R.string.compartir_registros), { compartirRegistros(ctx) }, Modifier.weight(1f), icono = Icons.Filled.Share)
                }
            }
        }
        item {
            Tarjeta {
                Titulo(stringResource(R.string.acerca_de))
                Fila {
                    Cifra(BuildConfig.VERSION_NAME, stringResource(R.string.version), Modifier.weight(1f))
                    Cifra("MIT", stringResource(R.string.licencia), Modifier.weight(1f))
                }
                Pista("© Danilo Estuardo Gonzalez Rizzo · ${BuildConfig.ORIGEN_DESCARGA}")
                BotonSecundario(stringResource(R.string.github), { abrirUrl(ctx, BuildConfig.REPO_URL) }, Modifier.fillMaxWidth(), icono = Icons.AutoMirrored.Filled.ArrowForward)
            }
        }
    }

    if (agregando || editando != null) {
        DialogoGrande(onCerrar = { agregando = false; editando = null }) {
            Titulo(stringResource(if (editando != null) R.string.editar_cuenta else R.string.agregar_cuenta))
            FormularioCuenta(editando, onGuardada = { agregando = false; editando = null }, onCancelar = { agregando = false; editando = null }, textoGuardar = stringResource(R.string.probar_y_guardar))
        }
    }
    borrando?.let { c ->
        AlertDialog(
            onDismissRequest = { borrando = null }, containerColor = d.panel, shape = FormaTarjeta,
            title = { Text(stringResource(R.string.eliminar_cuenta_titulo)) },
            text = { Text(stringResource(R.string.eliminar_cuenta_texto, c.email)) },
            confirmButton = { BotonPrimario(stringResource(R.string.eliminar), { app.cuentas.borrar(c.id); borrando = null }) },
            dismissButton = { BotonTexto(stringResource(R.string.cancelar), { borrando = null }) },
        )
    }
    if (verLog) {
        val texto = remember { app.telemetry.log.readAll(60_000).ifBlank { "—" } }
        DialogoGrande(onCerrar = { verLog = false }) {
            Titulo(stringResource(R.string.registros))
            SelectionContainer {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                    Text(texto, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = d.text)
                }
            }
            Fila {
                BotonSecundario(stringResource(R.string.compartir_registros), { compartirRegistros(ctx) }, Modifier.weight(1f), icono = Icons.Filled.Share)
                BotonPrimario(stringResource(R.string.cerrar), { verLog = false }, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun FilaCuenta(c: Cuenta, onEditar: () -> Unit, onBorrar: () -> Unit) {
    val d = dulce
    val scope = rememberCoroutineScope()
    val app = NmtApp.instance
    var prueba by remember { mutableStateOf<PruebaCuenta>(PruebaCuenta.Nada) }
    Column {
        Fila {
            Column(Modifier.weight(1f)) {
                Text(c.email, style = MaterialTheme.typography.titleSmall, color = d.text)
                Etiqueta("${nombrePreset(c.proveedor)} · ${c.host}")
            }
            IconButton(onEditar) { Icon(Icons.Filled.Edit, stringResource(R.string.editar), tint = d.muted) }
            IconButton(onBorrar) { Icon(Icons.Filled.Delete, stringResource(R.string.eliminar), tint = d.muted) }
        }
        Fila(espacio = 8.dp) {
            BotonTexto(stringResource(R.string.probar_conexion), {
                prueba = PruebaCuenta.Probando
                scope.launch {
                    prueba = try {
                        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { app.cuentas.imap(c) }
                            ?.let { probarCuenta(it) } ?: PruebaCuenta.Fallo(null, "")
                    } catch (e: GoogleReautenticar) { PruebaCuenta.GoogleReauth }
                }
            }, activo = prueba !is PruebaCuenta.Probando)
            textoPrueba(prueba)?.let { Pista(it, error = prueba !is PruebaCuenta.Ok) }
        }
    }
}

@Composable
fun DialogoGrande(onCerrar: () -> Unit, contenido: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Dialog(onCerrar) {
        Column(
            Modifier.fillMaxWidth().background(dulce.panel, FormaTarjeta).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp), content = contenido,
        )
    }
}

private fun compartirRegistros(ctx: android.content.Context) {
    val app = NmtApp.instance
    runCatching {
        val f = app.telemetry.log.exportTo(File(ctx.cacheDir, "compartir/nonimail-tools-registro.txt"))
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", f)
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_SUBJECT, "NoniMail Tools ${BuildConfig.VERSION_NAME}")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
