# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-10-22

### Added
- **Automatic updates.** The app checks `releases/latest` on GitHub (owner/repo from `gradle.properties`, exposed as
  `BuildConfig`) at start, at most every 6 hours, plus a WorkManager job every 12 hours that needs network. The tag is
  compared with `versionName` using semver.
- When a newer version exists, the APK `NoniMail-Tools.apk` is downloaded in the background (WorkManager, resumable with
  HTTP Range) and verified against `SHA256SUMS.txt` of the same release and against the signing certificate of the
  installed app. A file that fails either check is deleted and logged.
- **Install** with a PackageInstaller session (`REQUEST_INSTALL_PACKAGES`). A notification and an in-app banner say
  «Version X ready · Install»; one tap opens the system confirmation. With the app in the background, Android 12+ may
  update without confirmation (`USER_ACTION_NOT_REQUIRED`, update ownership); otherwise it falls back to the
  confirmation. Without the «install unknown apps» permission, one line opens that screen.
- Nothing is installed while a sync or clean is running; the update waits until it ends.
- Settings: «Update automatically» switch (on by default), current version and «Check for updates» with a one-line result.
- Failures go to the log and to telemetry as an `error` event with context `actualizacion`; the person is not bothered.

### Changed
- Version 1.2.0 (versionCode 10200).

## [1.1.0] - 2026-10-22

### Added
- **On-device AI with model tiers** (Basic, Medium, Large) running on the phone with LiteRT-LM 0.18.1 (CPU). The app
  reads the RAM and free storage and recommends the largest tier that fits; a badge marks it.
- **One progress bar** for the whole setup: "Verifying…", "Downloading model… 37% (210 / 555 MB)",
  "Setting up model…" (load plus a warm-up question) and "Ready". Download with WorkManager as a foreground job,
  resumable (HTTP Range), checked by size and SHA-256. Errors take one line with Retry.
- **Cancel** at every phase: stops the WorkManager job, deletes the partial file and shows "Canceled" with Retry and
  Skip. The app stays usable during the download.
- "Server on my network" (Ollama) is kept as the fourth choice. Local and Ollama scoring share one interface; the
  heuristics remain the fallback.
- Model URLs, sizes, checksums and the recommendation rule live in `defaults.json` (`localAi`), not in code.

### Changed
- Version 1.1.0 (versionCode 10100).

## [1.0.0] - 2026-10-21

First public release.

### Added
- **Limpiar** (clean): read-only INBOX scan (last N messages or N days), senders grouped and scored with the shared
  heuristics, optional local AI scoring through an Ollama server on the LAN, hardness slider, protections
  (keep-override regex, protected senders, people you write to), move to Trash only (refuses without a Trash
  folder), dry run on by default.
- **Sincronizar** (sync): IMAP to IMAP copy of only the missing messages (Message-ID identity with hash fallback),
  keeps flags and internal date, maps special folders, include/exclude folders, simulation, final verification,
  live progress for folders, messages and bytes.
- Foreground service (`dataSync`) with progress notification and Cancel for long operations.
- License gate: personal (public-domain) accounts are free; commercial accounts can always simulate and need a
  30-day key per account and function for real runs. Keys (`NMT1.…`) are verified offline with Ed25519.
- First-run configurator (language and look, permissions, optional AI, telemetry, first account) that can be run
  again from Settings.
- Settings: accounts, language (ES/EN), appearance, AI address and model, telemetry, service address, logs
  (view and share), About.
- «Dulce» theme: six accents, light, dark and auto (by the clock), Figtree bundled, adaptive launcher icon.
- Telemetry contract v1 (opt-out switch, persistent queue, WorkManager, scrubbed errors) and a rotating local log.
- Passwords encrypted with the Android Keystore; never logged.
- Release workflow: signed APK and AAB attached to a GitHub Release with SHA-256 sums.
