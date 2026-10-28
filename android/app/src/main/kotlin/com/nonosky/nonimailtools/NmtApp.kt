package com.nonosky.nonimailtools

import android.app.Application
import android.content.Context
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.nonosky.nonimailtools.actualizar.Actualizaciones
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.limpiar.IaNonosky
import com.nonosky.nonimailtools.core.servicio.TareasApi
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.data.Ajustes
import com.nonosky.nonimailtools.data.RepoCuentas
import com.nonosky.nonimailtools.data.RepoLicencias
import com.nonosky.nonimailtools.data.RepoPlan
import com.nonosky.nonimailtools.data.RepoTareas
import com.nonosky.nonimailtools.data.RepoReglas
import com.nonosky.nonimailtools.data.RepoReputacion
import com.nonosky.nonimailtools.data.Servicio
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
    lateinit var servicio: Servicio; private set
    lateinit var reglas: RepoReglas; private set
    lateinit var plan: RepoPlan; private set
    lateinit var tareasServidor: RepoTareas; private set
    lateinit var reputacion: RepoReputacion; private set
    lateinit var telemetry: Telemetry; private set
    lateinit var operaciones: Operaciones; private set
    lateinit var ia: IaManager; private set
    lateinit var actualizaciones: Actualizaciones; private set

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
        servicio = Servicio(this, ajustes, licencias, scope)
        telemetry = Telemetry(this, ajustes, cuentas)
        reglas = RepoReglas(ajustes, servicio, scope, telemetry.log)
        plan = RepoPlan(this, servicio, cuentas, ajustes, telemetry.log, scope)
        tareasServidor = RepoTareas { tareas() }
        reputacion = RepoReputacion(this, ajustes, telemetry.log)
        ajustes.migrarReglas()
        operaciones = Operaciones(this)
        ia = IaManager(this)
        actualizaciones = Actualizaciones(this)
        instalarManejadorDeErrores()
        // A session that just opened (or the one the app starts with) syncs the saved rules.
        scope.launch {
            servicio.email.collect {
                if (it.isNotEmpty()) { reglas.pronto(0); launch(Dispatchers.IO) { plan.refrescar() } }
            }
        }
        telemetry.log.i("app", "Start ${BuildConfig.VERSION_NAME} (${BuildConfig.ORIGEN_DESCARGA})")

        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                telemetry.registrar(Telemetria.inicio())
                telemetry.programarPeriodico()
                telemetry.enviarYa()
                actualizaciones.alIniciar()
                // Signed in to the web service: refresh the licenses bought since last time.
                if (servicio.email.value.isNotEmpty()) {
                    scope.launch(Dispatchers.IO) { runCatching { servicio.traerLicencias() } }
                    scope.launch(Dispatchers.IO) { plan.refrescar() }
                    reglas.pronto(0)
                }
                scope.launch(Dispatchers.IO) { reputacion.actualizarSiVencida() }
                // While the app is open, a batch goes out every 5 minutes.
                periodico = scope.launch {
                    while (true) {
                        delay(5 * 60_000L); telemetry.enviarYa()
                        // The subscription proof is renewed every PLAN_REFRESH_HOURS while signed in.
                        if (servicio.email.value.isNotEmpty() && plan.vencido()) launch(Dispatchers.IO) { plan.refrescar() }
                    }
                }
            }

            override fun onStop(owner: LifecycleOwner) {
                periodico?.cancel(); periodico = null
                actualizaciones.alSalir()
                telemetry.enviarYa()
            }
        })
    }

    /** Client of the subscription's AI on the server, with the session of the web account. */
    fun iaNonosky(): IaNonosky = IaNonosky(ajustes.valores.value.serviceUrl, Defaults.instance.iaNonosky, { servicio.tokenActual() })

    /** Client of the permanent tasks on the server (`/api/tareas`). */
    fun tareas(): TareasApi = Defaults.instance.servicio.let { TareasApi(ajustes.valores.value.serviceUrl, it.tareasPath, { servicio.tokenActual() }, it.timeoutMs, durezaMin = it.durezaMin) }

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
