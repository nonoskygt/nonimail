package com.nonosky.nonimailtools.ui

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.licencias.Dominios
import com.nonosky.nonimailtools.core.mail.ImapAccount
import com.nonosky.nonimailtools.core.mail.ImapConnection
import com.nonosky.nonimailtools.core.mail.ImapException
import com.nonosky.nonimailtools.core.mail.ImapTimeouts
import com.nonosky.nonimailtools.core.mail.Security
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.data.AUTH_CLAVE
import com.nonosky.nonimailtools.data.AUTH_OAUTH
import com.nonosky.nonimailtools.data.Cuenta
import com.nonosky.nonimailtools.data.GoogleAuth
import com.nonosky.nonimailtools.data.GoogleReautenticar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Result of a connection test, kept as data so it can be shown translated. */
sealed interface PruebaCuenta {
    data object Nada : PruebaCuenta
    data object Probando : PruebaCuenta
    data object Ok : PruebaCuenta
    data object GoogleFallo : PruebaCuenta
    data object GoogleReauth : PruebaCuenta
    data class Fallo(val razon: ImapException.Reason?, val detalle: String) : PruebaCuenta
}

suspend fun probarCuenta(a: ImapAccount): PruebaCuenta = withContext(Dispatchers.IO) {
    try {
        ImapConnection.test(a, ImapTimeouts(BuildConfig.IMAP_CONNECT_TIMEOUT_MS, BuildConfig.IMAP_TIMEOUT_MS))
        PruebaCuenta.Ok
    } catch (e: ImapException) {
        PruebaCuenta.Fallo(e.reason, e.message.orEmpty())
    } catch (e: Exception) {
        PruebaCuenta.Fallo(null, e.message.orEmpty())
    }
}

@Composable
fun textoPrueba(p: PruebaCuenta): String? = when (p) {
    PruebaCuenta.Nada, PruebaCuenta.Probando -> null
    PruebaCuenta.Ok -> stringResource(R.string.conexion_ok)
    PruebaCuenta.GoogleFallo -> stringResource(R.string.err_google)
    PruebaCuenta.GoogleReauth -> stringResource(R.string.err_google_reauth)
    is PruebaCuenta.Fallo -> stringResource(
        when (p.razon) {
            ImapException.Reason.AUTH -> R.string.err_autenticacion
            ImapException.Reason.CONNECT -> R.string.err_conexion
            else -> R.string.err_generico
        },
    )
}

private fun nombreProveedorTelemetria(id: String) = when (id) {
    "gmail", "outlook", "yahoo", "icloud" -> id
    "imap" -> "imap"
    else -> "otro"
}

@Composable
fun nombrePreset(id: String): String = stringResource(
    when (id) {
        "gmail" -> R.string.preset_gmail
        "outlook" -> R.string.preset_outlook
        "yahoo" -> R.string.preset_yahoo
        "icloud" -> R.string.preset_icloud
        else -> R.string.preset_otro
    },
)

/**
 * Account form with provider presets and a connection test. [onGuardada] runs after the
 * test passed and the account (password encrypted) was stored.
 */
