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
 * Scores with a model running on the phone (LiteRT-LM, CPU). Loading blocks for several
 * seconds, so build it on a background thread. Close it when done to free the RAM.
 */
class PuntuadorLocal(ctx: Context, private val modelo: ModeloIa) : IaScorer {
    private val engine: Engine = Engine(
        EngineConfig(
            modelPath = RutasIa.archivo(ctx, modelo).absolutePath,
            backend = Backend.CPU(),
            cacheDir = ctx.cacheDir.path,
        ),
    ).also { it.initialize() }

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
