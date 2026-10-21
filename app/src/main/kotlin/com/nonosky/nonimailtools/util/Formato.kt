package com.nonosky.nonimailtools.util

import java.util.Locale

/** 1536 -> "1.5 KB". Binary units, one decimal under 100. */
fun bytesLegibles(b: Long): String {
    if (b < 1024) return "$b B"
    val u = arrayOf("KB", "MB", "GB", "TB")
    var v = b / 1024.0
    var i = 0
    while (v >= 1024 && i < u.size - 1) { v /= 1024; i++ }
    return String.format(Locale.ROOT, if (v >= 100) "%.0f %s" else "%.1f %s", v, u[i])
}
