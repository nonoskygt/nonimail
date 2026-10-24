package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.filled.Lock
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
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import com.nonosky.nonimailtools.core.limpiar.EstadoDominio
import com.nonosky.nonimailtools.core.limpiar.FilaLimpiar
import com.nonosky.nonimailtools.core.limpiar.Reason
import com.nonosky.nonimailtools.core.limpiar.Reglas
import com.nonosky.nonimailtools.core.limpiar.Rules
import com.nonosky.nonimailtools.core.limpiar.ScanMode
import com.nonosky.nonimailtools.core.limpiar.ScanProgress
import com.nonosky.nonimailtools.core.limpiar.SenderScore
import com.nonosky.nonimailtools.core.limpiar.Seleccion
import com.nonosky.nonimailtools.ops.EstadoEscaneo
import com.nonosky.nonimailtools.ops.EstadoLimpieza
import com.nonosky.nonimailtools.ops.Operaciones
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
        Reason.REPUTACION -> R.string.razon_reputacion
    },
)

@Composable
fun LimpiarScreen(irAAjustes: () -> Unit, modifier: Modifier = Modifier) {
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
    // Only days: an old «últimos mensajes» setting falls back to the default days.
    var cantidad by rememberSaveable {
        mutableStateOf((v.escaneoCantidad.takeIf { it > 0 && v.escaneoModo == "dias" } ?: defaults.cleaning.scanDays).toString())
    }
    var dureza by rememberSaveable { mutableIntStateOf(v.duerezaEfectiva) }
    var simulacion by rememberSaveable { mutableStateOf(true) }
    var confirmar by rememberSaveable { mutableStateOf(false) }
    // «Darse de baja» per sender: what the person set; otherwise the global switch, only for senders being deleted.
    val bajaMarca = remember { androidx.compose.runtime.mutableStateMapOf<String, Boolean>() }
    var bajaTodos by rememberSaveable { mutableStateOf(false) }
    var keepTexto by rememberSaveable(v.keepOverride) { mutableStateOf(v.keepOverride.ifBlank { defaults.heuristics.keepOverride }) }
    var protTexto by rememberSaveable(v.protegidos) { mutableStateOf(v.protegidos) }

    val listo = escaneo as? EstadoEscaneo.Listo
    val resultado = listo?.r
    // Selection = saved rules first (the sender's own, else its domain's), then the hardness. Nothing else to remember.
    val reglas = v.reglas.vigentes
    val band = defaults.cleaning.band
    val elegidos = remember(resultado, reglas, dureza) { resultado?.let { Seleccion.elegidos(it.senders, reglas, dureza, band) }.orEmpty() }
    fun bajaMarcada(x: SenderScore) = x.unsubLink != null && (bajaMarca[x.email] ?: (bajaTodos && x.email in elegidos))
    LaunchedEffect(resultado) {
        if (resultado != null) bajaMarca.keys.retainAll(resultado.senders.map { it.email }.toSet())
    }
    val abiertos = rememberSaveable(saver = listSaver(save = { it.toList() }, restore = { it.toMutableStateList() })) { mutableListOf<String>().toMutableStateList() }
    fun decidirRemitente(email: String, elimina: Boolean) =
        app.reglas.cambiar(v.reglas.cambiosRemitente(email, if (elimina) Reglas.ELIMINAR else Reglas.PROTEGER))
    fun decidirDominio(dominio: String, regla: String) = app.reglas.cambiar(v.reglas.cambiosDominio(dominio, regla))

    val keepValido = Rules.isValid(keepTexto)
    val protegidos = remember(v.protegidos) { v.protegidosLista }
    val keepEfectivo = if (keepValido) keepTexto else defaults.heuristics.keepOverride
    val usarIa = v.usarIa && v.iaActiva
    val cantidadInt = cantidad.toIntOrNull()?.coerceIn(1, 3650)
    val resumen = resultado?.let { Seleccion.resumen(it.senders, elegidos, reglas) }
    val puerta = cuenta?.let { LicenseGate.check(listOf(it.email), Tipo.LIMPIAR, licencias, System.currentTimeMillis() / 1000) }

    LazyColumn(
        modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { Encabezado(stringResource(R.string.tab_limpiar)) }

        if (cuentas.isEmpty() || cuenta == null) {
            item { Tarjeta { FormularioCuenta(null, onGuardada = {}) } }
            return@LazyColumn
        }

        item {
            Tarjeta {
                SelectorCuenta(stringResource(R.string.cuenta), cuentas, cuenta, { app.ajustes.cuentaLimpiar(it.id); app.operaciones.reiniciarEscaneo() })
                Campo(
                    cantidad, { cantidad = it.filter(Char::isDigit).take(4) },
                    stringResource(R.string.cantidad_dias),
                    teclado = KeyboardType.Number,
                )
                if (v.iaActiva) {
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
                            val dias = cantidadInt ?: defaults.cleaning.scanDays
                            app.ajustes.escaneo("dias", dias)
                            app.operaciones.iniciar(
                                ctx,
                                Trabajo.Escanear(cuenta, ScanMode.DIAS, dias, usarIa, protegidos, keepEfectivo, reglas),
                            )
                        },
                        Modifier.fillMaxWidth(), activo = !ocupada && cantidadInt != null, icono = Icons.Filled.Search,
                    )
                }
                (escaneo as? EstadoEscaneo.Error)?.let { Pista(textoFallo(it.f), error = true) }
            }
        }

        item {
            val cpu by app.operaciones.terminal(Operaciones.Terminal.CPU).collectAsState()
            val ia by app.operaciones.terminal(Operaciones.Terminal.IA).collectAsState()
            if (cpu.isNotEmpty() || ia.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MedidorUso(conIa = usarIa)
                    VentanaTerminal(stringResource(R.string.term_cpu), cpu)
                    if (usarIa) VentanaTerminal(stringResource(R.string.term_ia, nombreModeloIa(v)), ia)
                }
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
                    val umbral = Seleccion.umbral(dureza, band)
                    Pista(
                        (if (umbral > 100) stringResource(R.string.dureza_ninguno) else stringResource(R.string.dureza_hint, umbral)) + " " +
                            stringResource(R.string.dureza_cuenta, Seleccion.marcadosSinRegla(resultado.senders, reglas, dureza, band)),
                    )
                    if (resumen != null) {
                        Text(
                            stringResource(R.string.seleccion_resumen, resumen.remitentes, resumen.correos, bytesLegibles(resumen.bytes)),
                            style = MaterialTheme.typography.bodyMedium, color = d.text, fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }

            val corte = Seleccion.lineaDeCorte(dureza, band)
            for (fila in Seleccion.filas(resultado.senders)) {
                when (fila) {
                    is FilaLimpiar.Suelto -> item(key = "r:" + fila.remitente.email) {
                        FilaRemitente(
                            fila.remitente, corte, fila.remitente.email in elegidos, reglas, hijo = false, bajaMarcada(fila.remitente),
                            onDecidir = { decidirRemitente(fila.remitente.email, it) },
                            onQuitar = { app.reglas.cambiar(mapOf(fila.remitente.email to Reglas.NINGUNA)) },
                            onBaja = { bajaMarca[fila.remitente.email] = !bajaMarcada(fila.remitente) },
                        )
                    }
                    is FilaLimpiar.Dominio -> {
                        val est = Seleccion.estadoDominio(fila, reglas, dureza, band)
                        val abierto = fila.dominio in abiertos || est.excepciones > 0
                        item(key = "d:" + fila.dominio) {
                            FilaDeDominio(
                                fila, est, corte, abierto,
                                onAbrir = { if (fila.dominio in abiertos) abiertos.remove(fila.dominio) else abiertos.add(fila.dominio) },
                                onDecidir = { decidirDominio(fila.dominio, if (it) Reglas.ELIMINAR else Reglas.PROTEGER) },
                                onQuitar = { decidirDominio(fila.dominio, Reglas.NINGUNA) },
                            )
                        }
                        if (abierto) items(fila.miembros, key = { "r:" + it.email }) { m ->
                            FilaRemitente(
                                m, corte, m.email in elegidos, reglas, hijo = true, bajaMarcada(m),
                                onDecidir = { decidirRemitente(m.email, it) },
                                onQuitar = { app.reglas.cambiar(mapOf(m.email to Reglas.NINGUNA)) },
                                onBaja = { bajaMarca[m.email] = !bajaMarcada(m) },
                            )
                        }
                    }
                }
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
                    FilaInterruptor(stringResource(R.string.baja_todos), bajaTodos, { bajaTodos = it })
                    val estado = limpieza
                    if (estado is EstadoLimpieza.Corriendo) {
                        BarraProgreso(estado.p.fraction)
                        fraseFase(stringResource(if (estado.bajando) R.string.fase_baja else R.string.fase_eliminando, estado.p.done, estado.p.total))
                        BotonSecundario(stringResource(R.string.cancelar), { app.operaciones.cancelar() }, Modifier.fillMaxWidth(), icono = Icons.Filled.Close)
                    } else {
                        val n = resumen?.correos ?: 0
                        val bloqueada = !simulacion && puerta?.permitido == false
                        if (bloqueada) PuertaLicencia(Tipo.LIMPIAR, cuenta.email, v.serviceUrl)
                        BotonPrimario(
                            if (simulacion) stringResource(R.string.simular) else stringResource(R.string.mover_papelera, n),
                            {
                                if (simulacion) lanzar(ctx, app, cuenta, elegidos.toList(), true, protegidos, keepEfectivo, resultado.senders.filter(::bajaMarcada), reglas) else confirmar = true
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
                    lanzar(ctx, app, cuenta, elegidos.toList(), false, protegidos, keepEfectivo, resultado?.senders.orEmpty().filter(::bajaMarcada), reglas)
                })
            },
            dismissButton = { BotonTexto(stringResource(R.string.cancelar), { confirmar = false }) },
        )
    }
}

