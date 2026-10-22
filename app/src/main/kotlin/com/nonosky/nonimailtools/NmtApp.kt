package com.nonosky.nonimailtools

import android.app.Application
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.data.Ajustes
import com.nonosky.nonimailtools.data.RepoCuentas
import com.nonosky.nonimailtools.data.RepoLicencias
import com.nonosky.nonimailtools.ia.IaManager
import com.nonosky.nonimailtools.lang.Idioma
import com.nonosky.nonimailtools.ops.Operaciones
import com.nonosky.nonimailtools.telemetria.Telemetry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Application: builds the singletons once, installs the crash handler and drives the periodic flush. */
class NmtApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var ajustes: Ajustes; private set
    lateinit var cuentas: RepoCuentas; private set
    lateinit var licencias: RepoLicencias; private set
    lateinit var telemetry: Telemetry; private set
    lateinit var operaciones: Operaciones; private set
    lateinit var ia: IaManager; private set

    private var periodico: Job? = null

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        ajustes = Ajustes(this, scope)
        cuentas = RepoCuentas(this, scope)
        licencias = RepoLicencias(this, scope)
        telemetry = Telemetry(this, ajustes, cuentas)
        operaciones = Operaciones(this)
        ia = IaManager(this)
        instalarManejadorDeErrores()
        telemetry.log.i("app", "Start ${BuildConfig.VERSION_NAME} (${BuildConfig.ORIGEN_DESCARGA})")

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                telemetry.registrar(Telemetria.inicio())
                telemetry.programarPeriodico()
                telemetry.enviarYa()
                // While the app is open, a batch goes out every 5 minutes.
                periodico = scope.launch {
                    while (true) { delay(5 * 60_000L); telemetry.enviarYa() }
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                periodico?.cancel(); periodico = null
                telemetry.enviarYa()
            }
        })
    }

    /** Uncaught exceptions: local log + `error` event (contexto "app"), then the default handler. */
    private fun instalarManejadorDeErrores() {
        val previo = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            runCatching { telemetry.error("app", "Uncaught in ${t.name}: ${e.message ?: e.javaClass.simpleName}", e) }
            previo?.uncaughtException(t, e)
        }
    }

    companion object {
        lateinit var instance: NmtApp
            private set

        /** Language wrapper used by the activity before it inflates anything. */
        fun contextoConIdioma(base: Context): Context =
            if (::instance.isInitialized) Idioma.envolver(base, instance.ajustes.idiomaGuardado()) else base
    }
}
