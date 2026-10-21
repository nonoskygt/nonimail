package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.licencias.LicenseGate
import com.nonosky.nonimailtools.core.licencias.Tipo
import com.nonosky.nonimailtools.core.sync.FolderResult
import com.nonosky.nonimailtools.core.sync.SyncProgress
import com.nonosky.nonimailtools.ops.EstadoSync
import com.nonosky.nonimailtools.ops.Trabajo
import com.nonosky.nonimailtools.util.bytesLegibles
import com.nonosky.nonimailtools.ui.theme.Cifras
import com.nonosky.nonimailtools.ui.theme.dulce

@Composable
fun SincronizarScreen(irAAjustes: () -> Unit, irALicencias: () -> Unit, modifier: Modifier = Modifier) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val v by app.ajustes.valores.collectAsState()
    val cuentas by app.cuentas.cuentas.collectAsState()
    val licencias by app.licencias.licencias.collectAsState()
    val estado by app.operaciones.sync.collectAsState()
    val ocupada by app.operaciones.ocupada.collectAsState()

    var simulacion by rememberSaveable { mutableStateOf(true) }
    var incluir by rememberSaveable(v.syncIncluir) { mutableStateOf(v.syncIncluir) }
    var excluir by rememberSaveable(v.syncExcluir) { mutableStateOf(v.syncExcluir) }

    val origen = cuentas.firstOrNull { it.id == v.syncOrigen } ?: cuentas.firstOrNull()
    val destino = cuentas.firstOrNull { it.id == v.syncDestino && it.id != origen?.id } ?: cuentas.firstOrNull { it.id != origen?.id }
    val puerta = if (origen != null && destino != null)
        LicenseGate.check(listOf(origen.email, destino.email), Tipo.SINCRONIZAR, licencias, System.currentTimeMillis() / 1000) else null

    fun listaDe(s: String) = s.split(',', '\n', ';').map { it.trim() }.filter { it.isNotEmpty() }.toSet()

    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text(stringResource(R.string.tab_sincronizar), style = MaterialTheme.typography.headlineMedium, color = d.text, modifier = Modifier.padding(top = 8.dp)) }

        if (cuentas.size < 2 || origen == null || destino == null) {
            item {
                Tarjeta {
                    Titulo(stringResource(R.string.sync_necesita_dos))
                    BotonPrimario(stringResource(R.string.agregar_cuenta), irAAjustes, Modifier.fillMaxWidth())
                }
            }
            return@LazyColumn
        }

        item {
            Tarjeta {
                SelectorCuenta(stringResource(R.string.origen), cuentas, origen, { app.ajustes.sync(it.id, destino.id.takeIf { d -> d != it.id } ?: "", incluir, excluir) })
                SelectorCuenta(stringResource(R.string.destino), cuentas.filter { it.id != origen.id }, destino, { app.ajustes.sync(origen.id, it.id, incluir, excluir) })
                Campo(incluir, { incluir = it }, stringResource(R.string.carpetas_incluir), placeholder = stringResource(R.string.carpetas_todas))
                Campo(excluir, { excluir = it }, stringResource(R.string.carpetas_excluir), placeholder = stringResource(R.string.carpetas_excluir_ejemplo))
                FilaInterruptor(stringResource(R.string.simulacion), simulacion, { simulacion = it }, detalle = stringResource(R.string.simulacion_sync_pista))
                if (!simulacion && puerta?.permitido == false) {
                    PuertaLicencia(Tipo.SINCRONIZAR, puerta.cuenta, v.serviceUrl, irALicencias)
                }
                if (estado is EstadoSync.Corriendo) {
                    val p = (estado as EstadoSync.Corriendo).p
                    ProgresoSync(p)
                    BotonSecundario(stringResource(R.string.cancelar), { app.operaciones.cancelar() }, Modifier.fillMaxWidth(), icono = Icons.Filled.Close)
                } else {
                    BotonPrimario(
                        stringResource(if (simulacion) R.string.simular else R.string.sincronizar_ahora),
                        {
                            app.ajustes.sync(origen.id, destino.id, incluir, excluir)
                            app.operaciones.iniciar(ctx, Trabajo.Sincronizar(origen, destino, simulacion, listaDe(incluir), listaDe(excluir)))
                        },
                        Modifier.fillMaxWidth(), icono = Icons.Filled.Sync,
                        activo = !ocupada && (simulacion || puerta?.permitido == true),
                    )
                    (estado as? EstadoSync.Error)?.let { Pista(textoFallo(it.f), error = true) }
                }
            }
        }

        val listo = estado as? EstadoSync.Listo
        if (listo != null) {
            val r = listo.r
            item {
                Tarjeta {
                    Titulo(stringResource(if (r.dryRun) R.string.resultado_simulacion_titulo else R.string.resultado_sync_titulo))
                    androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Cifra(r.totals.existing.toString(), stringResource(R.string.ya_estaban), Modifier.weight(1f))
                        Cifra((if (r.dryRun) r.totals.toCopy else r.totals.copied).toString(), stringResource(if (r.dryRun) R.string.por_copiar else R.string.copiados), Modifier.weight(1f))
                        Cifra(r.totals.errors.toString(), stringResource(R.string.errores), Modifier.weight(1f))
                    }
                    if (!r.dryRun) Pista(stringResource(R.string.bytes_copiados, bytesLegibles(r.totals.bytes)))
                    if (r.cancelled) Sello(stringResource(R.string.operacion_cancelada), Tono.AVISO)
                    if (r.overLimit) Sello(stringResource(R.string.limite_alcanzado), Tono.AVISO)
                    r.error?.let { Pista(stringResource(R.string.err_generico), error = true) }
                    r.verification?.let { vf ->
                        if (vf.ok) Sello(stringResource(R.string.verificado_ok), Tono.OK)
                        else Sello(stringResource(R.string.verificado_faltan, vf.missing), Tono.ERROR)
                    }
                }
            }
            items(r.folders, key = { it.source }) { f -> FilaCarpeta(f, r.dryRun) }
        }
    }
}