@Composable
fun FormularioCuenta(
    inicial: Cuenta?, onGuardada: (Cuenta) -> Unit, modifier: Modifier = Modifier, textoGuardar: String = stringResource(R.string.probar_y_guardar),
    onCancelar: (() -> Unit)? = null,
) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val presets = Defaults.instance.providers

    var preset by rememberSaveable { mutableStateOf(inicial?.proveedor ?: "gmail") }
    var email by rememberSaveable { mutableStateOf(inicial?.email ?: "") }
    var clave by rememberSaveable { mutableStateOf("") }
    var host by rememberSaveable { mutableStateOf(inicial?.host ?: "") }
    var puerto by rememberSaveable { mutableStateOf((inicial?.port ?: 993).toString()) }
    var seguridad by rememberSaveable { mutableStateOf(inicial?.security ?: Security.SSL.id) }
    var usuario by rememberSaveable { mutableStateOf(inicial?.user ?: "") }
    var prueba by remember { mutableStateOf<PruebaCuenta>(PruebaCuenta.Nada) }

    var verClave by rememberSaveable { mutableStateOf(false) }

    val p = presets.firstOrNull { it.id == preset } ?: presets.last()
    val manual = p.host.isEmpty()
    val correoValido = Dominios.esCorreo(email)
    val inicialOauth = inicial?.esOauth == true
    // Google first; the app-password form stays folded below as a fallback.
    val ofreceGoogle = p.googleSignIn
    val mostrarClave = !ofreceGoogle || verClave || (inicial != null && !inicialOauth)

    fun elegir(id: String) {
        preset = id
        val pr = presets.first { it.id == id }
        if (pr.host.isNotEmpty()) { host = pr.host; puerto = pr.port.toString(); seguridad = pr.security }
        prueba = PruebaCuenta.Nada
    }

    /** Test the login and store the account; shared by the password form and Google sign-in. */
    suspend fun guardarCuenta(cuentaImap: ImapAccount, pw: String?, auth: String) {
        val r = probarCuenta(cuentaImap)
        prueba = r
        if (r is PruebaCuenta.Ok) {
            val c = app.cuentas.guardar(inicial?.id, cuentaImap.email, preset, cuentaImap.host, cuentaImap.port, cuentaImap.security.id, usuario, pw, auth)
            app.telemetry.registrar(Telemetria.cuenta(c.email, nombreProveedorTelemetria(preset), Dominios.esPersonal(c.email)))
            app.telemetry.log.i("cuenta", "Account saved: ${c.email} (${preset}, $auth)")
            onGuardada(c)
        } else if (r is PruebaCuenta.Fallo) {
            app.telemetry.error("cuenta", "Connection test failed (${r.razon}): ${r.detalle}", null, cuentaImap.email)
        }
    }

    /** Token in hand: read the address from Gmail and store the account as OAuth. */
    suspend fun terminarGoogle(r: com.google.android.gms.auth.api.identity.AuthorizationResult) {
        val token = GoogleAuth.recordar(r)
        val correo = token?.let { t ->
            withContext(Dispatchers.IO) { GoogleAuth.correoDelPerfil(t) ?: runCatching { r.toGoogleSignInAccount()?.email?.lowercase() }.getOrNull() }
        }
        if (token == null || correo == null || !Dominios.esCorreo(correo)) {
            prueba = PruebaCuenta.GoogleFallo
            app.telemetry.error("cuenta", "Google sign-in returned no usable token or address", null)
            return
        }
        email = correo
        val cuentaImap = ImapAccount(correo, p.host, p.port, Security.of(p.security), correo, token, oauth = true)
        guardarCuenta(cuentaImap, null, AUTH_OAUTH)
    }

    val lanzadorGoogle = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        if (res.resultCode != Activity.RESULT_OK) { prueba = PruebaCuenta.GoogleFallo; return@rememberLauncherForActivityResult }
        scope.launch {
            try {
                terminarGoogle(GoogleAuth.resultadoDeIntent(ctx, res.data))
            } catch (e: Exception) {
                prueba = PruebaCuenta.GoogleFallo
                app.telemetry.error("cuenta", "Google sign-in failed: ${e.message ?: e.javaClass.simpleName}", e)
            }
        }
    }

    fun entrarConGoogle() {
        prueba = PruebaCuenta.Probando
        scope.launch {
            try {
                val r = GoogleAuth.autorizar(ctx)
                val pi = r.pendingIntent
                if (r.hasResolution() && pi != null) lanzadorGoogle.launch(IntentSenderRequest.Builder(pi).build())
                else terminarGoogle(r)
            } catch (e: Exception) {
                prueba = PruebaCuenta.GoogleFallo
                app.telemetry.error("cuenta", "Google sign-in failed: ${e.message ?: e.javaClass.simpleName}", e)
            }
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.horizontalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (pr in presets) Pastilla(nombrePreset(pr.id), preset == pr.id, { elegir(pr.id) })
            }
        }
        if (ofreceGoogle) {
            BotonPrimario(stringResource(R.string.iniciar_google), { entrarConGoogle() }, Modifier.fillMaxWidth(), activo = prueba !is PruebaCuenta.Probando)
            if (!mostrarClave) BotonTexto(stringResource(R.string.usar_clave_app), { verClave = true }, Modifier.fillMaxWidth())
        }
        if (mostrarClave && p.appPassword) {
            Pista(stringResource(if (p.id == "gmail") R.string.pista_gmail else R.string.pista_clave_app))
            val ayuda = stringResource(
                when (p.id) { "gmail" -> R.string.url_ayuda_gmail; "outlook" -> R.string.url_ayuda_outlook; "yahoo" -> R.string.url_ayuda_yahoo; else -> R.string.url_ayuda_icloud },
            )
            BotonTexto(stringResource(R.string.crear_clave_app), { abrirUrl(ctx, ayuda) })
        }
        if (mostrarClave || inicial != null) Campo(
            email, {
                email = it.trim(); prueba = PruebaCuenta.Nada
                if (inicial == null) presets.firstOrNull { pr -> Defaults.instance.providerForEmail(email)?.id == pr.id }?.let { pr -> if (pr.id != preset) elegir(pr.id) }
            },
            stringResource(R.string.correo), teclado = KeyboardType.Email,
            error = if (email.isNotEmpty() && !correoValido) stringResource(R.string.correo_invalido) else null,
        )
        if (mostrarClave) Campo(
            clave, { clave = it; prueba = PruebaCuenta.Nada },
            stringResource(if (p.appPassword) R.string.clave_app else R.string.clave), secreto = true,
            placeholder = if (inicial != null) stringResource(R.string.clave_sin_cambios) else null,
        )
        if (manual && mostrarClave) {
            Campo(host, { host = it.trim() }, stringResource(R.string.servidor_imap), teclado = KeyboardType.Uri)
            Campo(puerto, { puerto = it.filter(Char::isDigit).take(5) }, stringResource(R.string.puerto), teclado = KeyboardType.Number)
            androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Pastilla("SSL/TLS", seguridad == Security.SSL.id, { seguridad = Security.SSL.id })
                Pastilla("STARTTLS", seguridad == Security.STARTTLS.id, { seguridad = Security.STARTTLS.id })
                Pastilla(stringResource(R.string.sin_cifrado), seguridad == Security.NONE.id, { seguridad = Security.NONE.id })
            }
            Campo(usuario, { usuario = it.trim() }, stringResource(R.string.usuario_opcional))
        }

        val listo = correoValido && (clave.isNotEmpty() || inicial != null) && host.isNotBlank() && (puerto.toIntOrNull() ?: 0) in 1..65535
        val ocupado = prueba is PruebaCuenta.Probando
        androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            if (mostrarClave || inicialOauth) BotonPrimario(
                textoGuardar,
                {
                    prueba = PruebaCuenta.Probando
                    scope.launch {
                        val oauthActual = inicialOauth && clave.isEmpty()
                        val pw = clave.ifEmpty {
                            inicial?.let { c -> withContext(Dispatchers.IO) { runCatching { app.cuentas.imap(c)?.password }.getOrNull() } }
                        } ?: ""
                        val cuentaImap = ImapAccount(email.lowercase(), host.trim(), puerto.toInt(), Security.of(seguridad), usuario.ifBlank { email.lowercase() }, pw, oauth = oauthActual)
                        guardarCuenta(cuentaImap, if (oauthActual) null else pw, if (oauthActual) AUTH_OAUTH else AUTH_CLAVE)
                    }
                },
                Modifier.weight(1f), activo = listo && !ocupado, icono = if (prueba is PruebaCuenta.Ok) Icons.Filled.Check else null,
            )
            if (onCancelar != null) BotonSecundario(stringResource(R.string.cancelar), onCancelar, Modifier.weight(0.6f))
        }
        if (ocupado) androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = com.nonosky.nonimailtools.ui.theme.dulce.accentFill)
            Pista(stringResource(R.string.probando))
        }
        textoPrueba(prueba)?.let { Pista(it, error = prueba !is PruebaCuenta.Ok) }
    }
}
