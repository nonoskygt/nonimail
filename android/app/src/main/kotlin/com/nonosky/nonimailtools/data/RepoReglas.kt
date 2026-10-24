package com.nonosky.nonimailtools.data

import com.nonosky.nonimailtools.core.limpiar.AlmacenReglas
import com.nonosky.nonimailtools.core.limpiar.Fusion
import com.nonosky.nonimailtools.core.limpiar.ReglaFecha
import com.nonosky.nonimailtools.core.limpiar.ResultadoSyncReglas
import com.nonosky.nonimailtools.core.limpiar.SincronizadorReglas
import com.nonosky.nonimailtools.core.telemetria.Registro
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** How the last rules sync went. [ok] null = not tried / no session. */
data class EstadoReglas(val ok: Boolean? = null, val motivo: Motivo = Motivo.NINGUNO) {
    enum class Motivo { NINGUNO, SIN_SERVICIO, SESION_VENCIDA, ERROR }
}

/**
 * Saved sender rules and their sync with the web account (`GET/PUT /api/reglas-remitentes`).
 * A change is written first (the phone works alone) and synced after a short wait, so a burst of
 * clicks makes one round. No session, or a service without the endpoint: it stays local, silently.
 */
class RepoReglas(
    private val ajustes: Ajustes,
    private val servicio: Servicio,
    private val scope: CoroutineScope,
    private val log: Registro,
    private val esperaMs: Long = 2_000L,
) {
    private val _estado = MutableStateFlow(EstadoReglas())
    val estado: StateFlow<EstadoReglas> = _estado.asStateFlow()
    private var espera: Job? = null

    private val almacen = object : AlmacenReglas {
        override fun leer(): Map<String, ReglaFecha> = ajustes.reglasEntradas()
        override fun fusionar(remoto: Map<String, ReglaFecha>): Fusion = ajustes.reglasFusionar(remoto)
    }

    /** Saves [cambios] (key -> delete / protect / none) and schedules the sync. */
    fun cambiar(cambios: Map<String, String>) {
        scope.launch(Dispatchers.IO) {
            ajustes.reglasCambiar(cambios)
            pronto()
        }
    }

    /** Syncs in [ms] (default: a short wait); a newer request replaces the pending one. */
    fun pronto(ms: Long = esperaMs) {
        espera?.cancel()
        espera = scope.launch(Dispatchers.IO) {
            if (ms > 0) delay(ms)
            sincronizar()
        }
    }

    /** One round. Blocking; rounds never overlap. */
    @Synchronized
    fun sincronizar(): ResultadoSyncReglas {
        val r = try {
            SincronizadorReglas.sincronizar(almacen, servicio.remotoReglas())
        } catch (e: Exception) {
            ResultadoSyncReglas.Error(e.message ?: e.javaClass.simpleName)
        }
        when (r) {
            ResultadoSyncReglas.SinSesion -> _estado.value = EstadoReglas()
            ResultadoSyncReglas.SinServicio -> _estado.value = EstadoReglas(false, EstadoReglas.Motivo.SIN_SERVICIO)
            ResultadoSyncReglas.SesionVencida -> _estado.value = EstadoReglas(false, EstadoReglas.Motivo.SESION_VENCIDA)
            is ResultadoSyncReglas.Error -> _estado.value = EstadoReglas(false, EstadoReglas.Motivo.ERROR).also { log.w("reglas", "Rules not synced (${r.detalle})") }
            is ResultadoSyncReglas.Hecho -> {
                _estado.value = EstadoReglas(true)
                log.i("reglas", "Rules synced (${r.traidas} pulled, ${r.enviadas} sent)")
            }
        }
        return r
    }
}
