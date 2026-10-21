package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.licencias.LicenseGate
import com.nonosky.nonimailtools.core.licencias.Tipo
import com.nonosky.nonimailtools.core.limpiar.Reason
import com.nonosky.nonimailtools.core.limpiar.Rules
import com.nonosky.nonimailtools.core.limpiar.ScanMode
import com.nonosky.nonimailtools.core.limpiar.ScanProgress
import com.nonosky.nonimailtools.core.limpiar.SenderScore
import com.nonosky.nonimailtools.core.limpiar.Seleccion
import com.nonosky.nonimailtools.ops.EstadoEscaneo
import com.nonosky.nonimailtools.ops.EstadoLimpieza
import com.nonosky.nonimailtools.ops.Trabajo
import com.nonosky.nonimailtools.util.bytesLegibles
import com.nonosky.nonimailtools.ui.theme.Cifras
import com.nonosky.nonimailtools.ui.theme.dulce

@Composable
fun reasonText(r: Reason): String = stringResource(
    when (r) {
        Reason.PROTEGIDO_USUARIO -> R.string.razon_protegido_usuario
        Reason.CONTACTO -> R.string.razon_contacto
        Reason.PROTEGIDO -> R.string.razon_protegido
        Reason.PROMOCION -> R.string.razon_promocion
        Reason.MASIVO_AUTOMATICO -> R.string.razon_masivo_automatico
        Reason.MASIVO -> R.string.razon_masivo
        Reason.AUTOMATICO -> R.string.razon_automatico
        Reason.PERSONA -> R.string.razon_persona
        Reason.IA -> R.string.razon_ia
    },
)

