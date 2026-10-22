package com.nonosky.nonimailtools.ia

import android.app.ActivityManager
import android.content.Context
import android.os.StatFs
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.ia.ModeloIa
import com.nonosky.nonimailtools.core.ia.Recomendador
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.UUID

/** The single progress state of the model setup: verify, download, configure. */
sealed interface EstadoIa {
    data object Inactivo : EstadoIa
    data object Verificando : EstadoIa
    data class Descargando(val hecho: Long, val total: Long) : EstadoIa
    data object Configurando : EstadoIa
    data object Listo : EstadoIa
    /** [codigo]: red, espacio, integridad or motor. */
    data class Error(val codigo: String) : EstadoIa
    data object Cancelado : EstadoIa

    val enCurso: Boolean get() = this is Verificando || this is Descargando || this is Configurando
}

/** What this phone can run, read once per screen. */
data class Equipo(val ramBytes: Long, val libreBytes: Long)

/** Owns the setup job (WorkManager), survives screens, and builds the scorer for scans. */
class IaManager(private val app: NmtApp) {
    private val wm by lazy { WorkManager.getInstance(app) }
    private val trabajo = MutableStateFlow<UUID?>(null)
    private val _modeloEnCurso = MutableStateFlow<String?>(null)

    /** Id of the tier the current or last job is for. */
    val modeloEnCurso: StateFlow<String?> = _modeloEnCurso.asStateFlow()

    @OptIn(ExperimentalCoroutinesApi::class)
    val estado: StateFlow<EstadoIa> = trabajo
        .flatMapLatest { id -> if (id == null) flowOf(EstadoIa.Inactivo) else wm.getWorkInfoByIdFlow(id).map(::mapear) }
        .stateIn(app.scope, SharingStarted.Eagerly, EstadoIa.Inactivo)

    init {
        // A job started before the process died keeps running: pick it up again.
        app.scope.launch(Dispatchers.IO) {
            runCatching {
                val vivo = wm.getWorkInfosForUniqueWork(NOMBRE).get().firstOrNull { !it.state.isFinished }
                if (vivo != null) {
                    _modeloEnCurso.value = vivo.tags.firstOrNull { it.startsWith(PREFIJO) }?.removePrefix(PREFIJO)
                    trabajo.value = vivo.id
                }
            }
        }
        // Cancelled by the button or by the notification: either way the partial file goes away.
        app.scope.launch(Dispatchers.IO) {
            estado.collect { if (it is EstadoIa.Cancelado) {
                    borrarParciales()
                    // The writer may still flush after the cancel; sweep again unless a retry already began.
                    delay(2000)
                    if (estado.value is EstadoIa.Cancelado) borrarParciales()
                } }
        }
    }

    private fun mapear(w: WorkInfo?): EstadoIa = if (w == null) EstadoIa.Inactivo else when (w.state) {
        WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED -> EstadoIa.Verificando
        WorkInfo.State.RUNNING -> when (w.progress.getInt(DescargaModeloWorker.CLAVE_FASE, 0)) {
            DescargaModeloWorker.FASE_DESCARGA -> EstadoIa.Descargando(
                w.progress.getLong(DescargaModeloWorker.CLAVE_HECHO, 0), w.progress.getLong(DescargaModeloWorker.CLAVE_TOTAL, 0),
            )
            DescargaModeloWorker.FASE_CONFIGURAR -> EstadoIa.Configurando
            else -> EstadoIa.Verificando
        }
        WorkInfo.State.SUCCEEDED -> EstadoIa.Listo
        WorkInfo.State.FAILED -> EstadoIa.Error(w.outputData.getString(DescargaModeloWorker.CLAVE_ERROR) ?: "red")
        WorkInfo.State.CANCELLED -> EstadoIa.Cancelado
    }

    fun equipo(ctx: Context): Equipo {
        val info = ActivityManager.MemoryInfo()
        ctx.getSystemService(ActivityManager::class.java).getMemoryInfo(info)
        val dir = RutasIa.dir(ctx).apply { mkdirs() }
        return Equipo(info.totalMem, StatFs(dir.path).availableBytes)
    }

    fun recomendado(ctx: Context): ModeloIa {
        val e = equipo(ctx)
        return Recomendador.recomendar(Defaults.instance.localAi, e.ramBytes, e.libreBytes)
    }

    /** Starts (or restarts) the setup of [m]. A previous partial file of the same model is resumed. */
    fun iniciar(m: ModeloIa) {
        app.ajustes.iaModo(m.id)
        borrarOtros(m)
        val req = OneTimeWorkRequestBuilder<DescargaModeloWorker>()
            .setInputData(workDataOf(DescargaModeloWorker.CLAVE_MODELO to m.id))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .addTag(PREFIJO + m.id)
            .build()
        wm.enqueueUniqueWork(NOMBRE, ExistingWorkPolicy.REPLACE, req)
        _modeloEnCurso.value = m.id
        trabajo.value = req.id
    }

    /** Stops the job in any phase. The partial file is deleted when the state turns to Cancelado. */
    fun cancelar() {
        trabajo.value?.let { wm.cancelWorkById(it) }
    }

    /** Back to the idle step (after Omitir). */
    fun reiniciar() {
        trabajo.value = null
        _modeloEnCurso.value = null
    }

    /** The scorer for a scan. Blocking: loads the model. Caller closes it. */
    fun puntuador(id: String): PuntuadorLocal {
        val m = Defaults.instance.localAi.models.first { it.id == id }
        return PuntuadorLocal(app, m)
    }

    private fun borrarParciales() {
        RutasIa.dir(app).listFiles { f -> f.name.endsWith(".part") }?.forEach { it.delete() }
    }

    /** One model on the phone at a time: the others (up to 3.6 GB each) are freed. */
    private fun borrarOtros(m: ModeloIa) {
        for (o in Defaults.instance.localAi.models) {
            if (o.id == m.id) continue
            RutasIa.archivo(app, o).delete(); RutasIa.parcial(app, o).delete()
            if (app.ajustes.valores.value.iaListoId == o.id) app.ajustes.iaListoId("")
        }
    }

    private companion object {
        const val NOMBRE = "ia-modelo"
        const val PREFIJO = "modelo:"
    }
}
