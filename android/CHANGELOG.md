# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.6.0] - 2026-10-23

### Changed
- **Más rápido.** El modelo corre en la GPU del teléfono cuando LiteRT puede usarla, y si no, en todos los núcleos de la CPU. La lectura del buzón trae 500 correos por tanda y la IA lee un texto más corto por remitente.
- **Medidores.** Arriba de las terminales: RAM del teléfono y de la app, CPU de la app (100% = un núcleo) y dónde corre la IA (GPU o CPU).
- **Casilla en todos los remitentes.** «Usted les escribe» y los protegidos se pueden marcar para eliminar; solo «Nunca eliminar» bloquea la fila.
- **Darse de baja.** Cada remitente con enlace de baja tiene su casilla; también «Marcar baja en todos los que se eliminen». La baja se hace al ejecutar, después de eliminar: one-click, correo (mailto, por SMTP con la misma cuenta) o enlace. En simulación no se envía nada.
- **Lo eliminado sale de la lista.** Tras eliminar de verdad, los remitentes borrados desaparecen de la lista.
- **Medidor visible.** El uso de RAM, CPU y dónde corre la IA ya se muestra encima de las terminales de Limpiar y Sincronizar mientras corre una tarea (la carga de la GPU no se puede leer en Android: se muestra si el modelo corre en GPU o CPU).
- **Las decisiones se guardan.** Conservar y Eliminar de cada remitente guardan una regla en el teléfono (reemplazan a «Nunca eliminar»; las direcciones que estaban en su lista de protegidos pasan a ser reglas «Conservar»). La regla del remitente manda; si no tiene, vale la de su dominio. «Eliminar» sobre un remitente protegido por contacto o por el patrón de bancos lo elimina; su lista de protegidos escrita a mano sigue ganando siempre.
- **Agrupado por dominio.** Con 2 o más remitentes del mismo dominio (`empresa.com`, `empresa.com.gt`) sale una fila de dominio con la suma de correos, el ruido más alto y los remitentes plegables. Conservar/Eliminar en el dominio borra las excepciones; elegir distinto en un remitente crea una («Excepciones: N»). «Quitar regla» en cada fila.
- **Dureza explícita.** Deslizador 0–100 de «Suave» a «Estricta», con «Se marcan para eliminar los remitentes con ruido ≥ N. Ahora: M remitentes sin regla.» Los remitentes con regla no pasan por la IA.
- **Preferencias y sincronización.** Ajustes explica que las reglas se guardan en el teléfono y deja crear la cuenta ahí mismo: correo válido y contraseña (código de 6 dígitos si el correo es nuevo) o «Continuar con Google» (solo `openid email`). Con sesión, las reglas se fusionan por fecha con `GET/PUT /api/reglas-remitentes` (al cambiar una regla, al abrir la app y al iniciar sesión); sin sesión o sin ese servicio quedan en local sin error. Contrato en `SERVICIO.md`.
- **Filtro colectivo.** Reputación de dominios bajada una vez al día, con firma Ed25519 verificada con la clave pública de la app, como capa del motor después de protecciones y reglas y antes de la IA («Reputación colectiva»). «Compartir qué remitentes elimina» (Ajustes, encendido de fábrica) envía solo el dominio de remitentes masivos al ejecutar de verdad.

## [1.5.0] - 2026-10-23

### Changed
- **Sin configurador.** La app abre directo en Limpiar. Si no hay cuenta, el formulario (con «Iniciar sesión con Google») aparece ahí mismo. Idioma, apariencia, IA, permisos, telemetría y actualizaciones están en Ajustes.
- **Sin pestaña Licencias.** Las cuentas personales no muestran nada de licencias ni precios. Con una cuenta de dominio propio, Ajustes muestra «Licencias» con «Iniciar sesión» (la misma cuenta de mt.nonosky.com: trae sola las licencias compradas) y «Comprar licencia»; pegar una clave queda como opción plegada.
- **Limpiar solo por días.** Se quitó «Últimos mensajes».
- **Terminales en vivo.** Limpiar muestra «CPU · lectura + heurística» y «IA · modelo» (qué responde el modelo y el puntaje); Sincronizar muestra «Red · sincronización» (carpeta, copiados, KB y velocidad).
- **Fases y textos como en escritorio.** Escaneando N / M correos, Agrupando por remitente, Clasificando N / M remitentes, Eliminando. El botón dice **Eliminar** (va a la papelera). Cada remitente tiene **Nunca eliminar** (guarda la regla; la fila muestra «Siempre se conserva» y «Quitar regla»).

## [1.4.1] - 2026-10-23

### Changed
- **Busca la versión nueva cada vez que abre la app.** Antes esperaba al menos 6 horas desde la última búsqueda, y una versión recién publicada tardaba en llegar. Sigue buscando sola cada 12 horas en segundo plano.

## [1.4.0] - 2026-10-23

### Added
- **Iniciar sesión con Google, en un toque.** En el paso «Su primera cuenta» y al agregar una cuenta Gmail, el botón principal «Iniciar sesión con Google» reemplaza la contraseña de aplicación. Usa Google Identity Services (`AuthorizationClient`) con el permiso `https://mail.google.com/`; la app aún no está verificada por Google, así que se verá su aviso de «app no verificada».
- La cuenta queda guardada como Gmail con acceso `oauth`: no se guarda ninguna contraseña ni token. Antes de cada análisis, limpieza o sincronización la app pide a Google un token nuevo (silencioso si ya se autorizó) y entra por IMAP con XOAUTH2.
- Si Google necesita que la persona vuelva a autorizar, la operación termina con «Vuelva a iniciar sesión con Google» en lugar de fallar.

### Changed
- La contraseña de aplicación de Gmail sigue disponible, plegada bajo «Usar contraseña de aplicación».
- Solo funcionan las compilaciones firmadas de GitHub (la llave de depuración no coincide con el cliente OAuth).
- Version 1.4.0 (versionCode 10400).

## [1.3.0] - 2026-10-23

### Changed
- **Un solo modelo en el teléfono: Gemma 4 E2B.** Es el único que acertó los 24 correos de nuestro banco de pruebas (alertas de seguridad, pedidos, facturas, trámites, correos personales y promociones). Qwen3 0.6B y Gemma 4 E4B se retiraron; sus archivos se borran al preparar el modelo nuevo. La tarjeta muestra el tamaño y la RAM que necesita.
- **La IA clasifica por categoría.** El modelo responde una palabra (PERSONAL, TRANSACCION, SEGURIDAD, PROMOCION, BOLETIN, SOCIAL u OTRO) y la app la convierte en puntaje (`llm.categoryScores`), igual que la app de escritorio 1.3.5.

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
