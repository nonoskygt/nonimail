package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.servicio.Tramo
import com.nonosky.nonimailtools.ui.theme.dulce
import java.text.DateFormat
import java.time.OffsetDateTime
import java.util.Date

/**
 * Ajustes → «Planes»: what is free and what the subscription adds, with the price table (from `GET /api/plan`
 * when there is network, else from `defaults.json`). Every account sees it, personal ones too, but nothing
 * else in the app nags about it.
 */
@Composable
fun BloquePlanes() {
    val app = NmtApp.instance
    val ctx = LocalContext.current
    val d = dulce
    val estado by app.plan.estado.collectAsState()
    val precios = estado.precios
    val s = estado.plan?.suscripcion?.takeIf { it.vigente }

    @Composable
    fun rango(t: Tramo) = if (t.hasta == null) stringResource(R.string.planes_o_mas, t.desde) else stringResource(R.string.planes_rango, t.desde, t.hasta)

    Tarjeta {
        Titulo(stringResource(R.string.planes_titulo))
        if (s == null) Etiqueta(stringResource(R.string.planes_su_plan_gratis))
        else {
            val hasta = s.pagadoHasta?.let { runCatching { DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date.from(OffsetDateTime.parse(it).toInstant())) }.getOrDefault(it) } ?: "—"
            val periodo = stringResource(if (s.periodo == "anual") R.string.planes_periodo_anual else R.string.planes_periodo_mensual)
            Etiqueta(stringResource(R.string.planes_su_plan, periodo, s.cantidad, hasta))
        }

        Text(stringResource(R.string.planes_gratis_1), style = MaterialTheme.typography.bodyMedium, color = d.text)
        Pista(stringResource(R.string.planes_gratis_2))
        Text(stringResource(R.string.planes_suscripcion), style = MaterialTheme.typography.bodyMedium, color = d.text, fontWeight = FontWeight.SemiBold)
        Column {
            for (v in listOf(
                stringResource(R.string.planes_s_empresa),
                stringResource(R.string.planes_s_ia),
                stringResource(R.string.planes_s_tareas_1) + " " + stringResource(R.string.planes_s_tareas_2),
                stringResource(R.string.planes_s_web),
                stringResource(R.string.planes_s_nube),
            )) Text("•  $v", style = MaterialTheme.typography.bodyMedium, color = d.text)
        }

        // Price table: accounts · monthly · yearly, per account.
        Column {
            Row(Modifier.fillMaxWidth()) {
                for (h in listOf(R.string.planes_col_cuentas, R.string.planes_col_mensual, R.string.planes_col_anual)) {
                    Text(stringResource(h), Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = d.muted)
                }
            }
            HorizontalDivider(color = d.border)
            for ((m, a) in precios.filas) {
                Row(Modifier.fillMaxWidth()) {
                    Text(rango(m), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = d.text)
                    Text(precios.monto(m.precio), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = d.text)
                    Text(a?.let { precios.monto(it.precio) } ?: "—", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = d.text)
                }
            }
        }
        val filas = precios.filas
        filas.firstOrNull()?.let { (m, a) ->
            Pista(stringResource(R.string.planes_precio, precios.monto(m.precio), a?.let { precios.monto(it.precio) } ?: "—"))
        }
        for ((m, a) in filas.drop(1)) {
            Pista(stringResource(R.string.planes_precio_desde, m.desde, precios.monto(m.precio), a?.let { precios.monto(it.precio) } ?: "—"))
        }
        Pista(stringResource(R.string.planes_credenciales_1))
        Pista(stringResource(R.string.planes_credenciales_2))
        BotonPrimario(
            stringResource(if (s == null) R.string.suscribirse else R.string.planes_administrar),
            { abrirUrl(ctx, BuildConfig.SUBSCRIBE_URL) }, Modifier.fillMaxWidth(), icono = Icons.AutoMirrored.Filled.ArrowForward,
        )
    }
}
