package com.nonosky.nonimailtools.core

/** How a long operation talks back: log lines, progress snapshots and the cancel flag. */
interface Reporter<P> {
    fun log(line: String) {}
    fun progress(p: P) {}
    fun cancelled(): Boolean = false
}
