package com.nonosky.nonimailtools.actualizar

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.security.MessageDigest

/** Checks a downloaded APK against the installed app before anything is installed. */
internal object Firmas {
    @Suppress("DEPRECATION")
    private val FLAGS: Int =
        if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
        else PackageManager.GET_SIGNATURES

    /**
     * Null when [apk] is this same app, newer than the installed one and signed with the same certificate;
     * otherwise a short reason (the caller discards the file and logs it).
     */
    fun verificar(ctx: Context, apk: File): String? {
        val pm = ctx.packageManager
        val nuevo = archivo(pm, apk.path) ?: return "the APK cannot be read"
        if (nuevo.packageName != ctx.packageName) return "the APK is for ${nuevo.packageName}"
        val actual = try { instalado(pm, ctx.packageName) } catch (e: PackageManager.NameNotFoundException) { null }
            ?: return "the installed app cannot be read"
        if (PackageInfoCompat.getLongVersionCode(nuevo) <= PackageInfoCompat.getLongVersionCode(actual)) return "the APK is not newer"
        val huellaNueva = huellas(nuevo)
        if (huellaNueva.isEmpty()) return "the APK signature cannot be read"
        if (huellaNueva != huellas(actual)) return "the signing certificate does not match the installed app"
        return null
    }

    @Suppress("DEPRECATION")
    private fun archivo(pm: PackageManager, ruta: String): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageArchiveInfo(ruta, PackageManager.PackageInfoFlags.of(FLAGS.toLong()))
        else pm.getPackageArchiveInfo(ruta, FLAGS)

    @Suppress("DEPRECATION")
    private fun instalado(pm: PackageManager, paquete: String): PackageInfo? =
        if (Build.VERSION.SDK_INT >= 33) pm.getPackageInfo(paquete, PackageManager.PackageInfoFlags.of(FLAGS.toLong()))
        else pm.getPackageInfo(paquete, FLAGS)

    /** SHA-256 of every certificate that signs the package. */
    @Suppress("DEPRECATION")
    private fun huellas(p: PackageInfo): Set<String> {
        val firmas = (if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else null) ?: p.signatures
        return firmas?.map { f ->
            MessageDigest.getInstance("SHA-256").digest(f.toByteArray()).joinToString("") { "%02x".format(it) }
        }?.toSet() ?: emptySet()
    }
}
