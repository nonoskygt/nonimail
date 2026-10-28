package com.nonosky.nonimailtools.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.Defaults
import com.nonosky.nonimailtools.core.licencias.Comprobante
import com.nonosky.nonimailtools.core.licencias.Dominios
import com.nonosky.nonimailtools.core.licencias.SubscriptionVerifier
import com.nonosky.nonimailtools.core.servicio.Plan
import com.nonosky.nonimailtools.core.servicio.Precios
import com.nonosky.nonimailtools.core.servicio.Transporte
import com.nonosky.nonimailtools.core.servicio.TransporteUrl
import com.nonosky.nonimailtools.core.telemetria.Registro
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.util.concurrent.TimeUnit

/** What Ajustes → Planes and the gate need: the last plan answer and the verified subscription proof. */
data class EstadoPlan(val plan: Plan?, val comprobante: Comprobante?, val actualizadoMs: Long) {
    /** The prices of the service when it sent them, else the ones of `defaults.json`. */
    val precios: Precios get() = plan?.precios ?: Defaults.instance.planes

    /** Subscription in force according to the last answer (the gate itself looks at [comprobante]). */
    val suscrito: Boolean get() = plan?.suscripcion?.vigente == true
}

/**
 * The plan of the web account (`GET /api/plan`) and its signed proof `NMTS1.`. Renewed at app start and
 * every [BuildConfig.PLAN_REFRESH_HOURS] while signed in, and kept in the store so the gate works offline:
 * nothing is accepted because the service says so, only the signature checked here. A private-domain
 * account that is not in the proof while the subscription is in force takes a free seat
 * (`POST /api/suscripcion/cubrir`), then the plan is asked again. Blocking calls: never on the main thread.
 */
class RepoPlan(
    private val ctx: Context,
    private val servicio: Servicio,
    private val cuentas: RepoCuentas,
    private val ajustes: Ajustes,
    private val log: Registro,
    scope: CoroutineScope,
    private val http: Transporte = TransporteUrl,
) {
    private val kPlan = stringPreferencesKey("plan_json")
    private val kMs = longPreferencesKey("plan_ms")
    private val verificador = SubscriptionVerifier.bundled()
    private val cfg get() = Defaults.instance.servicio

    private fun leer(texto: String?, ms: Long?): EstadoPlan {
        val p = Plan.parse(texto)
        return EstadoPlan(p, p?.token?.let { verificador.read(it) }, ms ?: 0L)
    }

    private val inicial = runBlocking { ctx.nmtStore.data.first().let { leer(it[kPlan], it[kMs]) } }
    val estado: StateFlow<EstadoPlan> = ctx.nmtStore.data.map { leer(it[kPlan], it[kMs]) }.stateIn(scope, SharingStarted.Eagerly, inicial)

    /** The verified proof for the gate (null = none or not signed by us). Expiry is checked by the gate. */
    fun comprobante(): Comprobante? = estado.value.comprobante

    /** True when the last refresh is older than the period (or there was none). */
    fun vencido(): Boolean = System.currentTimeMillis() - estado.value.actualizadoMs >= TimeUnit.HOURS.toMillis(BuildConfig.PLAN_REFRESH_HOURS.toLong())

    private fun url(ruta: String) = TransporteUrl.url(ajustes.valores.value.serviceUrl, ruta)

    /** One `GET /api/plan`. Null without session, without network or on a bad answer (the stored one stays). */
    private fun pedirPlan(tok: String): Pair<Plan, String>? {
        val r = try { http.pedir("GET", url(cfg.planPath), null, tok, cfg.timeoutMs) } catch (e: IOException) { return null }
        if (r.status == 401 || r.status == 403) { servicio.cerrar(); return null }
        if (!r.ok) return null
        val p = Plan.parse(r.cuerpo) ?: return null
        return p to r.cuerpo.orEmpty()
    }

    /** Renews the plan; covers the private-domain accounts that are missing from the proof. Blocking; never throws. */
    @Synchronized
    fun refrescar() {
        try {
            val tok = servicio.tokenActual() ?: return
            var (plan, texto) = pedirPlan(tok) ?: return
            if (plan.suscripcion?.vigente == true) {
                val ahora = System.currentTimeMillis() / 1000
                val comp = plan.token?.let { verificador.read(it) }
                val faltan = cuentas.cuentas.value.map { it.email.trim().lowercase() }
                    .filter { !Dominios.esPersonal(it) && comp?.cubre(it, ahora) != true }.distinct()
                var cubrio = false
                for (c in faltan) {
                    val r = try {
                        http.pedir("POST", url(cfg.cubrirPath), buildJsonObject { put("cuenta", c) }.toString(), tok, cfg.timeoutMs)
                    } catch (e: IOException) { break }
                    when {
                        r.ok -> { cubrio = true; log.i("plan", "Account covered by the subscription") }
                        // 402: no seat left or no subscription in force; tried again on the next refresh.
                        r.status == 402 -> log.i("plan", "No free seat for an account (402)")
                        else -> log.w("plan", "Cover failed (HTTP ${r.status})")
                    }
                }
                if (cubrio) pedirPlan(tok)?.let { plan = it.first; texto = it.second }
            }
            runBlocking { ctx.nmtStore.edit { it[kPlan] = texto; it[kMs] = System.currentTimeMillis() } }
            log.i("plan", "Plan refreshed (subscription ${if (plan.suscripcion?.vigente == true) "in force" else "none"})")
        } catch (e: Exception) {
            log.w("plan", "Plan not refreshed (${e.message ?: e.javaClass.simpleName})")
        }
    }
}
