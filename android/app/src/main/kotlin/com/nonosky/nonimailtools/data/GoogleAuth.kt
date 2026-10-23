package com.nonosky.nonimailtools.data

import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import com.nonosky.nonimailtools.BuildConfig
import com.nonosky.nonimailtools.core.mail.GoogleOauth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

/** The person has to sign in with Google again (consent revoked, or Google needs to show a screen). */
class GoogleReautenticar(message: String = "") : Exception(message)

/**
 * Google Identity Services [AuthorizationResult] for the Gmail scope. Nothing is stored: the
 * grant lives in Google Play services and `authorize()` returns a fresh access token silently.
 * Only signed release builds match the OAuth client (package + signing SHA-1).
 */
object GoogleAuth {
    /** Last token handed out; kept in memory only so logs and telemetry can scrub it. */
    @Volatile var ultimoToken: String? = null
        private set

    /** [email]: the Google account to authorize (needed when the phone has several); null lets Google ask. */
    private fun peticion(email: String? = null) = AuthorizationRequest.builder()
        .setRequestedScopes(listOf(Scope(GoogleOauth.SCOPE)))
        .apply { if (!email.isNullOrBlank()) setAccount(android.accounts.Account(email, "com.google")) }
        .build()

    /** Asks for access. The result may carry a PendingIntent ([AuthorizationResult.hasResolution]) the UI must launch. */
    suspend fun autorizar(ctx: Context): AuthorizationResult = withContext(Dispatchers.IO) {
        Tasks.await(Identity.getAuthorizationClient(ctx.applicationContext).authorize(peticion()), 60, TimeUnit.SECONDS)
    }

    /** Result of the consent screen the UI launched. Throws [ApiException] if it failed. */
    fun resultadoDeIntent(ctx: Context, data: Intent?): AuthorizationResult =
        Identity.getAuthorizationClient(ctx.applicationContext).getAuthorizationResultFromIntent(data)

    fun recordar(r: AuthorizationResult): String? = r.accessToken?.also { ultimoToken = it }

    /**
     * Fresh access token for [email]'s Google account without any UI, for scans and syncs (also in the service / background).
     * Blocking: never on the main thread. Throws [GoogleReautenticar] if a screen would be needed.
     */
    fun tokenSilencioso(ctx: Context, email: String): String {
        val r = try {
            Tasks.await(Identity.getAuthorizationClient(ctx.applicationContext).authorize(peticion(email)), 60, TimeUnit.SECONDS)
        } catch (e: ExecutionException) {
            val api = e.cause as? ApiException
            if (api?.statusCode == CommonStatusCodes.NETWORK_ERROR) throw IOException("No network for Google sign-in", e)
            throw GoogleReautenticar("Google authorization failed (${api?.statusCode ?: e.cause?.javaClass?.simpleName})")
        } catch (e: java.util.concurrent.TimeoutException) {
            throw IOException("Google sign-in timed out", e)
        }
        if (r.hasResolution()) throw GoogleReautenticar("Google needs the person to sign in again")
        return recordar(r) ?: throw GoogleReautenticar("Google returned no access token")
    }

    /** E-mail of the signed-in account from the Gmail profile; null if the call fails. Blocking. */
    fun correoDelPerfil(token: String): String? = runCatching {
        val c = URL(GoogleOauth.PROFILE_URL).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = BuildConfig.HTTP_TIMEOUT_MS
            c.readTimeout = BuildConfig.HTTP_TIMEOUT_MS
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Accept", "application/json")
            if (c.responseCode != 200) return@runCatching null
            GoogleOauth.correoDelPerfil(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) })
        } finally {
            c.disconnect()
        }
    }.getOrNull()
}
