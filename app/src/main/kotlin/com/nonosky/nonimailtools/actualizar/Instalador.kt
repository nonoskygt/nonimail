package com.nonosky.nonimailtools.actualizar

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.content.IntentCompat
import com.nonosky.nonimailtools.NmtApp
import java.io.File

/** Hands a verified APK to the system through a PackageInstaller session. */
internal object Instalador {
    const val ACCION = "com.nonosky.nonimailtools.INSTALACION"
    const val EXTRA_VERSION = "version"

    /**
     * Writes [apk] into a new session and commits it. The result arrives at [InstalacionReceiver].
     * [silencioso] asks the platform (Android 12+) to skip the confirmation when it is allowed to;
     * otherwise the receiver gets PENDING_USER_ACTION and the person confirms.
     */
    fun instalar(ctx: Context, apk: File, version: String, silencioso: Boolean) {
        val instalador = ctx.packageManager.packageInstaller
        // A session left behind by an earlier attempt would keep its copy of the APK on disk.
        for (s in instalador.mySessions) runCatching { instalador.abandonSession(s.sessionId) }

        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        params.setSize(apk.length())
        if (Build.VERSION.SDK_INT >= 31) {
            params.setRequireUserAction(
                if (silencioso) PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED else PackageInstaller.SessionParams.USER_ACTION_REQUIRED,
            )
        }
        // Becoming the update owner is what lets later updates go through without a tap.
        if (Build.VERSION.SDK_INT >= 34) params.setRequestUpdateOwnership(true)

        val id = instalador.createSession(params)
        val sesion = instalador.openSession(id)
        try {
            apk.inputStream().use { ins ->
                sesion.openWrite("base.apk", 0, apk.length()).use { out ->
                    ins.copyTo(out)
                    sesion.fsync(out)
                }
            }
            val intent = Intent(ctx, InstalacionReceiver::class.java).setAction(ACCION).putExtra(EXTRA_VERSION, version)
            // Mutable on purpose: the system fills in the status extras. The intent is explicit.
            val pendiente = PendingIntent.getBroadcast(ctx, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
            sesion.commit(pendiente.intentSender)
        } catch (e: Throwable) {
            runCatching { sesion.abandon() }
            throw e
        } finally {
            runCatching { sesion.close() }
        }
    }
}

/** Receives the session result: asks for the confirmation, or records the failure. */
class InstalacionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Instalador.ACCION) return
        val app = context.applicationContext as? NmtApp ?: return
        val estado = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val mensaje = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
        when (estado) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmar = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java) ?: return
                app.actualizaciones.pedirConfirmacion(confirmar)
            }
            PackageInstaller.STATUS_SUCCESS -> app.telemetry.log.i("actualizacion", "Install session succeeded")
            else -> app.actualizaciones.instalacionFallida(estado, mensaje)
        }
    }
}
