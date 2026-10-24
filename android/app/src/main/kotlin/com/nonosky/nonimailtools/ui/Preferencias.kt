package com.nonosky.nonimailtools.ui

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.limpiar.Ollama
import com.nonosky.nonimailtools.ui.theme.Acento
import com.nonosky.nonimailtools.ui.theme.Modo
import com.nonosky.nonimailtools.ui.theme.dulce
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Pieces shared by Ajustes and the configurator. Each one renders content only (callers add the card). */

@Composable
fun BloqueIdioma() {
    val app = NmtApp.instance
    val activity = LocalContext.current.findActivity()
    val v by app.ajustes.valores.collectAsState()
    fun poner(tag: String) {
        if (v.idioma == tag) return
        app.ajustes.idioma(tag)
        activity?.recreate()
    }
    Titulo(stringResource(R.string.idioma))
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Pastilla(stringResource(R.string.idioma_sistema), v.idioma.isEmpty(), { poner("") })
        Pastilla("Español", v.idioma == "es", { poner("es") })
        Pastilla("English", v.idioma == "en", { poner("en") })
    }
}

@Composable
fun BloqueApariencia() {
    val app = NmtApp.instance
    val v by app.ajustes.valores.collectAsState()
    val d = dulce
    Titulo(stringResource(R.string.apariencia))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Pastilla(stringResource(R.string.modo_auto), v.modo == Modo.AUTO, { app.ajustes.modo(Modo.AUTO) })
        Pastilla(stringResource(R.string.modo_claro), v.modo == Modo.CLARO, { app.ajustes.modo(Modo.CLARO) })
        Pastilla(stringResource(R.string.modo_oscuro), v.modo == Modo.OSCURO, { app.ajustes.modo(Modo.OSCURO) })
    }
    Etiqueta(stringResource(R.string.color))
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        for (a in Acento.Todos) {
            val elegido = v.acento.id == a.id
            val nombre = stringResource(nombreAcento(a.id))
            val relleno = Color(if (d.oscuro) a.oscuroRelleno else a.claro)
            Box(
                Modifier.size(44.dp).clip(CircleShape).background(relleno)
                    .border(if (elegido) 3.dp else 1.dp, if (elegido) d.text else d.border, CircleShape)
                    .clickable(role = Role.RadioButton) { app.ajustes.acento(a) }
                    .descripcion(nombre),
                contentAlignment = Alignment.Center,
            ) { if (elegido) Icon(Icons.Filled.Check, null, tint = Color.White) }
        }
    }
    Pista(stringResource(nombreAcento(v.acento.id)))
}

fun nombreAcento(id: String): Int = when (id) {
    "carmesi" -> R.string.acento_carmesi
    "verde-azulado" -> R.string.acento_verde_azulado
    "violeta" -> R.string.acento_violeta
    "azul" -> R.string.acento_azul
    "ambar" -> R.string.acento_ambar
    else -> R.string.acento_verde
}

/** Ollama URL + model with a live connection test («Servidor en mi red»). */
@Composable
fun PanelServidorRed() {
    val app = NmtApp.instance
    val v by app.ajustes.valores.collectAsState()
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(v.ollamaUrl) }
    var modelo by remember { mutableStateOf(v.ollamaModelo) }
    var estado by remember { mutableStateOf<String?>(null) }
    var ok by remember { mutableStateOf(false) }
    var modelos by remember { mutableStateOf<List<String>>(emptyList()) }
    var probando by remember { mutableStateOf(false) }
    val textoOk = stringResource(R.string.ia_conectado)
    val textoFalla = stringResource(R.string.ia_no_responde)

    Campo(url, { url = it; app.ajustes.ollamaUrl(it); estado = null }, stringResource(R.string.ia_url), placeholder = "192.168.0.50:${BuildConfig.OLLAMA_PORT}", teclado = KeyboardType.Uri)
    Campo(modelo, { modelo = it; app.ajustes.ollamaModelo(it) }, stringResource(R.string.ia_modelo), placeholder = BuildConfig.OLLAMA_MODEL)
    BotonSecundario(
        stringResource(R.string.probar_conexion),
        {
            probando = true
            scope.launch {
                val r = withContext(Dispatchers.IO) {
                    runCatching {
                        val d = Defaults.instance
                        Ollama(Ollama.normalizeUrl(url, BuildConfig.OLLAMA_PORT), modelo, BuildConfig.OLLAMA_TIMEOUT_MS, d.llm.numCtx, d.llm.numPredict).probe()
                    }
                }
                probando = false
                r.onSuccess { ok = true; modelos = it.models; estado = "$textoOk · Ollama ${it.version}" }
                    .onFailure { ok = false; modelos = emptyList(); estado = textoFalla; app.telemetry.log.w("ia", "Ollama probe failed: ${it.message}") }
            }
        },
        Modifier.fillMaxWidth(), activo = url.isNotBlank() && !probando, icono = Icons.Filled.Refresh,
    )
    estado?.let { Pista(it, error = !ok) }
    if (modelos.isNotEmpty()) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (m in modelos) Pastilla(m, m == modelo, { modelo = m; app.ajustes.ollamaModelo(m) })
        }
    }
}

@Composable
fun BloqueTelemetria() {
    val app = NmtApp.instance
    val v by app.ajustes.valores.collectAsState()
    FilaInterruptor(
        stringResource(R.string.telemetria_interruptor), v.telemetria,
        { on -> app.ajustes.telemetria(on); if (!on) app.telemetry.vaciar() },
        detalle = stringResource(R.string.telemetria_linea),
    )
    FilaInterruptor(
        stringResource(R.string.filtro_interruptor), v.filtroCompartir,
        { on -> app.ajustes.filtroCompartir(on); if (!on) app.telemetry.vaciarDecisiones() },
        detalle = stringResource(R.string.filtro_linea),
    )
}

fun android.content.Context.findActivity(): Activity? {
    var c = this
    while (c is android.content.ContextWrapper) { if (c is Activity) return c; c = c.baseContext }
    return null
}