@Composable
fun LimpiarScreen(irAAjustes: () -> Unit, irALicencias: () -> Unit, modifier: Modifier = Modifier) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val v by app.ajustes.valores.collectAsState()
    val cuentas by app.cuentas.cuentas.collectAsState()
    val licencias by app.licencias.licencias.collectAsState()
    val escaneo by app.operaciones.escaneo.collectAsState()
    val limpieza by app.operaciones.limpieza.collectAsState()
    val ocupada by app.operaciones.ocupada.collectAsState()
    val defaults = Defaults.instance

    val cuenta = cuentas.firstOrNull { it.id == v.cuentaLimpiar } ?: cuentas.firstOrNull()
    var modo by rememberSaveable { mutableStateOf(v.escaneoModo.ifEmpty { defaults.cleaning.scanMode }) }
    var cantidad by rememberSaveable {
        mutableStateOf((v.escaneoCantidad.takeIf { it > 0 } ?: if (v.escaneoModo == "dias") defaults.cleaning.scanDays else defaults.cleaning.scanCount).toString())
    }
    var dureza by rememberSaveable { mutableIntStateOf(v.duerezaEfectiva) }
    var simulacion by rememberSaveable { mutableStateOf(true) }
    var confirmar by rememberSaveable { mutableStateOf(false) }
    val elegidos: SnapshotStateList<String> = remember { mutableListOf<String>().toMutableStateList() }
    var keepTexto by rememberSaveable(v.keepOverride) { mutableStateOf(v.keepOverride.ifBlank { defaults.heuristics.keepOverride }) }
    var protTexto by rememberSaveable(v.protegidos) { mutableStateOf(v.protegidos) }

    val listo = escaneo as? EstadoEscaneo.Listo
    val resultado = listo?.r
    // Fresh scan → selection comes from the hardness. Moving the slider recomputes it.
    LaunchedEffect(resultado, dureza) {
        if (resultado != null) {
            elegidos.clear()
            elegidos.addAll(Seleccion.automatica(resultado.senders, dureza, defaults.cleaning.band))
        }
    }

    val keepValido = Rules.isValid(keepTexto)
    val protegidos = remember(v.protegidos) { v.protegidosLista }
    val keepEfectivo = if (keepValido) keepTexto else defaults.heuristics.keepOverride
    val usarIa = v.usarIa && v.ollamaUrl.isNotBlank()
    val cantidadInt = cantidad.toIntOrNull()?.coerceIn(1, 100_000)
    val resumen = resultado?.let { Seleccion.resumen(it.senders, elegidos.toSet()) }
    val puerta = cuenta?.let { LicenseGate.check(listOf(it.email), Tipo.LIMPIAR, licencias, System.currentTimeMillis() / 1000) }

    LazyColumn(
        modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { Encabezado(stringResource(R.string.tab_limpiar)) }

        if (cuentas.isEmpty() || cuenta == null) {
            item {
                Tarjeta {
                    Titulo(stringResource(R.string.sin_cuentas))
                    BotonPrimario(stringResource(R.string.agregar_cuenta), irAAjustes, Modifier.fillMaxWidth())
                }
            }
            return@LazyColumn
        }

        item {
            Tarjeta {
                SelectorCuenta(stringResource(R.string.cuenta), cuentas, cuenta, { app.ajustes.cuentaLimpiar(it.id); app.operaciones.reiniciarEscaneo() })
                Fila(espacio = 8.dp) {
                    Pastilla(stringResource(R.string.ultimos_mensajes), modo == "mensajes", { modo = "mensajes"; cantidad = (v.escaneoCantidad.takeIf { it > 0 && v.escaneoModo == "mensajes" } ?: defaults.cleaning.scanCount).toString() })
                    Pastilla(stringResource(R.string.ultimos_dias), modo == "dias", { modo = "dias"; cantidad = (v.escaneoCantidad.takeIf { it > 0 && v.escaneoModo == "dias" } ?: defaults.cleaning.scanDays).toString() })
                }
                Campo(
                    cantidad, { cantidad = it.filter(Char::isDigit).take(6) },
                    stringResource(if (modo == "dias") R.string.cantidad_dias else R.string.cantidad_mensajes),
                    teclado = KeyboardType.Number,
                )
                if (v.ollamaUrl.isNotBlank()) {
                    FilaInterruptor(stringResource(R.string.usar_ia), v.usarIa, { app.ajustes.usarIa(it) })
                }
                if (escaneo is EstadoEscaneo.Corriendo) {
                    val p = (escaneo as EstadoEscaneo.Corriendo).p
                    Progreso(p)
                    BotonSecundario(stringResource(R.string.cancelar), { app.operaciones.cancelar() }, Modifier.fillMaxWidth(), icono = Icons.Filled.Close)
                } else {
                    BotonPrimario(
                        stringResource(if (resultado != null) R.string.escanear_de_nuevo else R.string.escanear),
                        {
                            app.ajustes.escaneo(modo, cantidadInt ?: 1000)
                            app.operaciones.iniciar(
                                ctx,
                                Trabajo.Escanear(cuenta, ScanMode.of(modo), cantidadInt ?: 1000, usarIa, protegidos, keepEfectivo),
                            )
                        },
                        Modifier.fillMaxWidth(), activo = !ocupada && cantidadInt != null, icono = Icons.Filled.Search,
                    )
                }
                (escaneo as? EstadoEscaneo.Error)?.let { Pista(textoFallo(it.f), error = true) }
            }
        }

        if (resultado != null) {
            item {
                Tarjeta {
                    Fila {
                        Cifra(resultado.reviewed.toString(), stringResource(R.string.revisados), Modifier.weight(1f))
                        Cifra(resultado.senders.size.toString(), stringResource(R.string.remitentes), Modifier.weight(1f))
                        Cifra(resultado.senders.count { it.isProtected }.toString(), stringResource(R.string.protegidos), Modifier.weight(1f))
                    }
                    if (resultado.cancelled) Sello(stringResource(R.string.escaneo_cancelado), Tono.AVISO)
                    if (resultado.aiScored > 0) Sello(stringResource(R.string.ia_puntuados, resultado.aiScored), Tono.NEUTRO)
                    resultado.aiError?.let { Pista(stringResource(R.string.ia_fallo), error = true) }
                }
            }

            item {
                Tarjeta {
                    Fila {
                        Titulo(stringResource(R.string.dureza), Modifier.weight(1f))
                        Text(dureza.toString(), style = MaterialTheme.typography.titleMedium.merge(Cifras), color = d.accent)
                    }
                    Slider(
                        value = dureza.toFloat(), onValueChange = { dureza = it.toInt() },
                        onValueChangeFinished = { app.ajustes.dureza(dureza) }, valueRange = 0f..100f,
                        colors = SliderDefaults.colors(
                            thumbColor = d.accentFill, activeTrackColor = d.accentFill, inactiveTrackColor = d.panel2,
                        ),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Etiqueta(stringResource(R.string.dureza_suave)); Etiqueta(stringResource(R.string.dureza_dura))
                    }
                    if (resumen != null) {
                        Text(
                            stringResource(R.string.seleccion_resumen, resumen.remitentes, resumen.correos, bytesLegibles(resumen.bytes)),
                            style = MaterialTheme.typography.bodyMedium, color = d.text, fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            val corte = Seleccion.lineaDeCorte(dureza, defaults.cleaning.band)
            items(resultado.senders, key = { it.email }) { s ->
                FilaRemitente(
                    s, corte, s.email in elegidos,
                    onCambio = { on -> if (on) { if (s.email !in elegidos) elegidos.add(s.email) } else elegidos.remove(s.email) },
                )
            }

            item {
                Proteccion(
                    keepTexto, { keepTexto = it }, keepValido, protTexto, { protTexto = it },
                    onGuardar = { app.ajustes.keepOverride(if (keepValido) keepTexto else ""); app.ajustes.protegidos(protTexto) },
                    onRestaurar = { keepTexto = defaults.heuristics.keepOverride; app.ajustes.keepOverride("") },
                )
            }

            item {
                Tarjeta {
                    FilaInterruptor(stringResource(R.string.simulacion), simulacion, { simulacion = it }, detalle = stringResource(R.string.simulacion_pista))
                    val estado = limpieza
                    if (estado is EstadoLimpieza.Corriendo) {
                        BarraProgreso(estado.p.fraction)
                        Pista(stringResource(R.string.limpiando_avance, estado.p.done, estado.p.total, estado.p.moved))
                        BotonSecundario(stringResource(R.string.cancelar), { app.operaciones.cancelar() }, Modifier.fillMaxWidth(), icono = Icons.Filled.Close)
                    } else {
                        val n = resumen?.correos ?: 0
                        val bloqueada = !simulacion && puerta?.permitido == false
                        if (bloqueada) PuertaLicencia(Tipo.LIMPIAR, cuenta.email, v.serviceUrl, irALicencias)
                        BotonPrimario(
                            if (simulacion) stringResource(R.string.simular) else stringResource(R.string.mover_papelera, n),
                            {
                                if (simulacion) lanzar(ctx, app, cuenta, elegidos, true, protegidos, keepEfectivo) else confirmar = true
                            },
                            Modifier.fillMaxWidth(),
                            activo = !ocupada && (resumen?.remitentes ?: 0) > 0 && !bloqueada,
                            icono = Iconos.Brillo,
                        )
                        when (estado) {
                            is EstadoLimpieza.Listo -> ResultadoLimpieza(estado)
                            is EstadoLimpieza.Error -> Pista(textoFallo(estado.f), error = true)
                            else -> {}
                        }
                    }
                }
            }
        }
    }

    if (confirmar && cuenta != null) {
        AlertDialog(
            onDismissRequest = { confirmar = false },
            containerColor = d.panel, shape = com.nonosky.nonimailtools.ui.theme.FormaTarjeta,
            title = { Text(stringResource(R.string.confirmar_titulo)) },
            text = { Text(stringResource(R.string.confirmar_texto, resumen?.correos ?: 0, resumen?.remitentes ?: 0, cuenta.email)) },
            confirmButton = {
                BotonPrimario(stringResource(R.string.mover_ahora), {
                    confirmar = false
                    lanzar(ctx, app, cuenta, elegidos, false, protegidos, keepEfectivo)
                })
            },
            dismissButton = { BotonTexto(stringResource(R.string.cancelar), { confirmar = false }) },
        )
    }
}

private fun lanzar(
    ctx: android.content.Context, app: NmtApp, cuenta: com.nonosky.nonimailtools.data.Cuenta, elegidos: List<String>,
    dryRun: Boolean, protegidos: List<String>, keep: String,
) {
    app.operaciones.iniciar(ctx, Trabajo.Limpiar(cuenta, elegidos.toList(), dryRun, protegidos, keep))
}

@Composable
private fun Encabezado(texto: String) =
    Text(texto, style = MaterialTheme.typography.headlineMedium, color = dulce.text, modifier = Modifier.padding(top = 8.dp))

@Composable
private fun Progreso(p: ScanProgress) {
    val fase = when (p.phase) {
        ScanProgress.Phase.CONNECTING -> stringResource(R.string.fase_conectando)
        ScanProgress.Phase.SENT -> stringResource(R.string.fase_enviados)
        ScanProgress.Phase.INBOX -> stringResource(R.string.fase_bandeja, p.done, p.total)
        ScanProgress.Phase.AI -> stringResource(R.string.fase_ia, p.done, p.total)
        ScanProgress.Phase.DONE -> stringResource(R.string.fase_listo)
    }
    BarraProgreso(if (p.total > 0) p.fraction else null)
    fraseFase(fase)
}

@Composable
private fun FilaRemitente(s: SenderScore, corte: Int, marcado: Boolean, onCambio: (Boolean) -> Unit) {
    val d = dulce
    val bloqueado = s.isProtected
    Tarjeta(onClick = if (bloqueado) null else ({ onCambio(!marcado) })) {
        Fila(espacio = 8.dp) {
            if (bloqueado) {
                Icon(Iconos.Escudo, stringResource(R.string.protegido), tint = d.teal, modifier = Modifier.size(24.dp).padding(2.dp))
            } else {
                Checkbox(
                    marcado, null,
                    colors = CheckboxDefaults.colors(checkedColor = d.accentFill, checkmarkColor = androidx.compose.ui.graphics.Color.White, uncheckedColor = d.border2),
                )
            }
            Column(Modifier.weight(1f)) {
                Text(s.name, style = MaterialTheme.typography.titleSmall, color = d.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!s.name.equals(s.email, true)) {
                    Text(s.email, style = MaterialTheme.typography.bodySmall, color = d.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                s.samples.firstOrNull()?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = d.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(s.count.toString(), style = MaterialTheme.typography.titleMedium.merge(Cifras), color = d.text)
                Text(bytesLegibles(s.bytes), style = MaterialTheme.typography.bodySmall.merge(Cifras), color = d.muted)
            }
        }
        Fila(espacio = 10.dp) {
            PistaPuntaje(s.score, corte, bloqueado, Modifier.weight(1f))
            Text(s.score.toString(), style = MaterialTheme.typography.labelMedium.merge(Cifras), color = d.muted)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Sello(reasonText(s.reason), if (bloqueado) Tono.OK else Tono.NEUTRO)
            if (s.unsubscribe) Sello(stringResource(R.string.baja_disponible), Tono.NEUTRO)
        }
    }
}

@Composable
private fun Proteccion(
    keep: String, onKeep: (String) -> Unit, keepValido: Boolean, prot: String, onProt: (String) -> Unit,
    onGuardar: () -> Unit, onRestaurar: () -> Unit,
) {
    var abierto by rememberSaveable { mutableStateOf(false) }
    Tarjeta {
        Fila(Modifier.fillMaxWidth().clickable { abierto = !abierto }.heightIn(min = 48.dp)) {
            Icon(Iconos.Escudo, null, tint = dulce.teal)
            Titulo(stringResource(R.string.protecciones), Modifier.weight(1f))
            Etiqueta(stringResource(if (abierto) R.string.ocultar else R.string.mostrar))
        }
        if (abierto) {
            Campo(prot, onProt, stringResource(R.string.protegidos_lista), unaLinea = false, minLineas = 2, placeholder = stringResource(R.string.protegidos_ejemplo))
            Campo(
                keep, onKeep, stringResource(R.string.patron_proteccion), unaLinea = false, minLineas = 3,
                error = if (keepValido) null else stringResource(R.string.patron_invalido),
            )
            Fila {
                BotonPrimario(stringResource(R.string.guardar), onGuardar, Modifier.weight(1f), activo = keepValido)
                BotonSecundario(stringResource(R.string.restaurar), onRestaurar, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun ResultadoLimpieza(e: EstadoLimpieza.Listo) {
    val r = e.r
    val d = dulce
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Sello(
            if (r.dryRun) stringResource(R.string.resultado_simulacion, r.total, r.trash ?: "—")
            else stringResource(R.string.resultado_movidos, r.total, r.trash ?: "—"),
            Tono.OK,
        )
        if (r.trash == null) Pista(stringResource(R.string.err_sin_papelera), error = true)
        if (r.protectedMessages > 0) Pista(stringResource(R.string.protegidos_respetados, r.protectedMessages))
        if (r.skippedSenders.isNotEmpty()) Pista(stringResource(R.string.omitidos_remitentes, r.skippedSenders.size))
        if (r.cancelled) Sello(stringResource(R.string.operacion_cancelada), Tono.AVISO)
    }
}
