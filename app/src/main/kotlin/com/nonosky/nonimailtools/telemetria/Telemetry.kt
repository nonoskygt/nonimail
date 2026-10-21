package com.nonosky.nonimailtools.telemetria

import android.content.Context
import android.os.Build
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.NmtApp
import com.nonosky.nonimailtools.core.telemetria.ColaEventos
import com.nonosky.nonimailtools.core.telemetria.Enviador
import com.nonosky.nonimailtools.core.telemetria.Evento
import com.nonosky.nonimailtools.core.telemetria.Instalacion
import com.nonosky.nonimailtools.core.telemetria.Outcome
import com.nonosky.nonimailtools.core.telemetria.Poster
import com.nonosky.nonimailtools.core.telemetria.Registro
import com.nonosky.nonimailtools.core.telemetria.Telemetria
import com.nonosky.nonimailtools.data.Ajustes
import com.nonosky.nonimailtools.data.RepoCuentas
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** HTTP transport for the telemetry contract. */
private class HttpPoster : Poster {
    override fun post(url: String, body: String, userAgent: String): Int {
        val conn = try {
            URI(url).toURL().openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw IOException("Bad service URL", e)
        }
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = BuildConfig.HTTP_TIMEOUT_MS
            conn.readTimeout = BuildConfig.HTTP_TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("User-Agent", userAgent)
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            runCatching { (if (code in 200..299) conn.inputStream else conn.errorStream)?.close() }
            return code
        } finally {
            conn.disconnect()
        }
    }
}

/**
 * Telemetry and local log of the app (contract: TELEMETRIA.md v1).
 *  - Nothing is recorded or sent with the switch off, nor before the configurator has finished.
 *  - Events are queued on disk and sent in batches (WorkManager, every 15 min at most as the
 *    OS allows, plus while the app is open every 5 min, after an operation and when it closes).
 *  - The local log (rotating files) always works; every line is scrubbed first.
 */
class Telemetry(
    private val ctx: Context,
    private val ajustes: Ajustes,
    private val cuentas: RepoCuentas,
) {
    val log = Registro(
        File(ctx.filesDir, "logs"),
        own = { cuentas.cuentas.value.map { it.email } },
        secrets = { cuentas.secretos() },
    )
    private val cola = ColaEventos(File(ctx.filesDir, "telemetria/cola.jsonl"))
    private val poster = HttpPoster()

    private val version get() = BuildConfig.VERSION_NAME
    private val arch get() = Telemetria.archName(Build.SUPPORTED_ABIS.firstOrNull())
    val userAgent get() = Telemetria.userAgent(version, "android", arch)

    private fun activa(): Boolean = ajustes.valores.value.let { it.telemetria && it.configurado }

    /** Queues an event, if the person allows it. */
    fun registrar(e: Evento) {
        if (!activa()) return
        cola.add(e)
    }

    /** Operation failure or crash: local log always, `error` event if allowed. */
    fun error(contexto: String, mensaje: String, pila: Throwable?, cuenta: String? = null) {
        log.e(contexto, mensaje, pila)
        val own = cuentas.cuentas.value.map { it.email }
        registrar(Telemetria.error(mensaje, pila?.stackTraceToString(), contexto, cuenta, own, cuentas.secretos()))
    }

    private fun installRecord(): Instalacion {
        val v = ajustes.valores.value
        val ia = v.ollamaUrl.isNotBlank()
        return Instalacion(
            installId = ajustes.asegurarInstallId(), app = "android", version = version, os = "android",
            osVersion = "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})", arch = arch,
            locale = Locale.getDefault().toLanguageTag(), zonaHoraria = TimeZone.getDefault().id,
            origenDescarga = BuildConfig.ORIGEN_DESCARGA, iaLocal = ia, modelo = if (ia) v.ollamaModelo else null,
        )
    }

    private fun hashOf(i: Instalacion): String =
        MessageDigest.getInstance("SHA-1").digest(Telemetria.installBody(i).toByteArray()).joinToString("") { "%02x".format(it) }

    /** Sends the installation record (when due) and the queue. Called by the worker. */
    fun enviar(): Outcome {
        if (!activa()) return Outcome.SENT
        val v = ajustes.valores.value
        val inst = installRecord()
        val envio = Enviador(cola, poster, v.serviceUrl, inst.installId, "android", version, userAgent)
        var result = Outcome.SENT
        val h = hashOf(inst)
        if (Telemetria.installDue(v.installEnviadaMs, v.installHash.ifEmpty { null }, h, System.currentTimeMillis())) {
            when (envio.sendInstall(inst)) {
                Outcome.SENT, Outcome.DROPPED -> ajustes.installEnviada(System.currentTimeMillis(), h)
                Outcome.RETRY -> result = Outcome.RETRY
            }
        }
        if (envio.flushEvents() == Outcome.RETRY) result = Outcome.RETRY
        return result
    }

    private val redOk = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** One-shot flush (after an operation, when the app closes, right after the configurator). */
    fun enviarYa() {
        if (!activa()) return
        runCatching {
            WorkManager.getInstance(ctx).enqueueUniqueWork(
                "nmt-telemetria-ya", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<TelemetriaWorker>().setConstraints(redOk)
                    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build(),
            )
        }
    }

    /** Safety net: the OS runs this at most every 15 minutes, only with network. */
    fun programarPeriodico() {
        runCatching {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                "nmt-telemetria-periodica", ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<TelemetriaWorker>(15, TimeUnit.MINUTES).setConstraints(redOk).build(),
            )
        }
    }

    fun pendientes(): Int = cola.size()
    fun vaciar() = cola.clear()
}

class TelemetriaWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val t = NmtApp.instance.telemetry
        return when (t.enviar()) {
            Outcome.RETRY -> Result.retry()
            else -> Result.success()
        }
    }
}
