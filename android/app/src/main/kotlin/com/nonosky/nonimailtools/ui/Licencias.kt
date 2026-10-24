package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.unit.dp
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.licencias.Dominios
import com.nonosky.nonimailtools.core.licencias.LicenseError
import com.nonosky.nonimailtools.core.licencias.LicenseGate
import com.nonosky.nonimailtools.core.licencias.LicenseResult
import com.nonosky.nonimailtools.core.licencias.Licencia
import com.nonosky.nonimailtools.core.licencias.Tipo
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.ui.theme.dulce
import java.text.DateFormat
import java.time.Instant
import java.util.Date

import androidx.compose.runtime.rememberCoroutineScope
import com.nonosky.nonimailtools.data.Acceso
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** True when some account is of a private domain: only those deal with licenses. */
fun hayCuentasComerciales(emails: List<String>) = emails.any { !Dominios.esPersonal(it) }

/**
 * Licenses, inside Ajustes and only for private-domain accounts (personal ones are free and see
 * nothing about it). Signing in brings the bought licenses by itself; pasting a key is the fallback.
 */
@Composable
fun BloqueLicencias() {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val v by app.ajustes.valores.collectAsState()
    val cuentas by app.cuentas.cuentas.collectAsState()
    val licencias by app.licencias.licencias.collectAsState()
    val sesion by app.servicio.email.collectAsState()
    var clave by rememberSaveable { mutableStateOf("") }
    var verClave by rememberSaveable { mutableStateOf(false) }
    var entrando by remember { mutableStateOf(false) }
    var mensaje by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    val ahora = System.currentTimeMillis() / 1000
    val fecha = remember { DateFormat.getDateInstance(DateFormat.MEDIUM) }
    val comerciales = cuentas.filter { !Dominios.esPersonal(it.email) }
    if (comerciales.isEmpty()) return

    val errores = mapOf(
        LicenseError.FORMAT to stringResource(R.string.lic_err_formato),
        LicenseError.NO_PUBLIC_KEY to stringResource(R.string.lic_err_sin_clave_publica),
        LicenseError.SIGNATURE to stringResource(R.string.lic_err_firma),
        LicenseError.DAMAGED to stringResource(R.string.lic_err_danada),
        LicenseError.INCOMPLETE to stringResource(R.string.lic_err_incompleta),
        LicenseError.EXPIRED to stringResource(R.string.lic_err_vencida),
    )
    val okTexto = stringResource(R.string.lic_agregada)

    Tarjeta {
        Fila {
            Titulo(stringResource(R.string.lic_titulo), Modifier.weight(1f))
            if (sesion.isEmpty()) BotonPrimario(stringResource(R.string.iniciar_sesion), { entrando = true })
            else BotonTexto(stringResource(R.string.cerrar_sesion), { app.servicio.cerrar() })
        }
        if (sesion.isNotEmpty()) Etiqueta(sesion)
        for (c in comerciales) {
            Text(c.email, style = MaterialTheme.typography.titleSmall, color = d.text)
            for (tipo in Tipo.entries) {
                val g = LicenseGate.check(listOf(c.email), tipo, licencias, ahora)
                Fila {
                    Text(nombreTipo(tipo), style = MaterialTheme.typography.bodyMedium, color = d.text, modifier = Modifier.weight(1f))
                    if (g.permitido) Sello(stringResource(R.string.lic_activa_hasta, fecha.format(Date((g.vence ?: 0) * 1000))), Tono.OK)
                    else BotonTexto(stringResource(R.string.comprar_licencia), { abrirUrl(ctx, LicenseGate.buyUrl(v.serviceUrl, c.email, tipo)) })
                }
            }
        }
        BotonTexto(stringResource(if (verClave) R.string.ocultar else R.string.lic_agregar_clave), { verClave = !verClave })
        if (verClave) {
            Campo(clave, { clave = it; mensaje = null }, stringResource(R.string.lic_clave), unaLinea = false, minLineas = 3, placeholder = "NMT1.…")
            BotonSecundario(
                stringResource(R.string.agregar),
                {
                    when (val r = app.licencias.agregar(clave)) {
                        is LicenseResult.Ok -> {
                            val l = r.licencia
                            mensaje = true to "$okTexto · ${l.cuenta}"
                            app.telemetry.registrar(Telemetria.licencia(l.cuenta, l.tipo, if (l.canal == "web") "web" else "app", Instant.ofEpochSecond(l.exp).toString()))
                            app.telemetry.enviarYa()
                            clave = ""
                        }
                        is LicenseResult.Error -> mensaje = false to (errores[r.error] ?: "")
                    }
                },
                Modifier.fillMaxWidth(), activo = clave.isNotBlank(), icono = Icons.Filled.Add,
            )
            for (l in licencias.sortedByDescending { it.exp }) FilaLicencia(l, ahora, fecha) { app.licencias.borrar(l.lid) }
        }
        mensaje?.let { (ok, t) -> Pista(t, error = !ok) }
    }
    if (entrando) DialogoSesion(onCerrar = { entrando = false }, onAbierta = { n -> entrando = false; mensaje = true to ctx.getString(R.string.sesion_abierta, n) })
}

/** Sign-in to the web account: e-mail and password (a new e-mail also asks for the 6-digit code), or Google. */
@Composable
fun DialogoSesion(onCerrar: () -> Unit, onAbierta: (Int) -> Unit) {
    DialogoGrande(onCerrar) {
        Titulo(stringResource(R.string.iniciar_sesion))
        FormularioSesion(onAbierta, onCerrar, stringResource(R.string.entrar), conGoogle = true)
    }
}

@Composable
private fun FilaLicencia(l: Licencia, ahora: Long, fecha: DateFormat, onBorrar: () -> Unit) {
    val d = dulce
    Tarjeta(hundida = true) {
        Fila {
            Column(Modifier.weight(1f)) {
                Text(l.cuenta, style = MaterialTheme.typography.titleSmall, color = d.text)
                Etiqueta("${nombreTipo(Tipo.of(l.tipo) ?: Tipo.LIMPIAR)} · ${l.canal}")
            }
            if (l.vigente(ahora)) Sello(stringResource(R.string.lic_activa_hasta, fecha.format(Date(l.exp * 1000))), Tono.OK)
            else Sello(stringResource(R.string.lic_vencida), Tono.ERROR)
            IconButton(onBorrar) { Icon(Icons.Filled.Delete, stringResource(R.string.eliminar), tint = d.muted) }
        }
    }
}