@Composable
private fun ProgresoSync(p: SyncProgress) {
    val d = dulce
    val fase = when (p.phase) {
        SyncProgress.Phase.CONNECTING -> stringResource(R.string.fase_conectando)
        SyncProgress.Phase.PLANNING -> stringResource(R.string.fase_planificando)
        SyncProgress.Phase.INDEXING -> stringResource(R.string.fase_indexando, p.indexed)
        SyncProgress.Phase.COPYING -> stringResource(R.string.fase_copiando)
        SyncProgress.Phase.VERIFYING -> stringResource(R.string.fase_verificando)
        SyncProgress.Phase.DONE -> stringResource(R.string.fase_listo)
    }
    BarraProgreso(if (p.foldersTotal > 0) p.fraction else null)
    fraseFase(fase)
    if (p.folder.isNotEmpty()) Text(p.folder, style = MaterialTheme.typography.titleSmall, color = d.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Cifra("${p.foldersDone}/${p.foldersTotal}", stringResource(R.string.carpetas), Modifier.weight(1f))
        Cifra(p.copied.toString(), stringResource(R.string.mensajes), Modifier.weight(1f))
        Cifra(bytesLegibles(p.bytes), stringResource(R.string.bytes), Modifier.weight(1f))
    }
}

@Composable
private fun FilaCarpeta(f: FolderResult, simulacion: Boolean) {
    val d = dulce
    Tarjeta(hundida = true) {
        Text(f.source, style = MaterialTheme.typography.titleSmall, color = d.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (f.dest != f.source) Text("→ ${f.dest}", style = MaterialTheme.typography.bodySmall, color = d.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Mini(f.sourceCount.toString(), stringResource(R.string.en_origen))
            Mini(f.existing.toString(), stringResource(R.string.ya_estaban))
            Mini((if (simulacion) f.toCopy else f.copied).toString(), stringResource(if (simulacion) R.string.por_copiar else R.string.copiados))
            if (f.errors > 0) Mini(f.errors.toString(), stringResource(R.string.errores), true)
        }
        f.errorSamples.take(2).forEach { Pista(it, error = true) }
    }
}

@Composable
private fun Mini(valor: String, etiqueta: String, error: Boolean = false) {
    Column {
        Text(valor, style = MaterialTheme.typography.titleSmall.merge(Cifras), color = if (error) dulce.red else dulce.text)
        Etiqueta(etiqueta)
    }
}
