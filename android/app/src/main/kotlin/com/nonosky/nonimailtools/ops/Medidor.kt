package com.nonosky.nonimailtools.ops

import android.app.ActivityManager
import android.content.Context
import android.os.SystemClock
import java.io.File

/** What the phone is using right now, for the line above the terminals. */
data class Uso(val ramUsadaMb: Long, val ramTotalMb: Long, val appMb: Long, val cpuPct: Int, val nucleos: Int)

/**
 * Reads RAM (whole phone and this app) and this app's CPU (all cores: 100% = one core busy, so
 * eight cores at full speed read 800%). The GPU load is not readable on Android without root;
 * the AI line shows instead whether the model runs on the GPU or on the CPU.
 */
class Medidor(private val ctx: Context) {
    private var ticksAntes = -1L
    private var relojAntes = 0L
    private val hz = 100L // USER_HZ on Android kernels

    private fun ticksProceso(): Long = runCatching {
        val campos = File("/proc/self/stat").readText().substringAfterLast(')').trim().split(' ')
        campos[11].toLong() + campos[12].toLong() // utime + stime (fields 14 and 15)
    }.getOrDefault(-1L)

    fun leer(): Uso {
        val am = ctx.getSystemService(ActivityManager::class.java)
        val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val app = Runtime.getRuntime().let { (it.totalMemory() - it.freeMemory()) } +
            runCatching { android.os.Debug.getNativeHeapAllocatedSize() }.getOrDefault(0L)
        val t = ticksProceso()
        val ahora = SystemClock.elapsedRealtime()
        val pct = if (ticksAntes >= 0 && t >= 0 && ahora > relojAntes) {
            ((t - ticksAntes) * 1000L / hz * 100L / (ahora - relojAntes)).toInt().coerceAtLeast(0)
        } else 0
        ticksAntes = t; relojAntes = ahora
        val mb = 1024L * 1024L
        return Uso((mi.totalMem - mi.availMem) / mb, mi.totalMem / mb, app / mb, pct, Runtime.getRuntime().availableProcessors())
    }
}
