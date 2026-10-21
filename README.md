# NoniMail Tools

**English** · [Español](README.es.md)

Desktop app (Windows and Linux) with two tools for your mailbox. No account, no sign-up.

- **Clean**: clean your inbox by sender. Everything promotional goes to Trash. Nothing is ever deleted.
- **Sync**: copy one IMAP mailbox into another without duplicates, keeping folders, flags and dates.
  The source is never touched.

Spanish and English, picked from your system language. Theme "Dulce" with light, dark and auto mode and six accent colors.

## Download

| System | Primary download | Alternative |
|---|---|---|
| Windows installer (per user) | [`/api/descargas/windows`](https://mt.nonosky.com/api/descargas/windows) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |
| Windows portable | [`/api/descargas/windows-portable`](https://mt.nonosky.com/api/descargas/windows-portable) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |
| Linux AppImage | [`/api/descargas/linux-appimage`](https://mt.nonosky.com/api/descargas/linux-appimage) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |
| Linux `.deb` | [`/api/descargas/linux-deb`](https://mt.nonosky.com/api/descargas/linux-deb) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |

Each release also carries `SHA256SUMS.txt`.

## Install

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/nonoskygt/nonimail-tools/main/scripts/install.ps1 | iex
```

**Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/nonoskygt/nonimail-tools/main/scripts/install.sh | bash
```

The Linux script puts the AppImage in `~/.local/bin`, adds a menu entry and, if you say yes, installs Ollama.
Both scripts download from `https://github.com/nonoskygt/nonimail-tools/releases/latest/download/` and check the SHA256 sum.

Or download the installer from the table above and run it. For the `.deb`: `sudo apt install ./nonimail-tools_amd64.deb`.

## First run: the setup

The setup opens the first time and again any time from **Settings → System → Run the setup**.

1. **Language and appearance**: language, mode (auto, light, dark) and accent color. Auto mode follows the clock: light from 06:00 to 17:59.
2. **Dependencies**: detects [Ollama](https://ollama.com) (local AI).
   - Not installed: **Install** downloads the official installer over HTTPS and runs it, with progress.
     Windows runs `OllamaSetup.exe` silently. Linux runs the official script with `pkexec` (a system password window);
     without a desktop it shows the exact command for a terminal.
   - Then it downloads the model with Ollama's `/api/pull`, with a progress bar.
   - **Skip (no AI)** uses heuristics only.
3. **Telemetry**: one switch, on by default. See [Privacy](#privacy-and-telemetry).
4. **First account**: pick a provider (Gmail, Yahoo, iCloud, AOL, Zoho, GMX, Yandex, Fastmail or manual), enter email and password, and test the connection.

## Clean

1. **Scan** reads the chosen range in date batches, groups by sender and scores each one (0 = important, 100 = sure junk). Nothing is changed.
2. Adjust **Strictness** and fix single senders with **Keep** / **Move**. **Protect** keeps a sender forever.
3. **Move to Trash** moves the emails of the marked senders. **Clean all** does everything in one go.

Safety rules:

- Moving means **Trash**, which you can recover. There is no permanent delete.
- No Trash folder, or a server without MOVE/UIDPLUS: nothing is moved.
- Banks, receipts, security codes and conversations you took part in are protected before any score counts.
- **Dry run** is on by default and shows what would happen.
- If you stop, Ollama goes down or you close the app, **Resume** continues from the last finished batch.
- **Unsubscribe** tries one-click (RFC 8058), then a `mailto:` message, then the link. Only `https` links to public addresses are opened.

Scoring uses your local Ollama model; no subject or body ever goes to an outside AI service. Without Ollama, heuristics decide.

## Sync

Pick **Source** and **Destination** among your accounts (optionally filter folders), then **Simulate** or **Sync**.

- Copies only what is missing, comparing by Message-ID (or a hash when there is none).
- Keeps folders, flags (read, starred) and the original dates. Sent, Trash, Drafts and Junk merge with the destination's own.
- Verifies at the end that everything in the source is in the destination.
- A second run copies nothing new.

## Licenses and prices

- **Personal accounts** (Gmail, Hotmail, Outlook, Yahoo, iCloud, Proton and other public providers) are **free**.
- **Accounts on your own domain** are commercial use. You can always **simulate** (dry run). A real run needs a key **per account and per function**, valid 30 days.

| Function | Price (30 days) |
|---|---|
| Clean | USD 1 |
| Sync | USD 2 |

The **Licenses** tab shows each account's state and a **Buy** link. Paste the key (`NMT1.…`) in **Add key**.
Keys are signed (Ed25519) and checked offline with the public key bundled in the app. Licenses bought on the web service work too.

## Connect with Google

You use **your own** Google client, so no shared app has to be audited and your credentials go nowhere else. One time, about 10 minutes:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/projectcreate).
2. Enable the **Gmail API**.
3. **OAuth consent screen**: type **External**; add the scope `https://mail.google.com/`.
4. Publish the app (status "In production"); in "Testing" Google cuts access every 7 days. It needs no verification: it is only yours.
5. **Credentials → OAuth client ID**, type **Desktop app**. Copy the **Client ID** and **Client Secret** into **Settings → Accounts → Google**.
6. Click **Connect with Google** and accept. Google warns the app is not verified: it is yours, continue under **Advanced**.

Simpler: Gmail with an [app password](https://myaccount.google.com/apppasswords) (needs 2-step verification).
Outlook/Hotmail with a password is not supported: Microsoft no longer accepts passwords over IMAP.

## Privacy and telemetry

Everything is analyzed on your computer. Passwords and tokens are stored encrypted (Electron `safeStorage`: Windows DPAPI, the system keyring on Linux).

If you leave telemetry on (the default), the app sends **only this** to `https://mt.nonosky.com`:

- On install and once a day at most: a random install id, app (`desktop`), version, system (`windows`/`linux`), system version, architecture, language, time zone, download origin (`github`, `mt` or `desconocido`), whether local AI is on and its model name.
- Events: `inicio` (the app opened) · `cuenta` (an account was added or tested: address, provider, personal or not) · `limpiar` (counts and duration of a scan or clean) · `sincronizar` (accounts and counts of a sync) · `licencia` (a valid key was added: account, function, channel, expiry) · `error` (message and stack, with passwords, tokens and addresses other than your accounts removed).

**Never sent:** passwords, tokens, full license keys, subjects, bodies or the senders of your emails. The server adds the date and a GeoIP location from the request; the app does not send its IP.
Events wait in a queue on disk and go out in batches every 5 minutes, after each operation and on exit.

**Turn it off:** the switch in the setup, **Settings → Privacy**, or the environment variable `NMT_TELEMETRY=0`. When off, the app sends nothing, not even the install ping, and the queue is emptied.

## Settings

All of this lives in `config/defaults.json` and can be overridden by your own `config.json` and by environment variables:

| Variable | What |
|---|---|
| `NMT_SERVICE_URL` | Service base URL (default `https://mt.nonosky.com`) |
| `NMT_OLLAMA_URL`, `NMT_MODEL` | Ollama address and model |
| `NMT_OLLAMA_INSTALLER_WINDOWS`, `NMT_OLLAMA_INSTALLER_LINUX` | Installer URLs |
| `NMT_GOOGLE_CLIENT_ID` | Google client id |
| `NMT_LANGUAGE` | `es` or `en` |
| `NMT_TELEMETRY` | `0` / `1` |
| `NMT_PORT`, `NMT_HOST` | Port and host of the headless server |
| `NMT_DATA_DIR` | Data folder |
| `NMT_CONFIG_FILE` | Extra JSON file with overrides |

Data folder: `%APPDATA%\NoniMail Tools` on Windows, `~/.config/nonimail-tools` on Linux. It holds `config.json`, `secrets.json`, `licenses.json`, `senders.json`, `progress.json`, the telemetry queue and `logs/`.
The log (`logs/nonimail-tools.log`) rotates by size; errors also go to the log. **Settings → System → Open logs folder** opens it.

## Run without a window

```bash
npm install
npm start        # prints http://127.0.0.1:8765/
```

## Build from source

Requires Node.js 20+.

```bash
git clone https://github.com/nonoskygt/nonimail-tools.git
cd nonimail-tools
npm install
npm test                # tests with in-memory IMAP/SMTP servers; no real mailbox is touched
npm run desktop         # run the Electron app
npm run dist:linux      # AppImage + deb in dist/
npm run dist:win        # NSIS installer + portable in dist/ (best on Windows)
npm run icons           # regenerate the icons in build/
```

A `v*` tag builds the installers on GitHub Actions and publishes them with `SHA256SUMS.txt` and stable-name copies
(`NoniMail-Tools-Setup.exe`, `NoniMail-Tools-Portable.exe`, `NoniMail-Tools.AppImage`, `nonimail-tools_amd64.deb`).

## License

[MIT](LICENSE) © Danilo Estuardo Gonzalez Rizzo. Dependencies and the Figtree font: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
