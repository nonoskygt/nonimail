package com.nonosky.nonimailtools.ui

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.mail.GoogleOauth
import com.nonosky.nonimailtools.data.Acceso
import com.nonosky.nonimailtools.data.EstadoReglas
import com.nonosky.nonimailtools.data.GoogleAuth
import com.nonosky.nonimailtools.ui.theme.dulce
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Same check as the desktop app: something@something.xx, before anything is sent. */
private val CORREO_VALIDO = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")

/**
 * Ajustes → «Preferencias y sincronización». Without a session it explains that the preferences live
 * on the phone and offers to create the account right here (e-mail + password, a code for a new
 * e-mail, or Google). With a session it shows who the preferences sync with, and how the last sync went.
 */
@Composable
fun BloqueSincronizacion() {
    val app = NmtApp.instance
    val sesion by app.servicio.email.collectAsState()
    val estado by app.reglas.estado.collectAsState()
    Tarjeta {
        Titulo(stringResource(R.string.sync_titulo))
        if (sesion.isNotEmpty()) {
            Etiqueta(stringResource(R.string.sync_con, sesion))
            when {
                estado.motivo == EstadoReglas.Motivo.SESION_VENCIDA -> Pista(stringResource(R.string.sync_vencida), error = true)
                estado.motivo == EstadoReglas.Motivo.ERROR -> Pista(stringResource(R.string.sync_err), error = true)
                // Without the endpoint in the service the rules just stay on the phone: no error shown.
                else -> if (estado.ok == true) Pista(stringResource(R.string.sync_ok))
            }
            BotonSecundario(stringResource(R.string.cerrar_sesion), { app.servicio.cerrar() })
        } else {
            Pista(stringResource(R.string.sync_intro_1))
            Pista(stringResource(R.string.sync_intro_2))
            Pista(stringResource(R.string.sync_intro_3))
            FormularioSesion(onAbierta = {}, onCancelar = null, textoEntrar = stringResource(R.string.sync_continuar), conGoogle = true)
        }
    }
}

/**
 * E-mail + password sign-in on the web account (a new e-mail also asks for the 6-digit code), and
 * optionally «Continuar con Google». All the calls are [com.nonosky.nonimailtools.data.Servicio]'s.
 */
@Composable
fun FormularioSesion(onAbierta: (Int) -> Unit, onCancelar: (() -> Unit)?, textoEntrar: String, conGoogle: Boolean) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var clave by rememberSaveable { mutableStateOf("") }
    var codigo by rememberSaveable { mutableStateOf("") }
    var pideCodigo by rememberSaveable { mutableStateOf(false) }
    var trabajando by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Acceso.Motivo?>(null) }
    var errorGoogle by remember { mutableStateOf(false) }
    val correoValido = CORREO_VALIDO.matches(email.trim())

    fun resultado(r: Acceso) {
        trabajando = false
        when (r) {
            is Acceso.Abierta -> onAbierta(r.importadas)
            Acceso.PideCodigo -> pideCodigo = true
            is Acceso.Fallo -> error = r.motivo
        }
    }

    /** The Google grant is in hand: the service verifies the id_token and opens (or creates) the account. */
    fun terminarGoogle(idToken: String?) {
        if (idToken.isNullOrBlank()) { trabajando = false; errorGoogle = true; return }
        scope.launch { resultado(withContext(Dispatchers.IO) { app.servicio.accederConGoogle(idToken, GoogleOauth.correoDeIdToken(idToken)) }) }
    }

    val lanzadorGoogle = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode != Activity.RESULT_OK) { trabajando = false; errorGoogle = true; return@rememberLauncherForActivityResult }
        try { terminarGoogle(GoogleAuth.idToken(GoogleAuth.resultadoDeIntent(ctx, res.data))) } catch (e: Exception) {
            trabajando = false; errorGoogle = true
            app.telemetry.error("cuenta", "Google account sign-in failed: ${e.message ?: e.javaClass.simpleName}", e)
        }
    }

    fun entrarConGoogle() {
        trabajando = true; errorGoogle = false; error = null
        scope.launch {
            try {
                val r = GoogleAuth.autorizarIdentidad(ctx)
                val pi = r.pendingIntent
                if (r.hasResolution() && pi != null) lanzadorGoogle.launch(IntentSenderRequest.Builder(pi).build()) else terminarGoogle(GoogleAuth.idToken(r))
            } catch (e: Exception) {
                trabajando = false; errorGoogle = true
                app.telemetry.error("cuenta", "Google account sign-in failed: ${e.message ?: e.javaClass.simpleName}", e)
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Campo(
            email, { email = it.trim(); error = null }, stringResource(R.string.correo), teclado = KeyboardType.Email,
            error = if (email.isNotEmpty() && !correoValido) stringResource(R.string.correo_invalido) else null,
        )
        Campo(clave, { clave = it; error = null }, stringResource(R.string.contrasena), secreto = true)
        if (pideCodigo) Campo(codigo, { codigo = it.filter(Char::isDigit).take(6); error = null }, stringResource(R.string.codigo_correo), teclado = KeyboardType.Number)
        error?.let {
            Pista(
                stringResource(
                    when (it) {
                        Acceso.Motivo.CREDENCIALES -> R.string.sesion_err_credenciales
                        Acceso.Motivo.CODIGO -> R.string.sesion_err_codigo
                        Acceso.Motivo.DEMASIADOS -> R.string.sesion_err_demasiados
                        Acceso.Motivo.RED -> R.string.sesion_err_red
                        Acceso.Motivo.SERVICIO -> R.string.sesion_err_servicio
                        Acceso.Motivo.GOOGLE_NO_DISPONIBLE -> R.string.sesion_err_google
                    },
                ),
                error = true,
            )
        }
        if (errorGoogle) Pista(stringResource(R.string.err_google), error = true)
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BotonPrimario(
                textoEntrar,
                {
                    trabajando = true
                    scope.launch {
                        resultado(
                            withContext(Dispatchers.IO) {
                                if (pideCodigo) app.servicio.confirmar(email, codigo, clave) else app.servicio.acceder(email, clave)
                            },
                        )
                    }
                },
                Modifier.fillMaxWidth(),
                activo = !trabajando && correoValido && clave.isNotEmpty() && (!pideCodigo || codigo.length == 6),
            )
            if (conGoogle) {
                Text(stringResource(R.string.sync_o), color = dulce.muted, modifier = Modifier.align(Alignment.CenterHorizontally))
                BotonSecundario(stringResource(R.string.sync_google), { entrarConGoogle() }, Modifier.fillMaxWidth(), activo = !trabajando)
            }
            if (onCancelar != null) BotonTexto(stringResource(R.string.cancelar), onCancelar, Modifier.fillMaxWidth().padding(top = 0.dp))
        }
    }
}