private fun lanzar(
    ctx: android.content.Context, app: NmtApp, cuenta: com.nonosky.nonimailtools.data.Cuenta, elegidos: List<String>,
    dryRun: Boolean, protegidos: List<String>, keep: String, bajas: List<SenderScore>, reglas: Map<String, String>,
) {
    app.operaciones.iniciar(ctx, Trabajo.Limpiar(cuenta, elegidos.toList(), dryRun, protegidos, keep, bajas, reglas))
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
        ScanProgress.Phase.GROUPING -> stringResource(R.string.fase_agrupando)
        ScanProgress.Phase.AI -> stringResource(R.string.fase_ia, p.done, p.total)
        ScanProgress.Phase.DONE -> stringResource(R.string.fase_listo)
    }
    BarraProgreso(if (p.total > 0) p.fraction else null)
    fraseFase(fase)
}

/** Keep / Delete as two exclusive buttons; [elimina] null = no button pressed (a domain with mixed choices). */
@Composable
private fun ConservarEliminar(elimina: Boolean?, onDecidir: (Boolean) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Pastilla(stringResource(R.string.conservar), elimina == false, { onDecidir(false) })
        Pastilla(stringResource(R.string.eliminar), elimina == true, { onDecidir(true) })
    }
}

@Composable
private fun FilaRemitente(
    s: SenderScore, corte: Int, elimina: Boolean, reglas: Map<String, String>, hijo: Boolean, baja: Boolean,
    onDecidir: (Boolean) -> Unit, onQuitar: () -> Unit, onBaja: () -> Unit,
) {
    val d = dulce
    val propia = reglas[s.email.lowercase()]
    val deDominio = reglas[Reglas.claveDominio(Reglas.dominio(s.email))]
    // Only the manual list locks a row; a contact or a bank sender can still be decided (the rule is the person's word).
    val enLista = s.reason == Reason.PROTEGIDO_USUARIO
    Tarjeta(Modifier.padding(start = if (hijo) 20.dp else 0.dp)) {
        Fila(espacio = 8.dp) {
            if (enLista) Icon(Iconos.Escudo, stringResource(R.string.protegido), tint = d.teal, modifier = Modifier.size(24.dp).padding(2.dp))
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
            PistaPuntaje(s.score, corte, enLista || !elimina, Modifier.weight(1f))
            Text(s.score.toString(), style = MaterialTheme.typography.labelMedium.merge(Cifras), color = d.muted)
        }
        if (s.unsubLink != null) {
            Fila(Modifier.clickable(onClick = onBaja), espacio = 8.dp) {
                Checkbox(
                    baja, null,
                    colors = CheckboxDefaults.colors(checkedColor = d.amber, checkmarkColor = androidx.compose.ui.graphics.Color.White, uncheckedColor = d.border2),
                )
                Text(
                    stringResource(if (baja) R.string.baja_al_ejecutar else R.string.darse_de_baja),
                    style = MaterialTheme.typography.bodyMedium, color = if (baja) d.amber else d.text,
                )
            }
        }
        if (!enLista) ConservarEliminar(elimina, onDecidir)
        Fila(espacio = 6.dp) {
            when {
                propia != null && hijo && deDominio != null && deDominio != propia ->
                    Sello(stringResource(R.string.regla_excepcion), Tono.AVISO, icono = Icons.Filled.Lock)
                propia == Reglas.PROTEGER -> Sello(stringResource(R.string.siempre_se_conserva), Tono.OK, icono = Icons.Filled.Lock)
                propia == Reglas.ELIMINAR -> Sello(stringResource(R.string.siempre_se_elimina), Tono.AVISO, icono = Icons.Filled.Lock)
                hijo && deDominio != null -> Sello(stringResource(R.string.regla_dominio), Tono.NEUTRO, icono = Icons.Filled.Lock)
                else -> Sello(reasonText(s.reason), if (s.isProtected) Tono.OK else Tono.NEUTRO)
            }
            Box(Modifier.weight(1f))
            if (propia != null) BotonTexto(stringResource(R.string.quitar_regla), onQuitar)
        }
    }
}

