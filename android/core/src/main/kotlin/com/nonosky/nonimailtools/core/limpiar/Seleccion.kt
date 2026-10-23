package com.nonosky.nonimailtools.core.limpiar

/** Which senders the hardness slider selects, and what that selection amounts to. Pure logic. */
object Seleccion {

    /** Senders to tick for [hardness]: clearly noisy ones, never a protected one. */
    fun automatica(senders: List<SenderScore>, hardness: Int, band: Int): Set<String> =
        senders.filter { !it.isProtected && Heuristica.decide(it.score, hardness, band) == Decision.LIMPIAR }
            .map { it.email }.toSet()

    /** A selection with every protected sender removed (the user list may have grown since the scan). */
    fun sinProtegidos(selected: Set<String>, senders: List<SenderScore>): Set<String> {
        val prot = senders.filter { it.isProtected }.map { it.email }.toSet()
        return selected - prot
    }

    data class Resumen(val remitentes: Int, val correos: Int, val bytes: Long)

    fun resumen(senders: List<SenderScore>, selected: Set<String>): Resumen {
        val chosen = senders.filter { it.email in selected && !it.isProtected }
        return Resumen(chosen.size, chosen.sumOf { it.count }, chosen.sumOf { it.bytes })
    }

    /** Where the slider puts the cut line on the 0–100 score track. */
    fun lineaDeCorte(hardness: Int, band: Int): Int = Heuristica.cutLine(hardness, band).coerceIn(0, 100)
}
