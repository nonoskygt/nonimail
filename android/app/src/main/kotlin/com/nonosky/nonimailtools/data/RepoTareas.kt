package com.nonosky.nonimailtools.data

import com.nonosky.nonimailtools.core.mail.Security
import com.nonosky.nonimailtools.core.servicio.CredencialTarea
import com.nonosky.nonimailtools.core.servicio.ResultadoTareas
import com.nonosky.nonimailtools.core.servicio.Tarea
import com.nonosky.nonimailtools.core.servicio.TareasApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * «Mantener funcionando en el servidor»: the permanent tasks of the web account (`/api/tareas`), cached for
 * the screens. The password goes to the server only when the person agreed in the consent dialog; a Google
 * sign-in account cannot be used there, so the dialog asks for an app password instead. Blocking calls.
 */
class RepoTareas(private val api: () -> TareasApi) {
    private val _lista = MutableStateFlow<List<Tarea>>(emptyList())
    val lista: StateFlow<List<Tarea>> = _lista.asStateFlow()

    fun cargar(): ResultadoTareas<List<Tarea>> = api().listar().also { if (it is ResultadoTareas.Ok) _lista.value = it.valor }

    /** Login for the server: the stored password, or [clave] (app password) for a Google sign-in account. Null when there is none. */
    fun credencial(c: Cuenta, clave: String?): CredencialTarea? {
        val pw = clave?.takeIf { it.isNotBlank() } ?: if (c.esOauth) null else Secretos.descifrar(c.clave)
        if (pw.isNullOrEmpty()) return null
        return CredencialTarea(c.email, c.host, c.port, c.user.ifBlank { c.email }, pw, Security.of(c.security) == Security.SSL)
    }

    fun crearLimpiar(cuenta: CredencialTarea, cadaDias: Int, dureza: Int): ResultadoTareas<Tarea> =
        api().crearLimpiar(cuenta, cadaDias, dureza).also { poner(it) }

    fun crearSincronizar(cuenta: CredencialTarea, destino: CredencialTarea): ResultadoTareas<Tarea> =
        api().crearSincronizar(cuenta, destino).also { poner(it) }

    fun cambiar(id: String, cadaDias: Int? = null, dureza: Int? = null): ResultadoTareas<Tarea> =
        api().cambiar(id, cadaDias = cadaDias, dureza = dureza).also { poner(it) }

    fun borrar(id: String): ResultadoTareas<Unit> =
        api().borrar(id).also { if (it is ResultadoTareas.Ok || (it is ResultadoTareas.Error && it.status == 404)) _lista.value = _lista.value.filter { t -> t.id != id } }

    private fun poner(r: ResultadoTareas<Tarea>) {
        if (r is ResultadoTareas.Ok) _lista.value = _lista.value.filter { it.id != r.valor.id } + r.valor
    }
}
