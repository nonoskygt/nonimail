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

/** Notifications and battery: shown in Ajustes, each with its button until granted. */
@Composable
fun BloquePermisos() {
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
