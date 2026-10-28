# NoniMail Tools for Android

[Español](README.es.md)

Two mail tools in one open-source Android app. Everything runs on the phone, straight against your IMAP server.

- **Clean (Limpiar)**: scans your INBOX read-only, groups it by sender, scores each sender and moves the noise to the Trash.
- **Sync (Sincronizar)**: copies one IMAP mailbox into another, only what is missing, keeping flags and dates.

<p>
<img src="docs/screenshots/limpiar-claro.png" width="220" alt="Clean">
<img src="docs/screenshots/sincronizar-claro.png" width="220" alt="Sync">
<img src="docs/screenshots/ajustes-oscuro.png" width="220" alt="Settings, dark">
</p>

## Install

1. Download the APK: **<https://mt.nonosky.com/api/descargas/android>**
   (or from [GitHub Releases](https://github.com/nonoskygt/nonimail-tools-android/releases): `NoniMail-Tools.apk` always points to the latest version).
2. Open the file. If Android asks, allow installing from this source (Settings → Apps → Special access → Install unknown apps → your browser or file manager).
3. Optional: check the download against `SHA256SUMS.txt` from the release.

Requires Android 8.0 (API 26) or newer.

**Updates:** the app checks GitHub Releases at start and every 12 hours, downloads and verifies the new APK (SHA-256 and same signing certificate) and asks you to tap «Install»; Settings → Updates turns it off.

## First run

A short configurator runs once and can be repeated from Settings:

1. Language (Spanish, English, or the device's) and appearance (mode and accent color).
2. Permissions: notifications (Android 13+) and battery optimization exemption, so long tasks are not cut.
3. Optional AI: a model that runs on the phone itself (Basic, Medium or Large; the app recommends the largest your RAM and storage allow) or an Ollama server on your LAN. One progress bar covers verifying, downloading (resumable, with Cancel) and setting up the model; you can skip it.
4. Telemetry switch (see [Privacy](#privacy--telemetry)).
5. Your first account: Gmail, Outlook/Hotmail, Yahoo, iCloud or custom IMAP, with a connection test.

**Gmail: tap «Iniciar sesión con Google» (one-tap sign-in, no password stored; works in signed release builds only, and Google shows its «unverified app» screen).** The app-password route below remains as a fallback: it needs an app password with IMAP enabled. Turn on 2-step verification, create an app password and use it instead of your normal password. Outlook, Yahoo and iCloud also use app passwords.

## Clean

- Scan the last N messages or the last N days. The scan only reads; nothing is marked as read.
- Senders are scored 0-100 with the shared heuristics (promotions, bulk headers, automatic senders). With AI set up (on the phone or Ollama), it can score them too.
- The **hardness** slider (0-100, «Gentle» to «Strict») draws a cut line over all scores and says how many senders without a rule it marks.
- **Keep** and **Delete** on a sender save a rule on the phone, and a rule beats the hardness. With 2 or more senders of one domain a domain row appears (summed mails, highest noise): its Keep/Delete applies to all of them, and choosing otherwise on one sender makes an exception (counted as «Exceptions»). «Remove rule» hands the decision back to the hardness.
- **Collective reputation**: once a day a domain reputation is downloaded (Ed25519-signed, checked with the public key bundled in the app); it is an engine layer after protections and rules and before the AI. «Share which senders you delete» (Settings) sends only the domain of bulk senders, never subjects, content or your account.
- **Protections always win**: banks, invoices, verification codes (a keep-override regex you can edit), your own protected list, and people you write to. Protected senders are never moved.
- Mail goes to the Trash only (found by the `\Trash` special-use flag or by name). If the mailbox has no Trash folder, the run is refused.
- **Simulate only** is on by default.

**On-device AI.** Three tiers (Basic, Medium, Large) run on the phone with [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM); the app reads your RAM and free storage and recommends the largest that fits (RAM of at least 2x the model plus 2 GB, storage of at least the model plus 1 GB). The models come from the ungated `litert-community` repositories on Hugging Face, so no login is needed; URLs, sizes and SHA-256 sums are in the `localAi` block of `core/src/main/resources/com/nonosky/nonimailtools/core/defaults.json`, and the file is checked before it is loaded. "Server on my network" (Ollama) stays as a fourth choice, and the heuristics are always the fallback.

## Sync

- Choose source and destination, optionally include or exclude folders, simulate first, then run.
- Only missing messages are copied. Identity is the Message-ID; without one, a hash of date, from, to, subject and size. Real duplicates are respected.
- Flags and internal date are kept, special folders (Sent, Trash, Drafts, Junk, Archive) are mapped, Gmail's virtual folders are skipped.
- Progress shows folders, messages and bytes. At the end the app verifies that everything in the source is in the destination.
- The source is never modified.

Long operations run in a foreground service with a notification and a Cancel button.

## Plans and prices

- **Free, forever:** personal accounts (public providers such as Gmail, Outlook, Yahoo, iCloud), cleaned and synced from the app, with the AI on the phone or with rules.
- **Subscription** (per e-mail account, monthly or yearly; Settings → Plans shows the table): business accounts (your own domain), Nonosky AI on the server, permanent tasks («Keep running on the server»: cleaning every N days and non-stop syncing, even with the phone off), the web tool and preferences in the cloud.
- Without the subscription, a business account can always scan and simulate. «Subscribe» opens the web page; signing in brings the subscription by itself as a signed proof `NMTS1.…` (Ed25519, checked offline, renewed every 12 h). License keys `NMT1.…` already sold keep working until they expire.

## Privacy / Telemetry

The switch «Send usage and errors to Nonosky» is **on by default** and you can turn it off in the configurator or in Settings. With it off, the app sends nothing (not even the installation record).

What is sent (contract v1, `app: "android"`):

- **Installation** (once a day at most): install id (random UUID), app version, OS and version, CPU architecture, language, time zone, download origin (`github`, `mt` or `desconocido`), whether local AI is configured and its model name.
- **Events**: `inicio` (app opened); `cuenta` (address added, provider, personal or not); `limpiar` (account, scan or run, dry run, messages reviewed, senders, messages moved, seconds, result, licensed); `sincronizar` (source and destination addresses, dry run, folders, messages, copied, bytes, seconds, result, licensed); `licencia` (account, function, channel, expiry); `error` (message, stack trace up to 4000 characters, context, account).
- The server adds your IP, country, region, city and date.

**Never sent**: passwords, tokens, full license keys, subjects, bodies or senders of your mail. In errors, e-mail addresses other than your own accounts and anything that looks like a password or token are masked.

Events are queued on the device and sent in batches (every 5 minutes while the app is open, after each operation, when it closes, and by WorkManager). A local rotating log is always kept on the phone; use Settings → View logs / Share logs.

## Preferences and sync

Rules are saved on the phone. To have them in other apps, Settings → «Preferences and sync» creates the mt.nonosky.com account right there (e-mail + password, with a code for a new e-mail, or «Continue with Google», which asks only for `openid email`). Signed in, rules merge by date (the newest wins) through `GET/PUT /api/reglas-remitentes`; without a session or without that endpoint everything stays local. The contract is in `SERVICIO.md` at the repository root.

## Build

Requirements: JDK 17 and the Android SDK (platform 37).

```bash
./gradlew :core:test :app:testDebugUnitTest assembleDebug
```

- `core`: plain Kotlin/JVM (IMAP, scoring, sync, licenses, telemetry), tested without a device, including real IMAP conversations against GreenMail.
- `app`: Jetpack Compose, Material 3 mapped to the «Dulce» theme, Figtree bundled (OFL, see `licenses/`).
- Defaults (service URL, Ollama model and port, timeouts, prices) live in `gradle.properties` and flow into `BuildConfig`.
- Screenshots: `./gradlew :app:testDebugUnitTest -Pnmt.shotsDir=/some/dir` (Robolectric + Roborazzi).

### Signing

Release builds read `NMT_KEYSTORE_FILE`, `NMT_KEYSTORE_PASSWORD`, `NMT_KEY_ALIAS` and `NMT_KEY_PASSWORD` from the environment and fall back to the debug key.

```bash
keytool -genkeypair -keystore release.jks -alias nonimail-tools -keyalg RSA -keysize 4096 -validity 10950
```

Never commit the keystore. In GitHub, create the secrets `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Pushing a tag `vX.Y.Z` builds the signed APK and AAB (`origen_descarga=github`) and attaches them to a Release with SHA-256 sums, also as `NoniMail-Tools.apk`.

## License

MIT, © Danilo Estuardo Gonzalez Rizzo. See [LICENSE](LICENSE). Figtree is under the SIL Open Font License.
