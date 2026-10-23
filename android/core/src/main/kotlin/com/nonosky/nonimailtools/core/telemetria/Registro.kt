package com.nonosky.nonimailtools.core.telemetria

import java.io.File
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Local rotating log (`nmt.log`, `nmt.1.log`, … up to [files]). Every line goes through
 * the scrubber first, so the file can be shared without leaking secrets.
 */
class Registro(
    private val dir: File,
    private val maxBytes: Long = 512 * 1024,
    private val files: Int = 3,
    private val own: () -> Collection<String> = { emptyList() },
    private val secrets: () -> Collection<String> = { emptyList() },
) {
    private fun file(i: Int) = File(dir, if (i == 0) "nmt.log" else "nmt.$i.log")

    @Synchronized
    fun write(level: String, tag: String, message: String, error: Throwable? = null) {
        runCatching {
            dir.mkdirs()
            val cur = file(0)
            if (cur.exists() && cur.length() > maxBytes) rotate()
            val ts = Instant.now().truncatedTo(ChronoUnit.MILLIS)
            val text = buildString {
                append(ts).append(' ').append(level).append(' ').append(tag).append(": ").append(message)
                if (error != null) append('\n').append(error.stackTraceToString().take(Telemetria.MAX_STACK))
            }
            cur.appendText(Depurador.scrub(text, own(), secrets()) + "\n", Charsets.UTF_8)
        }
    }

    fun i(tag: String, message: String) = write("I", tag, message)
    fun w(tag: String, message: String, error: Throwable? = null) = write("W", tag, message, error)
    fun e(tag: String, message: String, error: Throwable? = null) = write("E", tag, message, error)

    private fun rotate() {
        file(files - 1).delete()
        for (i in files - 2 downTo 0) {
            val f = file(i)
            if (f.exists()) f.renameTo(file(i + 1))
        }
    }

    /** All log files, oldest first, concatenated (bounded by [limit] characters from the end). */
    @Synchronized
    fun readAll(limit: Int = 400_000): String {
        val sb = StringBuilder()
        for (i in files - 1 downTo 0) {
            val f = file(i)
            if (f.exists()) sb.append(runCatching { f.readText(Charsets.UTF_8) }.getOrDefault(""))
        }
        return if (sb.length > limit) sb.substring(sb.length - limit) else sb.toString()
    }

    /** A single file with everything, for sharing. */
    @Synchronized
    fun exportTo(target: File): File {
        target.parentFile?.mkdirs()
        target.writeText(readAll(Int.MAX_VALUE), Charsets.UTF_8)
        return target
    }

    @Synchronized
    fun clear() {
        for (i in 0 until files) file(i).delete()
    }
}
