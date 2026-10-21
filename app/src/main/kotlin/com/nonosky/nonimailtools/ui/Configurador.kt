package com.nonosky.nonimailtools.ui

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.ui.theme.dulce
import com.nonosky.nonimailtools.ui.theme.fondoDulce

private const val PASOS = 5

/**
 * First-run configurator: language + appearance, permissions, optional AI, telemetry, first
 * account. It is shown again from Ajustes. [onTerminar] marks it done.
 */
@Composable
fun Configurador(onTerminar: () -> Unit, onSalir: (() -> Unit)? = null) {
    val app = NmtApp.instance
    val d = dulce
    val cuentas by app.cuentas.cuentas.collectAsState()
    var paso by rememberSaveable { mutableIntStateOf(0) }

    Box(Modifier.fillMaxSize().fondoDulce(d).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            Column(Modifier.padding(top = 16.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Etiqueta(stringResource(R.string.paso_de, paso + 1, PASOS))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0 until PASOS) {
                        Box(
                            Modifier.weight(1f).height(4.dp)
                                .background(if (i <= paso) d.accentFill else d.border, CircleShape),
                        )
                    }
                }
                Text(
                    stringResource(
                        when (paso) { 0 -> R.string.cfg_idioma_apariencia; 1 -> R.string.cfg_permisos; 2 -> R.string.cfg_ia; 3 -> R.string.cfg_telemetria; else -> R.string.cfg_cuenta },
                    ),
                    style = MaterialTheme.typography.headlineMedium, color = d.text,
                )
            }

            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                when (paso) {
                    0 -> {
                        Tarjeta { BloqueIdioma() }
                        Tarjeta { BloqueApariencia() }
                    }
                    1 -> PasoPermisos()
                    2 -> Tarjeta { BloqueIA() }
                    3 -> Tarjeta { BloqueTelemetria() }
                    else -> Tarjeta {
                        FormularioCuenta(null, onGuardada = { onTerminar() })
                    }
                }
            }

            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (paso > 0) BotonSecundario(stringResource(R.string.atras), { paso-- }, Modifier.weight(1f))
                else if (onSalir != null) BotonSecundario(stringResource(R.string.cancelar), onSalir, Modifier.weight(1f))
                when {
                    paso == 2 -> {
                        val hayUrl = app.ajustes.valores.collectAsState().value.ollamaUrl.isNotBlank()
                        BotonPrimario(stringResource(if (hayUrl) R.string.siguiente else R.string.omitir), { paso++ }, Modifier.weight(1f))
                    }
                    paso < PASOS - 1 -> BotonPrimario(stringResource(R.string.siguiente), { paso++ }, Modifier.weight(1f))
                    cuentas.isNotEmpty() -> BotonPrimario(stringResource(R.string.finalizar), onTerminar, Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun PasoPermisos() {
    val ctx = LocalContext.current
    val d = dulce
    var refresco by remember { mutableIntStateOf(0) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val o = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) refresco++ }
        owner.lifecycle.addObserver(o)
        onDispose { owner.lifecycle.removeObserver(o) }
    }
    val notifOk = refresco >= 0 && NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    val pm = ctx.getSystemService(PowerManager::class.java)
    val bateriaOk = refresco >= 0 && pm.isIgnoringBatteryOptimizations(ctx.packageName)
    val pedirNotif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { refresco++ }

    if (Build.VERSION.SDK_INT >= 33) {
        Tarjeta {
            Fila {
                Icon(Icons.Filled.Notifications, null, tint = d.accent)
                Column(Modifier.weight(1f)) {
                    Titulo(stringResource(R.string.perm_notificaciones))
                    Pista(stringResource(R.string.perm_notificaciones_pista))
                }
                if (notifOk) Sello(stringResource(R.string.concedido), Tono.OK, icono = Icons.Filled.Check)
            }
            if (!notifOk) BotonPrimario(stringResource(R.string.permitir), { pedirNotif.launch(Manifest.permission.POST_NOTIFICATIONS) }, Modifier.fillMaxWidth())
        }
    }
    Tarjeta {
        Fila {
            Icon(Iconos.Bateria, null, tint = d.accent)
            Column(Modifier.weight(1f)) {
                Titulo(stringResource(R.string.perm_bateria))
                Pista(stringResource(R.string.perm_bateria_pista))
            }
            if (bateriaOk) Sello(stringResource(R.string.concedido), Tono.OK, icono = Icons.Filled.Check)
        }
        if (!bateriaOk) {
            BotonPrimario(
                stringResource(R.string.permitir),
                {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
                    runCatching { ctx.startActivity(intent) }.onFailure {
                        runCatching { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
                    }
                },
                Modifier.fillMaxWidth(),
            )
        }
    }
}
