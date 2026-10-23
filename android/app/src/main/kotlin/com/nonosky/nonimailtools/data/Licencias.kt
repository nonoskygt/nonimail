package com.nonosky.nonimailtools.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.nonosky.nonimailtools.core.licencias.LicenseResult
import com.nonosky.nonimailtools.core.licencias.LicenseVerifier
import com.nonosky.nonimailtools.core.licencias.Licencia
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Stored license keys. Every key is verified offline (Ed25519, production public key) when it
 * is added AND each time the list is loaded, so an edited file cannot unlock anything.
 */
class RepoLicencias(private val ctx: Context, scope: CoroutineScope) {
    private val key = stringPreferencesKey("licencias_json")
    private val json = Json { ignoreUnknownKeys = true }
    private val ser = ListSerializer(Licencia.serializer())
    private val verifier = LicenseVerifier.bundled()

    private fun parse(s: String?): List<Licencia> {
        val raw = s?.let { runCatching { json.decodeFromString(ser, it) }.getOrNull() }.orEmpty()
        return raw.mapNotNull { (verifier.read(it.clave) as? LicenseResult.Ok)?.licencia }
    }

    private val inicial: List<Licencia> = runBlocking { parse(ctx.nmtStore.data.first()[key]) }
    val licencias: StateFlow<List<Licencia>> =
        ctx.nmtStore.data.map { parse(it[key]) }.stateIn(scope, SharingStarted.Eagerly, inicial)

    /** Verifies and stores a key. Same license id replaces the older entry. */
    fun agregar(clave: String, nowSec: Long = System.currentTimeMillis() / 1000): LicenseResult {
        val r = verifier.add(clave, nowSec)
        if (r is LicenseResult.Ok) {
            val lista = licencias.value.filter { it.lid != r.licencia.lid } + r.licencia
            runBlocking { ctx.nmtStore.edit { it[key] = json.encodeToString(ser, lista) } }
        }
        return r
    }

    fun borrar(lid: String) {
        val lista = licencias.value.filter { it.lid != lid }
        runBlocking { ctx.nmtStore.edit { it[key] = json.encodeToString(ser, lista) } }
    }
}
