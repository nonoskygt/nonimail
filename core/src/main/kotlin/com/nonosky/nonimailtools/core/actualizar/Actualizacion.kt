package com.nonosky.nonimailtools.core.actualizar

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Semantic version (semver 2.0): `1.2.0`, `v1.2.0`, `1.3.0-rc.1`. Build metadata (`+x`) is ignored. */
data class Version(val mayor: Long, val menor: Long, val parche: Long, val pre: List<String> = emptyList()) : Comparable<Version> {

    override fun compareTo(other: Version): Int {
        compareValues(mayor, other.mayor).takeIf { it != 0 }?.let { return it }
        compareValues(menor, other.menor).takeIf { it != 0 }?.let { return it }
        compareValues(parche, other.parche).takeIf { it != 0 }?.let { return it }
        // A version without pre-release is greater than the same one with it.
        if (pre.isEmpty() && other.pre.isEmpty()) return 0
        if (pre.isEmpty()) return 1
        if (other.pre.isEmpty()) return -1
        for (i in 0 until minOf(pre.size, other.pre.size)) {
            val a = pre[i]; val b = other.pre[i]
            val na = a.toLongOrNull(); val nb = b.toLongOrNull()
            val c = when {
                na != null && nb != null -> na.compareTo(nb)
                na != null -> -1 // numeric identifiers are lower than alphanumeric ones
                nb != null -> 1
                else -> a.compareTo(b)
            }
            if (c != 0) return c
        }
        return pre.size.compareTo(other.pre.size)
    }

    override fun toString() = "$mayor.$menor.$parche" + if (pre.isEmpty()) "" else "-" + pre.joinToString(".")

    companion object {
        private val NUCLEO = Regex("""^(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?$""")

        /** Null when [texto] is not a version. */
        fun parse(texto: String?): Version? {
            var t = texto?.trim() ?: return null
            if (t.startsWith("v") || t.startsWith("V")) t = t.substring(1)
            t = t.substringBefore('+')
            val nucleo = t.substringBefore('-')
            val pre = if ('-' in t) t.substringAfter('-').split('.') else emptyList()
            if (pre.any { it.isEmpty() }) return null
            val m = NUCLEO.matchEntire(nucleo) ?: return null
            return Version(m.groupValues[1].toLong(), m.groupValues[2].ifEmpty { "0" }.toLong(), m.groupValues[3].ifEmpty { "0" }.toLong(), pre)
        }

        /** True when [remota] parses and is strictly newer than [actual]. Unparsable text is never newer. */
        fun esMasNueva(remota: String?, actual: String): Boolean {
            val r = parse(remota) ?: return false
            val a = parse(actual) ?: return false
            return r > a
        }
    }
}

/** What to do about an update. Pure: the app feeds it the facts and carries out the answer. */
enum class Accion {
    /** Nothing to do (up to date, or the setting is off and nobody asked). */
    NADA,

    /** Download and verify the APK in the background. */
    DESCARGAR,

    /** The APK is ready: tell the person (notification and banner); installing takes one tap. */
    AVISAR,

    /** The APK is ready and the platform may update without a tap (the app is in the background). */
    INSTALAR_SILENCIOSO,

    /** The APK is ready but a sync or clean is running: do not install yet. */
    ESPERAR,
}

object Actualizador {
    /**
     * @param remota version of the latest release (null = unknown)
     * @param automatica the «Actualizar automáticamente» switch
     * @param solicitada the person pressed «Buscar actualizaciones»
     * @param apkListo the APK is already downloaded and verified
     * @param operacionEnCurso a sync or clean is running
     * @param appVisible the app is on screen (never update silently under the person's hands)
     */
    fun decidir(
        actual: String,
        remota: String?,
        automatica: Boolean,
        solicitada: Boolean,
        apkListo: Boolean,
        operacionEnCurso: Boolean,
        appVisible: Boolean,
    ): Accion {
        if (!Version.esMasNueva(remota, actual)) return Accion.NADA
        if (!apkListo) return if (automatica || solicitada) Accion.DESCARGAR else Accion.NADA
        if (operacionEnCurso) return Accion.ESPERAR
        return if (automatica && !appVisible) Accion.INSTALAR_SILENCIOSO else Accion.AVISAR
    }
}

/** The release that GitHub calls `latest`, reduced to what the updater needs. */
data class Lanzamiento(val tag: String, val version: Version, val apkUrl: String, val apkBytes: Long, val sumasUrl: String)

object Lanzamientos {
    @Serializable private class ArchivoJson(val name: String = "", @SerialName("browser_download_url") val url: String = "", val size: Long = 0)

    @Serializable private class LanzamientoJson(
        @SerialName("tag_name") val tag: String = "",
        val draft: Boolean = false,
        val prerelease: Boolean = false,
        val assets: List<ArchivoJson> = emptyList(),
    )

    private val json = Json { ignoreUnknownKeys = true }

    /** Null when the release is a draft or pre-release, has no parsable tag, or lacks the APK or the checksums file. */
    fun parse(texto: String, nombreApk: String, nombreSumas: String): Lanzamiento? {
        val r = json.decodeFromString<LanzamientoJson>(texto)
        if (r.draft || r.prerelease) return null
        val version = Version.parse(r.tag) ?: return null
        val apk = r.assets.firstOrNull { it.name == nombreApk && it.url.startsWith("https://") } ?: return null
        val sumas = r.assets.firstOrNull { it.name == nombreSumas && it.url.startsWith("https://") } ?: return null
        return Lanzamiento(r.tag, version, apk.url, apk.size, sumas.url)
    }
}

object Sumas {
    private val LINEA = Regex("""^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$""")

    /** SHA-256 (lowercase hex) of [archivo] in a `sha256sum` listing, or null. */
    fun buscar(texto: String, archivo: String): String? =
        texto.lineSequence().mapNotNull { LINEA.matchEntire(it.trim()) }
            .firstOrNull { it.groupValues[2].substringAfterLast('/') == archivo }
            ?.groupValues?.get(1)?.lowercase()
}