/** A domain with two or more senders: one choice for all, exceptions below. Tap the title to fold. */
@Composable
private fun FilaDeDominio(
    f: FilaLimpiar.Dominio, est: EstadoDominio, corte: Int, abierto: Boolean,
    onAbrir: () -> Unit, onDecidir: (Boolean) -> Unit, onQuitar: () -> Unit,
) {
    val d = dulce
    val descripcion = stringResource(R.string.mostrar_remitentes, f.dominio)
    Tarjeta {
        Fila(Modifier.fillMaxWidth().clickable(onClick = onAbrir).heightIn(min = 48.dp).semantics { contentDescription = descripcion }, espacio = 8.dp) {
            Text(if (abierto) "▾" else "▸", color = d.accent, style = MaterialTheme.typography.titleMedium)
            Column(Modifier.weight(1f)) {
                Text("@" + f.dominio, style = MaterialTheme.typography.titleSmall, color = d.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Etiqueta(stringResource(R.string.n_remitentes, f.miembros.size))
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(f.correos.toString(), style = MaterialTheme.typography.titleMedium.merge(Cifras), color = d.text)
                Text(bytesLegibles(f.bytes), style = MaterialTheme.typography.bodySmall.merge(Cifras), color = d.muted)
            }
        }
        Fila(espacio = 10.dp) {
            PistaPuntaje(f.ruido, corte, est.elimina == false, Modifier.weight(1f))
            Text(f.ruido.toString(), style = MaterialTheme.typography.labelMedium.merge(Cifras), color = d.muted)
        }
        ConservarEliminar(est.elimina, onDecidir)
        Fila(espacio = 6.dp) {
            when (est.regla) {
                Reglas.PROTEGER -> Sello(stringResource(R.string.dominio_conserva), Tono.OK, icono = Icons.Filled.Lock)
                Reglas.ELIMINAR -> Sello(stringResource(R.string.dominio_elimina), Tono.AVISO, icono = Icons.Filled.Lock)
                else -> {}
            }
            if (est.excepciones > 0) Sello(stringResource(R.string.excepciones_n, est.excepciones), Tono.AVISO)
            else if (est.elimina == null) Sello(stringResource(R.string.decisiones_mixtas), Tono.NEUTRO)
            Box(Modifier.weight(1f))
            if (est.regla != null) BotonTexto(stringResource(R.string.quitar_regla), onQuitar)
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
        if (e.bajas.isNotEmpty()) {
            val ok = e.bajas.values.count { it.ok }
            Sello(stringResource(if (r.dryRun) R.string.bajas_simuladas else R.string.bajas_hechas, ok, e.bajas.size), if (ok == e.bajas.size) Tono.OK else Tono.AVISO)
        }
    }
}

/** Name of the model the AI terminal talks to: the LAN Ollama model or the file of the phone model. */
private fun nombreModeloIa(v: com.nonosky.nonimailtools.data.Valores): String =
    if (v.iaModoEfectivo == "red") v.ollamaModelo
    else Defaults.instance.localAi.models.firstOrNull { it.id == v.iaModoEfectivo }?.archivo?.substringBefore(".litertlm") ?: ""
