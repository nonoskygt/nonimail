package com.nonosky.nonimailtools.core.mail

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Pieces of the Google sign-in that need no Android classes, so they can be unit-tested on a JVM. */
object GoogleOauth {
    /** Full Gmail access over IMAP. */
    const val SCOPE = "https://mail.google.com/"

    /** Gmail API call that returns the signed-in address (`emailAddress`). */
    const val PROFILE_URL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"

    private val json = Json { ignoreUnknownKeys = true }

    /** The `emailAddress` of a Gmail profile response, lower case; null if missing or not JSON. */
    fun correoDelPerfil(body: String): String? {
        val obj = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
        return emailDe(obj)
    }

    private fun emailDe(obj: JsonObject): String? =
        obj["emailAddress"]?.jsonPrimitive?.contentOrNull?.trim()?.lowercase()?.takeIf { '@' in it }
}
