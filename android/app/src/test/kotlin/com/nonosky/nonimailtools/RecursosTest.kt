package com.nonosky.nonimailtools

import com.nonosky.nonimailtools.lang.Idioma
import com.nonosky.nonimailtools.util.bytesLegibles
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Locale

class RecursosTest {
    private val res = File("src/main/res")

    private fun strings(dir: String): Map<String, String> {
        val text = File(res, "$dir/strings.xml").readText()
        return Regex("""<string name="([a-z0-9_]+)"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(text).associate { it.groupValues[1] to it.groupValues[2] }
    }

    private fun placeholders(s: String) = Regex("""%\d\$[sd]""").findAll(s).map { it.value }.sorted().toList()

    @Test fun englishAndSpanishHaveTheSameKeysAndPlaceholders() {
        val en = strings("values"); val es = strings("values-es")
        assertTrue(en.size > 150)
        assertEquals(en.keys, es.keys)
        for ((k, v) in en) assertEquals("placeholders of $k", placeholders(v), placeholders(es.getValue(k)))
    }

    @Test fun spanishUsesUstedNeverTuOrVos() {
        val es = strings("values-es")
        val prohibidas = Regex("""\b(tú|vos|tu|tus|ti|tienes|puedes|quieres|necesitas|agrega|elige|déjala|pulsa)\b""", RegexOption.IGNORE_CASE)
        for ((k, v) in es) assertNull("«$k» uses tú/vos: $v", prohibidas.find(v)?.value)
        assertTrue(es.getValue("cfg_cuenta").contains("Su "))
        assertTrue(es.getValue("clave_sin_cambios").contains("Déjela"))
    }

    @Test fun noExplanatoryParagraphs() {
        // The owner dislikes text blocks: every string is a label or a one-liner.
        for ((k, v) in strings("values") + strings("values-es").mapKeys { "es." + it.key }) {
            assertTrue("«$k» too long (${v.length})", v.length <= 130)
            assertFalse("«$k» has several sentences", Regex("""[.!?] [A-ZÁÉÍÓÚ¿¡]""").containsMatchIn(v) && v.length > 120)
        }
    }

    @Test fun figtreeAndLicenseAreBundled() {
        for (w in listOf("regular", "medium", "semibold", "bold", "extrabold")) assertTrue(File(res, "font/figtree_$w.ttf").length() > 20_000)
        assertTrue(File("../licenses/Figtree-OFL.txt").readText().contains("SIL OPEN FONT LICENSE", ignoreCase = true))
    }

    @Test fun adaptiveLauncherIconExists() {
        val x = File(res, "mipmap-anydpi/ic_launcher.xml").readText()
        assertTrue("<adaptive-icon" in x && "foreground" in x && "monochrome" in x)
    }

    @Test fun defaultsComeFromBuildConfigNotFromCode() {
        assertEquals("https://mt.nonosky.com", BuildConfig.SERVICE_URL)
        assertEquals(11434, BuildConfig.OLLAMA_PORT)
        assertEquals(1, BuildConfig.PRICE_LIMPIAR); assertEquals(2, BuildConfig.PRICE_SINCRONIZAR)
        assertEquals(30, BuildConfig.LICENSE_DAYS)
        assertTrue(BuildConfig.ORIGEN_DESCARGA in setOf("github", "mt", "desconocido"))
        // No hard-coded service address in the Kotlin sources.
        val hits = listOf("src/main/kotlin", "../core/src/main/kotlin").flatMap { d -> File(d).walkTopDown().filter { it.extension == "kt" }.toList() }
            .filter { "mt.nonosky.com" in it.readText() }
        assertTrue("hard-coded service URL in $hits", hits.isEmpty())
    }

    @Test fun languageResolution() {
        assertEquals("es", Idioma.efectivo("", Locale.forLanguageTag("es-GT")))
        assertEquals("en", Idioma.efectivo("", Locale.forLanguageTag("fr-FR")))
        assertEquals("en", Idioma.efectivo("en", Locale.forLanguageTag("es-GT")))
        assertEquals("es", Idioma.localeDe("es")?.language)
        assertNull(Idioma.localeDe(""))
    }

    @Test fun byteFormatting() {
        assertEquals("999 B", bytesLegibles(999)); assertEquals("1.5 KB", bytesLegibles(1536))
        assertEquals("1.0 GB", bytesLegibles(1024L * 1024 * 1024)); assertEquals("120 MB", bytesLegibles(120L * 1024 * 1024))
    }
}
