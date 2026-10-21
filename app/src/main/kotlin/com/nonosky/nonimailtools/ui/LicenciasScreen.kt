package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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

@Composable
fun LicenciasScreen(modifier: Modifier = Modifier) {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val v by app.ajustes.valores.collectAsState()
    val cuentas by app.cuentas.cuentas.collectAsState()
    val licencias by app.licencias.licencias.collectAsState()
    var clave by rememberSaveable { mutableStateOf("") }
    var mensaje by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    val ahora = System.currentTimeMillis() / 1000
    val fecha = remember { DateFormat.getDateInstance(DateFormat.MEDIUM) }

    val errores = mapOf(
        LicenseError.FORMAT to stringResource(R.string.lic_err_formato),
        LicenseError.NO_PUBLIC_KEY to stringResource(R.string.lic_err_sin_clave_publica),
        LicenseError.SIGNATURE to stringResource(R.string.lic_err_firma),
        LicenseError.DAMAGED to stringResource(R.string.lic_err_danada),
        LicenseError.INCOMPLETE to stringResource(R.string.lic_err_incompleta),
        LicenseError.EXPIRED to stringResource(R.string.lic_err_vencida),
    )
    val okTexto = stringResource(R.string.lic_agregada)

    LazyColumn(modifier, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Text(stringResource(R.string.tab_licencias), style = MaterialTheme.typography.headlineMedium, color = d.text, modifier = Modifier.padding(top = 8.dp)) }

        items(cuentas, key = { it.id }) { c ->
            val personal = Dominios.esPersonal(c.email)
            Tarjeta {
                Titulo(c.email)
                for (tipo in Tipo.entries) {
                    val g = LicenseGate.check(listOf(c.email), tipo, licencias, ahora)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Fila {
                            Column(Modifier.weight(1f)) {
                                Text(nombreTipo(tipo), style = MaterialTheme.typography.titleSmall, color = d.text)
                                Etiqueta(stringResource(R.string.precio_periodo, precio(tipo), BuildConfig.LICENSE_DAYS))
                            }
                            when {
                                personal -> Sello(stringResource(R.string.lic_gratis), Tono.OK)
                                g.permitido -> Sello(stringResource(R.string.lic_activa_hasta, fecha.format(Date((g.vence ?: 0) * 1000))), Tono.OK)
                                else -> Sello(stringResource(R.string.lic_sin_licencia), Tono.AVISO)
                            }
                        }
                        if (!personal && !g.permitido) {
                            BotonSecundario(
                                stringResource(R.string.comprar), { abrirUrl(ctx, LicenseGate.buyUrl(v.serviceUrl, c.email, tipo)) },
                                Modifier.fillMaxWidth(), icono = Icons.Filled.ShoppingCart,
                            )
                        }
                    }
                }
            }
        }

        item {
            Tarjeta {
                Titulo(stringResource(R.string.lic_agregar_clave))
                Campo(clave, { clave = it; mensaje = null }, stringResource(R.string.lic_clave), unaLinea = false, minLineas = 3, placeholder = "NMT1.…")
                BotonPrimario(
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
                mensaje?.let { (ok, t) -> Pista(t, error = !ok) }
            }
        }

        if (licencias.isNotEmpty()) {
            item { Titulo(stringResource(R.string.lic_guardadas)) }
            items(licencias.sortedByDescending { it.exp }, key = { it.lid }) { l -> FilaLicencia(l, ahora, fecha) { app.licencias.borrar(l.lid) } }
        }
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
