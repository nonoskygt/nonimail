package com.nonosky.nonimailtools.core.limpiar

/** One row of the Limpiar list: a lone sender, or a domain with two or more senders under it. */
sealed interface FilaLimpiar {
    data class Suelto(val remitente: SenderScore) : FilaLimpiar
    data class Dominio(val dominio: String, val miembros: List<SenderScore>) : FilaLimpiar {
        val correos get() = miembros.sumOf { it.count }
        val bytes get() = miembros.sumOf { it.bytes }
        /** The highest noise among its senders. */
        val ruido get() = miembros.maxOf { it.score }
    }
}

/** What a domain row shows: one decision for all, or none when the senders differ. */
data class EstadoDominio(
    /** true = all deleted, false = all kept, null = mixed. */
    val elimina: Boolean?,
    /** The domain's own rule, if it has one. */
    val regla: String?,
    /** Senders whose own rule differs from the domain's. */
    val excepciones: Int,
)

/** Which senders the hardness slider selects, and what that selection amounts to. Pure logic. */
object Seleccion {

    /** Senders to tick for [hardness]: clearly noisy ones, never a protected one. Saved rules win. */
    fun automatica(senders: List<SenderScore>, hardness: Int, band: Int, reglas: Map<String, String> = emptyMap()): Set<String> =
        senders.filter { elimina(it, reglas, hardness, band) }.map { it.email }.toSet()

    /**
     * Does this sender go to the Trash? The manual protected list always keeps. Then the saved rule
     * decides (the sender's own, else its domain's: «delete» even beats a contact or a bank pattern).
     * With no rule, the noise against the hardness decides, and protected senders stay.
     */
    fun elimina(s: SenderScore, reglas: Map<String, String>, hardness: Int, band: Int): Boolean {
        if (s.reason == Reason.PROTEGIDO_USUARIO) return false
        return when (Reglas.reglaDe(reglas, s.email)) {
            Reglas.ELIMINAR -> true
            Reglas.PROTEGER -> false
            else -> !s.isProtected && Heuristica.decide(s.score, hardness, band) == Decision.LIMPIAR
        }
    }

    /** Alias of [automatica] with the name the screen reads best. */
    fun elegidos(senders: List<SenderScore>, reglas: Map<String, String>, hardness: Int, band: Int): Set<String> =
        automatica(senders, hardness, band, reglas)

    /** A selection with every protected sender removed (the user list may have grown since the scan). */
    fun sinProtegidos(selected: Set<String>, senders: List<SenderScore>): Set<String> {
        val prot = senders.filter { it.isProtected }.map { it.email }.toSet()
        return selected - prot
    }

    data class Resumen(val remitentes: Int, val correos: Int, val bytes: Long)

    fun resumen(senders: List<SenderScore>, selected: Set<String>, reglas: Map<String, String> = emptyMap()): Resumen {
        val chosen = senders.filter {
            it.email in selected && it.reason != Reason.PROTEGIDO_USUARIO &&
                (!it.isProtected || Reglas.reglaDe(reglas, it.email) == Reglas.ELIMINAR)
        }
        return Resumen(chosen.size, chosen.sumOf { it.count }, chosen.sumOf { it.bytes })
    }

    /** Where the slider puts the cut line on the 0–100 score track. */
    fun lineaDeCorte(hardness: Int, band: Int): Int = Heuristica.cutLine(hardness, band).coerceIn(0, 100)

    /** Minimum noise that marks a sender with this hardness; above 100 nothing is marked on its own. */
    fun umbral(hardness: Int, band: Int): Int = Heuristica.cutLine(hardness, band)

    /** How many senders with no rule the slider marks right now. */
    fun marcadosSinRegla(senders: List<SenderScore>, reglas: Map<String, String>, hardness: Int, band: Int): Int {
        val u = umbral(hardness, band)
        return senders.count { Reglas.reglaDe(reglas, it.email) == null && !it.isProtected && it.score >= u }
    }

    /** Groups senders by domain; a domain with two or more senders gets a row of its own. Biggest first. */
    fun filas(senders: List<SenderScore>): List<FilaLimpiar> {
        val porDominio = LinkedHashMap<String, MutableList<SenderScore>>()
        for (s in senders) porDominio.getOrPut(Reglas.dominio(s.email).ifEmpty { s.email }) { ArrayList() } += s
        return porDominio.entries
            .sortedWith(compareByDescending<Map.Entry<String, MutableList<SenderScore>>> { e -> e.value.sumOf { it.count } }.thenBy { it.key })
            .map { (d, m) -> if (m.size >= 2) FilaLimpiar.Dominio(d, m.sortedWith(compareByDescending<SenderScore> { it.count }.thenBy { it.email })) else FilaLimpiar.Suelto(m.first()) }
    }

    fun estadoDominio(f: FilaLimpiar.Dominio, reglas: Map<String, String>, hardness: Int, band: Int): EstadoDominio {
        val decisiones = f.miembros.map { elimina(it, reglas, hardness, band) }.toSet()
        val regla = reglas[Reglas.claveDominio(f.dominio)]
        val exc = f.miembros.count { m -> reglas[m.email.lowercase()]?.let { regla != null && it != regla } == true }
        return EstadoDominio(decisiones.singleOrNull(), regla, exc)
    }
}
