package com.nonosky.nonimailtools.core.limpiar

/** Something that answers the scoring prompt: Ollama on the LAN or a model running on the phone. */
interface IaScorer : AutoCloseable {
    /** Raw model answer (may be blank). Blocking. */
    fun generate(prompt: String): String

    override fun close() {}
}
