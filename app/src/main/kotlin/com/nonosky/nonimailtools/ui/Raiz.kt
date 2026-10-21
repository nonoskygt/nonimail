package com.nonosky.nonimailtools.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CleaningServices
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.VpnKey
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.core.view.WindowCompat
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.ui.theme.DulceTheme
import com.nonosky.nonimailtools.ui.theme.Modo
import com.nonosky.nonimailtools.ui.theme.dulce
import com.nonosky.nonimailtools.ui.theme.fondoDulce
import kotlinx.coroutines.delay
import java.time.LocalTime

/** Current hour, re-read at the start of every minute (auto mode: light 06:00–17:59). */
@Composable
private fun horaActual(): Int {
    val h by produceState(LocalTime.now().hour) {
        while (true) {
            value = LocalTime.now().hour
            delay(60_000L - System.currentTimeMillis() % 60_000L)
        }
    }
    return h
}

@Composable
fun Raiz() {
    val app = NmtApp.instance
    val v by app.ajustes.valores.collectAsState()
    val hora = horaActual()
    val oscuro = Modo.esOscuro(v.modo, hora)
    var reconfigurando by rememberSaveable { mutableStateOf(false) }

    DulceTheme(v.modo, v.acento, oscuro) {
        val d = dulce
        val view = LocalView.current
        SideEffect {
            val w = view.context.findActivity()?.window ?: return@SideEffect
            val c = WindowCompat.getInsetsController(w, view)
            c.isAppearanceLightStatusBars = !oscuro
            c.isAppearanceLightNavigationBars = !oscuro
        }
        Box(Modifier.fillMaxSize().fondoDulce(d)) {
            if (!v.configurado || reconfigurando) {
                Configurador(
                    onTerminar = {
                        app.ajustes.configurado(true)
                        reconfigurando = false
                        app.telemetry.registrar(Telemetria.inicio())
                        app.telemetry.enviarYa()
                    },
                    onSalir = if (v.configurado) ({ reconfigurando = false }) else null,
                )
            } else {
                Cascaron(repetirConfigurador = { reconfigurando = true })
            }
        }
    }
}

private data class Pestana(val titulo: Int, val icono: ImageVector)

@Composable
private fun Cascaron(repetirConfigurador: () -> Unit) {
    val d = dulce
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val pestanas = listOf(
        Pestana(R.string.tab_limpiar, Icons.Filled.CleaningServices),
        Pestana(R.string.tab_sincronizar, Icons.Filled.Sync),
        Pestana(R.string.tab_licencias, Icons.Filled.VpnKey),
        Pestana(R.string.tab_ajustes, Icons.Filled.Settings),
    )
    Scaffold(
        containerColor = Color.Transparent,
        bottomBar = {
            NavigationBar(containerColor = d.bg2, contentColor = d.text) {
                pestanas.forEachIndexed { i, p ->
                    NavigationBarItem(
                        selected = tab == i, onClick = { tab = i },
                        icon = { Icon(p.icono, null) }, label = { Text(stringResource(p.titulo)) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = d.accent, selectedTextColor = d.accent, indicatorColor = d.accentTint,
                            unselectedIconColor = d.muted, unselectedTextColor = d.muted,
                        ),
                    )
                }
            }
        },
    ) { inner ->
        val m = Modifier.padding(inner)
        when (tab) {
            0 -> LimpiarScreen({ tab = 3 }, { tab = 2 }, m)
            1 -> SincronizarScreen({ tab = 3 }, { tab = 2 }, m)
            2 -> LicenciasScreen(m)
            else -> AjustesScreen(repetirConfigurador, m)
        }
    }
}
