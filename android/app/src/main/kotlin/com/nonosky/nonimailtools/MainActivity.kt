package com.nonosky.nonimailtools

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.nonosky.nonimailtools.actualizar.Actualizaciones
import com.nonosky.nonimailtools.ui.Raiz

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(NmtApp.contextoConIdioma(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent { Raiz() }
        atenderAccion(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        atenderAccion(intent)
    }

    /** The «Versión X lista · Instalar» notification opens the app with this action: one tap, then the system dialog. */
    private fun atenderAccion(intent: Intent?) {
        if (intent?.action == Actualizaciones.ACCION_INSTALAR) {
            intent.action = null
            NmtApp.instance.actualizaciones.instalarDesdeToque()
        }
    }
}
