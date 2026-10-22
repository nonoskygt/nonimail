package com.nonosky.nonimailtools.ia

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.StatFs
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.ia.ModeloIa
import com.nonosky.nonimailtools.core.ia.ProgresoDescarga
import com.nonosky.nonimailtools.ops.OperacionService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext

/**
 * One job for the whole setup: check, download (resumable with HTTP Range), verify SHA-256,
 * then load the model once with a warm-up question. Progress goes out as WorkManager progress.
 * Cancelling it (button or notification) stops every phase; [IaManager] deletes the partial file.
 */
class DescargaModeloWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    private var ultimoAviso = 0L

    private class Fallo(val codigo: String, val detalle: String? = null) : Exception(detalle ?: codigo)

    override suspend fun doWork(): Result {
        val modelo = Defaults.instance.localAi.models.firstOrNull { it.id == inputData.getString(CLAVE_MODELO) }
            ?: return Result.failure(workDataOf(CLAVE_ERROR to "motor"))
        return try {
            preparar(modelo)
            descargar(modelo)
            verificar(modelo)
            configurar(modelo)
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Fallo) {
            NmtApp.instance.telemetry.log.w("ia", "Model setup failed (${e.codigo}): ${e.detalle}")
            Result.failure(workDataOf(CLAVE_ERROR to e.codigo))
        }
    }

    private suspend fun avisar(fase: Int, hecho: Long = 0, total: Long = 0, forzar: Boolean = true) {
        val ahora = System.currentTimeMillis()
        if (!forzar && ahora - ultimoAviso < 500) return
        ultimoAviso = ahora
        setProgress(Data.Builder().putInt(CLAVE_FASE, fase).putLong(CLAVE_HECHO, hecho).putLong(CLAVE_TOTAL, total).build())
        val texto = when (fase) {
            FASE_DESCARGA -> ProgresoDescarga.texto(hecho, total)
            FASE_CONFIGURAR -> applicationContext.getString(R.string.ia_fase_configurando)
            else -> applicationContext.getString(R.string.ia_fase_verificando)
        }
        runCatching { setForeground(info(texto, if (fase == FASE_DESCARGA && total > 0) hecho.toFloat() / total else null)) }
    }

    private fun info(texto: String, fraccion: Float?): ForegroundInfo {
        val c = applicationContext
        OperacionService.crearCanal(c)
        val n = NotificationCompat.Builder(c, OperacionService.CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(c.getString(R.string.ia_notificacion))
            .setContentText(texto)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .addAction(0, c.getString(R.string.cancelar), WorkManager.getInstance(c).createCancelPendingIntent(id))
            .apply { if (fraccion != null) setProgress(1000, (fraccion * 1000).toInt(), false) else setProgress(0, 0, true) }
            .build()
        return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(NOTIF_ID, n)
    }

    private suspend fun preparar(m: ModeloIa) {
        avisar(FASE_VERIFICAR)
        val dir = RutasIa.dir(applicationContext).apply { mkdirs() }
        val parcial = RutasIa.parcial(applicationContext, m)
        val yaBajado = RutasIa.archivo(applicationContext, m).takeIf { it.exists() }?.length() ?: 0L
        val falta = if (yaBajado == m.bytes) 0L else m.bytes - parcial.length().coerceAtMost(m.bytes)
        if (StatFs(dir.path).availableBytes < falta + MARGEN_BYTES) throw Fallo("espacio")
    }

    private suspend fun descargar(m: ModeloIa) {
        val ctx = applicationContext
        val final = RutasIa.archivo(ctx, m)
        val parcial = RutasIa.parcial(ctx, m)
        if (final.exists() && final.length() == m.bytes) { parcial.delete(); return }
        var hecho = parcial.length()
        if (hecho > m.bytes) { parcial.delete(); hecho = 0 }
        if (hecho < m.bytes) {
            withContext(Dispatchers.IO) {
                coroutineScope {
                    val (conn, desde) = try {
                        abrir(m.url, hecho)
                    } catch (e: IOException) {
                        throw Fallo("red", e.message)
                    }
                    // Closing the socket is the only way to wake a blocked read when the job is cancelled.
                    val guardia = launch { try { awaitCancellation() } finally { conn.disconnect() } }
                    try {
                        hecho = desde
                        avisar(FASE_DESCARGA, hecho, m.bytes)
                        val buf = ByteArray(256 * 1024)
                        FileOutputStream(parcial, desde > 0).use { out ->
                            conn.inputStream.use { ins ->
                                while (true) {
                                    coroutineContext.ensureActive()
                                    val n = ins.read(buf)
                                    if (n < 0) break
                                    out.write(buf, 0, n)
                                    hecho += n
                                    avisar(FASE_DESCARGA, hecho, m.bytes, forzar = false)
                                }
                            }
                        }
                    } catch (e: IOException) {
                        coroutineContext.ensureActive() // a cancel closes the socket: report it as a cancel
                        throw Fallo("red", e.message)
                    } finally {
                        guardia.cancel()
                        conn.disconnect()
                    }
                }
            }
        }
        if (parcial.length() != m.bytes) throw Fallo("red", "size ${parcial.length()} of ${m.bytes}")
    }

    /** Opens the file from byte [desde]. Returns the connection and the byte it really starts at. */
    private fun abrir(url: String, desde: Long): Pair<HttpURLConnection, Long> {
        val c = URI(url).toURL().openConnection() as HttpURLConnection
        c.connectTimeout = 15_000
        c.readTimeout = 30_000
        c.instanceFollowRedirects = true
        if (desde > 0) c.setRequestProperty("Range", "bytes=$desde-")
        val code = c.responseCode
        if (code == 206 && ProgresoDescarga.parseContentRange(c.getHeaderField("Content-Range"))?.inicio == desde) return c to desde
        if (code == 200) return c to 0L
        c.disconnect()
        // 416 or a server that ignored Range: start over once.
        if (desde > 0 && (code == 206 || code == 416)) return abrir(url, 0)
        throw IOException("HTTP $code")
    }

    private suspend fun verificar(m: ModeloIa) {
        avisar(FASE_VERIFICAR)
        val ctx = applicationContext
        val parcial = RutasIa.parcial(ctx, m)
        val final = RutasIa.archivo(ctx, m)
        val aVerificar = if (parcial.exists()) parcial else final
        val hex = withContext(Dispatchers.IO) {
            val md = MessageDigest.getInstance("SHA-256")
            aVerificar.inputStream().use { ins ->
                val buf = ByteArray(1024 * 1024)
                while (true) {
                    coroutineContext.ensureActive()
                    val n = ins.read(buf)
                    if (n < 0) break
                    md.update(buf, 0, n)
                }
            }
            md.digest().joinToString("") { "%02x".format(it) }
        }
        if (!hex.equals(m.sha256, ignoreCase = true)) {
            aVerificar.delete()
            throw Fallo("integridad")
        }
        if (aVerificar == parcial) {
            final.delete()
            if (!parcial.renameTo(final)) throw Fallo("motor", "rename failed")
        }
    }

    /** Loads the model and asks it one short question. The blocking native call cannot be interrupted. */
    private suspend fun configurar(m: ModeloIa) {
        avisar(FASE_CONFIGURAR)
        val ok = withContext(Dispatchers.IO) {
            try {
                PuntuadorLocal(applicationContext, m).use { it.calentar() }
                true
            } catch (e: Throwable) {
                NmtApp.instance.telemetry.log.w("ia", "Model load failed: ${e.message}")
                false
            }
        }
        coroutineContext.ensureActive()
        if (!ok) throw Fallo("motor")
        NmtApp.instance.ajustes.iaListoId(m.id)
    }

    companion object {
        const val CLAVE_MODELO = "modelo"
        const val CLAVE_ERROR = "err"
        const val CLAVE_FASE = "fase"
        const val CLAVE_HECHO = "hecho"
        const val CLAVE_TOTAL = "total"
        const val FASE_VERIFICAR = 0
        const val FASE_DESCARGA = 1
        const val FASE_CONFIGURAR = 3
        private const val NOTIF_ID = 1002
        private const val MARGEN_BYTES = 100L * 1024 * 1024
    }
}
