package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.servicio.ResultadoTareas
import com.nonosky.nonimailtools.core.servicio.Tarea
import com.nonosky.nonimailtools.data.Cuenta
import com.nonosky.nonimailtools.ui.theme.FormaTarjeta
import com.nonosky.nonimailtools.ui.theme.dulce
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.time.OffsetDateTime
import java.util.Date

/** ISO 8601 of the service → local date and time; the raw text when it cannot be read. */
private fun fechaLocal(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    return runCatching { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date.from(OffsetDateTime.parse(iso).toInstant())) }.getOrDefault(iso)
}

/** One-line message for a failed call to `/api/tareas`. */
private fun mensajeError(ctx: android.content.Context, r: ResultadoTareas<*>): String? = when (r) {
    is ResultadoTareas.Ok -> null
    ResultadoTareas.SinRed -> ctx.getString(R.string.sesion_err_red)
    is ResultadoTareas.Error -> when {
        r.status == 402 -> ctx.getString(R.string.tarea_err_lugar)
        r.status == 409 -> ctx.getString(R.string.tarea_err_duplicada)
        r.status == 422 || r.codigo == "credenciales" -> ctx.getString(R.string.tarea_err_credenciales)
        r.status == 401 || r.status == 403 -> ctx.getString(R.string.sync_vencida)
        // 400: invalid data or the per-user task limit; the service's own text when it sends one.
        r.status == 400 -> r.detalle?.takeIf { it.isNotBlank() } ?: ctx.getString(R.string.tarea_err_rechazada)
        else -> ctx.getString(R.string.err_generico)
    }
}

/**
 * «Mantener funcionando en el servidor» for Limpiar ([Tarea.LIMPIAR]: every N days with [dureza]) and
 * Sincronizar ([Tarea.SINCRONIZAR]: non-stop, [destino] required). Creating the task asks for explicit consent
 * to store the credentials encrypted on the server. Without the subscription the switch is shown disabled.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BloqueTareaServidor(tipo: String, cuenta: Cuenta, destino: Cuenta?, dureza: Int) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val cfg = Defaults.instance.servicio
    val sesion by app.servicio.email.collectAsState()
    val plan by app.plan.estado.collectAsState()
    val lista by app.tareasServidor.lista.collectAsState()
    val disponible = sesion.isNotEmpty() && plan.suscrito
    val tarea = lista.firstOrNull { it.es(tipo, cuenta.email, destino?.email) }
    // What the server will really use: never below durezaMin.
    val durezaTarea = com.nonosky.nonimailtools.core.servicio.TareasApi.durezaEfectiva(dureza, cfg.durezaMin)
    var trabajando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var consentir by remember { mutableStateOf(false) }
    var cadaDias by rememberSaveable(tarea?.id) { mutableIntStateOf(tarea?.cadaDias ?: cfg.cadaDiasDefault) }

    fun correr(accion: () -> ResultadoTareas<*>) {
        trabajando = true; error = null
        scope.launch {
            val r = withContext(Dispatchers.IO) { runCatching(accion).getOrElse { ResultadoTareas.SinRed } }
            error = mensajeError(ctx, r)
            trabajando = false
        }
    }

    LaunchedEffect(sesion, disponible) { if (disponible) withContext(Dispatchers.IO) { runCatching { app.tareasServidor.cargar() } } }
    // The hardness of the screen is the one of the task: a change while it is on goes to the server.
    LaunchedEffect(tarea?.id, durezaTarea) {
        val t = tarea ?: return@LaunchedEffect
        if (t.tipo == Tarea.LIMPIAR && t.dureza != null && t.dureza != durezaTarea && !trabajando) correr { app.tareasServidor.cambiar(t.id, dureza = durezaTarea) }
    }

    Tarjeta {
        FilaInterruptor(
            stringResource(R.string.tarea_mantener), tarea != null,
            { on -> if (on) consentir = true else tarea?.let { t -> correr { app.tareasServidor.borrar(t.id) } } },
            detalle = when {
                !disponible -> stringResource(R.string.incluido_suscripcion)
                tipo == Tarea.LIMPIAR -> stringResource(R.string.tarea_limpiar_detalle, cadaDias, durezaTarea)
                else -> stringResource(R.string.tarea_sync_detalle, tarea?.cadaMinutos ?: SYNC_MINUTOS)
            },
            activo = disponible && !trabajando && (tipo == Tarea.LIMPIAR || destino != null),
        )
        if (disponible && tipo == Tarea.LIMPIAR) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (n in cfg.cadaDias) {
                    Pastilla(pluralStringResource(R.plurals.tarea_cada_dias, n, n), n == cadaDias, {
                        if (!trabajando && n != cadaDias) {
                            cadaDias = n
                            tarea?.let { t -> correr { app.tareasServidor.cambiar(t.id, cadaDias = n) } }
                        }
                    }, activa = !trabajando)
                }
            }
        }
        if (tarea != null) {
            Fila {
                Sello(
                    when {
                        tarea.estado == Tarea.ACTIVA -> stringResource(R.string.tarea_activa)
                        tarea.estado == Tarea.PAUSADA && tarea.motivo == "suscripcion" -> stringResource(R.string.tarea_pausada_suscripcion)
                        tarea.estado == Tarea.PAUSADA -> stringResource(R.string.tarea_pausada)
                        else -> stringResource(R.string.tarea_error)
                    },
                    when (tarea.estado) { Tarea.ACTIVA -> Tono.OK; Tarea.PAUSADA -> Tono.AVISO; else -> Tono.ERROR },
                )
            }
            val ultima = fechaLocal(tarea.ultimaCorrida)
            Pista(
                if (ultima == null) stringResource(R.string.tarea_sin_corrida)
                else stringResource(R.string.tarea_ultima, ultima, tarea.ultimoResumen.orEmpty().ifBlank { "—" }),
                error = tarea.ultimoOk == false,
            )
            fechaLocal(tarea.proximaCorrida)?.let { Pista(stringResource(R.string.tarea_proxima, it)) }
        }
        error?.let { Pista(it, error = true) }
    }

    if (consentir) {
        DialogoConsentimiento(cuenta, destino, onCancelar = { consentir = false }) { clave, claveDestino ->
            consentir = false
            val c = app.tareasServidor.credencial(cuenta, clave)
            val dd = destino?.let { app.tareasServidor.credencial(it, claveDestino) }
            if (c == null || (tipo == Tarea.SINCRONIZAR && dd == null)) { error = ctx.getString(R.string.tarea_err_credenciales); return@DialogoConsentimiento }
            correr {
                if (tipo == Tarea.LIMPIAR) app.tareasServidor.crearLimpiar(c, cadaDias, durezaTarea)
                else app.tareasServidor.crearSincronizar(c, dd!!)
            }
        }
    }
}

/** The service runs the sync every 15 minutes; shown until the task brings its own value. */
private const val SYNC_MINUTOS = 15

