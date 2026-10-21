# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
