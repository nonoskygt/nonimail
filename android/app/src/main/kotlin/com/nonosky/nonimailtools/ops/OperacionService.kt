package com.nonosky.nonimailtools.ops

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.nonosky.nonimailtools.MainActivity
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.R
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Foreground service (type dataSync) that runs the long operations with a progress
 * notification and a Cancel action. One operation at a time.
 */
class OperacionService : Service() {
    private val running = AtomicBoolean(false)
    private var wake: PowerManager.WakeLock? = null
    private var lastNotify = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val app = application as NmtApp
        when (intent?.action) {
            ACTION_CANCEL -> {
                app.operaciones.cancelar()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                // Must call startForeground within seconds of startForegroundService().
                val job = app.operaciones.tomarPendiente()
                promover(notificacion(job?.titulo ?: R.string.op_trabajando, "", null))
                if (job == null || !running.compareAndSet(false, true)) {
                    app.operaciones.liberar()
                    if (job == null) stopSelf()
                    return START_NOT_STICKY
                }
                val pm = getSystemService(POWER_SERVICE) as PowerManager
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nonimailtools:op").apply {
                    setReferenceCounted(false); acquire(WAKE_MAX_MS)
                }
                Thread({
                    try {
                        app.operaciones.ejecutar(job) { a -> actualizar(a) }
                    } catch (e: Throwable) {
                        app.telemetry.error("app", "Operation crashed: ${e.message}", e)
                        app.operaciones.abortar()
                    } finally {
                        running.set(false)
                        runCatching { wake?.release() }
                        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                        // A short "finished" notice outlives the service when the app is in background.
                        stopSelf()
                    }
                }, "nmt-operacion").start()
            }
        }
        return START_NOT_STICKY
    }

    /** Android 15: dataSync services get a time limit. Cancel cleanly and stop. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        val app = application as NmtApp
        app.telemetry.log.w("app", "Foreground service time limit reached; cancelling")
        app.operaciones.cancelar()
        stopSelf()
    }

    override fun onDestroy() {
        runCatching { wake?.release() }
        super.onDestroy()
    }

    private fun promover(n: Notification) {
        ServiceCompat.startForeground(this, ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }

    private fun actualizar(a: Avance) {
        val now = System.currentTimeMillis()
        if (now - lastNotify < 800) return
        lastNotify = now
        val nm = getSystemService(NotificationManager::class.java)
        runCatching { nm.notify(ID, notificacion(a.titulo, a.detalle, a.fraccion)) }
    }

    private fun notificacion(titulo: Int, detalle: String, fraccion: Float?): Notification {
        crearCanal(this)
        val abrir = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val cancelar = PendingIntent.getService(
            this, 1, Intent(this, OperacionService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(getString(titulo))
            .setContentText(detalle.ifEmpty { null })
            .setContentIntent(abrir)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, getString(R.string.cancelar), cancelar)
        if (fraccion != null) b.setProgress(1000, (fraccion * 1000).toInt(), false) else b.setProgress(0, 0, true)
        return b.build()
    }

    companion object {
        const val ACTION_START = "com.nonosky.nonimailtools.START"
        const val ACTION_CANCEL = "com.nonosky.nonimailtools.CANCEL"
        const val CANAL = "operaciones"
        const val ID = 1001
        private const val WAKE_MAX_MS = 6 * 60 * 60 * 1000L

        fun crearCanal(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CANAL) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CANAL, ctx.getString(R.string.canal_operaciones), NotificationManager.IMPORTANCE_LOW),
                )
            }
        }
    }
}
