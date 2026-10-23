package com.nonosky.nonimailtools.ia

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig
import com.nonosky.nonimailtools.core.ia.ModeloIa
import com.nonosky.nonimailtools.core.limpiar.IaScorer
import java.io.File

/** Where the model files live: app-private storage, removed with the app. */
object RutasIa {
    fun dir(ctx: Context): File = File(ctx.filesDir, "ia")
    fun archivo(ctx: Context, m: ModeloIa): File = File(dir(ctx), m.archivo)
    fun parcial(ctx: Context, m: ModeloIa): File = File(dir(ctx), m.archivo + ".part")
}

/**
 * Scores with a model running on the phone (LiteRT-LM). It uses the GPU when the phone has one
 * that LiteRT can drive, and every CPU core otherwise. Loading blocks for several seconds, so
 * build it on a background thread. Close it when done to free the RAM.
 */
class PuntuadorLocal(ctx: Context, private val modelo: ModeloIa) : IaScorer {
    /** "GPU" or "CPU": what the model actually runs on, for the AI terminal. */
    val motor: String
    private val engine: Engine

    init {
        val ruta = RutasIa.archivo(ctx, modelo).absolutePath
        fun crear(b: Backend) = Engine(EngineConfig(modelPath = ruta, backend = b, cacheDir = ctx.cacheDir.path)).also { it.initialize() }
        val gpu = runCatching { crear(Backend.GPU()) }
        if (gpu.isSuccess) {
            engine = gpu.getOrThrow(); motor = "GPU"
        } else {
            engine = crear(Backend.CPU(threadCount = Runtime.getRuntime().availableProcessors()))
            motor = "CPU"
        }
    }

    private val config = ConversationConfig(
        samplerConfig = SamplerConfig(topK = 10, topP = 0.95, temperature = 0.1),
    )

    /** One fresh conversation per sender, so the answers do not influence each other. */
    override fun generate(prompt: String): String {
        val texto = if (modelo.sinPensar) "$prompt\n/no_think" else prompt
        engine.createConversation(config).use { c -> return c.sendMessage(texto).toString().trim() }
    }

    /** Short question used right after loading, so the first real scan is not the cold one. */
    fun calentar() {
        engine.createConversation(config).use { c -> c.sendMessage("1+1=").toString() }
    }

    override fun close() = engine.close()
}