/** Explicit consent to store the credentials; a Google sign-in account also gives an app password here. */
@Composable
private fun DialogoConsentimiento(cuenta: Cuenta, destino: Cuenta?, onCancelar: () -> Unit, onAceptar: (String?, String?) -> Unit) {
    val d = dulce
    var clave by remember { mutableStateOf("") }
    var claveDestino by remember { mutableStateOf("") }
    val pideOrigen = cuenta.esOauth
    val pideDestino = destino?.esOauth == true
    val listo = (!pideOrigen || clave.isNotBlank()) && (!pideDestino || claveDestino.isNotBlank())
    AlertDialog(
        onDismissRequest = onCancelar, containerColor = d.panel, shape = FormaTarjeta,
        title = { Text(stringResource(R.string.tarea_consentimiento_titulo)) },
        text = {
            androidx.compose.foundation.layout.Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.tarea_consentimiento_1, listOfNotNull(cuenta.email, destino?.email).joinToString(", ")), color = d.text)
                Text(stringResource(R.string.tarea_consentimiento_2), color = d.text)
                Text(stringResource(R.string.tarea_consentimiento_3), color = d.text)
                if (pideOrigen || pideDestino) {
                    Pista(stringResource(R.string.tarea_google_1))
                    Pista(stringResource(R.string.tarea_google_2))
                }
                if (pideOrigen) Campo(clave, { clave = it }, "${stringResource(R.string.clave_app)} · ${cuenta.email}", secreto = true)
                if (pideDestino && destino != null) Campo(claveDestino, { claveDestino = it }, "${stringResource(R.string.clave_app)} · ${destino.email}", secreto = true)
            }
        },
        confirmButton = { BotonPrimario(stringResource(R.string.tarea_aceptar), { onAceptar(clave.takeIf { pideOrigen }, claveDestino.takeIf { pideDestino }) }, activo = listo) },
        dismissButton = { BotonTexto(stringResource(R.string.cancelar), onCancelar) },
    )
}
