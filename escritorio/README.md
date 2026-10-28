# NoniMail Tools

**English** · [Español](README.es.md)

Desktop app (Windows and Linux) with two tools for your mailbox. No account and no sign-up for personal mailboxes; everything fits in one window, with no page scrolling.

- **Accounts**: set up your mailboxes. **Sync** and **Clean** unlock once the first tested account is saved.
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

The installer and the AppImage update themselves (Settings → System → Updates); the portable and `.deb` builds only show a "Download" notice. New versions are looked up at `https://mt.nonosky.com/actualizaciones/` and, if it does not answer, on GitHub.

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
4. **First account**: pick a provider (Gmail with **Sign in with Google**, Yahoo, iCloud, AOL, Zoho, GMX, Yandex, Fastmail or manual), enter email and password, and test the connection. It ends on the **Accounts** tab.

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

Scoring uses your local Ollama model («This computer's AI»): no subject or body leaves the computer. With «Nonosky AI (subscription)» only the sender and up to 5 subjects per sender go to our server, never the body. With «No AI», or when the AI does not answer, heuristics decide without stopping the clean.

**Keep running on the server** (subscription): in Clean and in Sync, a switch creates the task on the server (clean every 1, 3, 7, 14 or 30 days with the current strictness, never below 30; sync every 15 min). It asks for your consent to store the password encrypted; accounts using «Sign in with Google» need an app password. What is deleted goes to the Trash.

## Sync

Pick **Source** and **Destination** among your accounts (optionally filter folders), then **Simulate** or **Sync**.

- Copies only what is missing, comparing by Message-ID (or a hash when there is none).
- Keeps folders, flags (read, starred) and the original dates. Sent, Trash, Drafts and Junk merge with the destination's own.
- Verifies at the end that everything in the source is in the destination.
- A second run copies nothing new.

## Plans and prices

- **Free, forever:** **personal accounts** (Gmail, Hotmail, Outlook, Yahoo, iCloud, Proton and other public providers), with your computer's AI or no AI (rules).
- **Subscription** (per email account, monthly or yearly; each account includes cleaning and syncing): accounts on **your own domain**, **Nonosky AI** on our server, **permanent tasks** on the server (clean every N days and sync non-stop, even when your computer is off), the web tool and preferences in the cloud.

| Accounts | Monthly | Yearly |
|---|---|---|
| 1 to 4 | USD 3 | USD 29 |
| 5 to 19 | USD 2.50 | USD 24 |
| 20 or more | USD 2 | USD 19 |

Settings → **Plans** shows your plan, this table (the service's one when online) and the **Subscribe** button, which opens the web. Without a subscription, an own-domain account can always **scan and simulate**.
The app signs in with the web account (Settings → Rules, or «Sign in» on an own-domain account) and fetches the subscription proof by itself (`NMTS1.…`, signed with Ed25519): it is checked offline and renewed at start and every 12 h. If the subscription has free seats, an own-domain account takes one by itself. `NMT1.` licenses already sold keep working until they expire.
Sender rules are kept in the cloud only if you bought the service at least once; otherwise they stay on the computer.

## Connect with Google

In **Accounts**, with the Gmail provider, click **Sign in with Google**: the browser opens, accept the mail permission and the account is saved and tested, with no other fields. Only `https://mail.google.com/` plus `openid email` is requested; the refresh token is stored encrypted.

If this build ships without a Google client, the button says so in one line and the Gmail [app password](https://myaccount.google.com/apppasswords) stays available (needs 2-step verification).
Outlook/Hotmail with a password is not supported: Microsoft no longer accepts passwords over IMAP.

If you prefer your own Google client, put it in **Settings → System → Your own Google client** (type **Desktop app**).

## Privacy and telemetry

Everything is analyzed on your computer. Passwords and tokens are stored encrypted (Electron `safeStorage`: Windows DPAPI, the system keyring on Linux).

If you leave telemetry on (the default), the app sends **only this** to `https://mt.nonosky.com`:

- On install and once a day at most: a random install id, app (`desktop`), version, system (`windows`/`linux`), system version, architecture, language, time zone, download origin (`github`, `mt` or `desconocido`), whether local AI is on and its model name.
- Events: `inicio` (the app opened) · `cuenta` (an account was added or tested: address, provider, personal or not) · `limpiar` (counts and duration of a scan or clean) · `sincronizar` (accounts and counts of a sync) · `licencia` (a valid key was added: account, function, channel, expiry) · `error` (message and stack, with passwords, tokens and addresses other than your accounts removed).

**Never sent:** passwords, tokens, full license keys, subjects, bodies or the senders of your emails. The server adds the date and a GeoIP location from the request; the app does not send its IP.
Events wait in a queue on disk and go out in batches every 5 minutes, after each operation and on exit.

**Turn it off:** the switch in the setup, **Settings → System**, or the environment variable `NMT_TELEMETRY=0`. When off, the app sends nothing, not even the install ping, and the queue is emptied.

### Collective filter

The filter is on by default. When you **execute** a clean (never on a scan or a simulation), the app sends to `https://mt.nonosky.com` one decision per **bulk** sender (it has `List-Unsubscribe` or a noreply/marketing-style address) on a custom domain: **only the domain** (for example `shop.com`), the signals the filter saw (unsubscribe, noreply, names of the matched rules, AI score and mail count), your decision (`eliminar`, `conservar`, `nunca` or `baja`) and whether you overrode the filter. Personal mail domains (Gmail, Hotmail, etc.) are not sent. **Never** subjects, contents, full addresses or your account.
Once a day the app downloads the signed domain reputation and always uses it, even if you do not share.

**Stop sharing:** turn off **Settings → System → Help improve the filter** (or `NMT_FILTRO=0`). The queue is emptied and nothing else leaves; the downloaded reputation keeps being used.

## Settings

All of this lives in `config/defaults.json` and can be overridden by your own `config.json` and by environment variables:

| Variable | What |
|---|---|
| `NMT_SERVICE_URL` | Service base URL (default `https://mt.nonosky.com`) |
| `NMT_OLLAMA_URL`, `NMT_MODEL` | Ollama address and model |
| `NMT_OLLAMA_INSTALLER_WINDOWS`, `NMT_OLLAMA_INSTALLER_LINUX` | Installer URLs |
| `NMT_GOOGLE_CLIENT_ID`, `NMT_GOOGLE_CLIENT_SECRET` | Google client (Desktop app) behind "Sign in with Google" |
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

**With your own Google client:** create an OAuth client ID of type **Desktop app** in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Gmail API enabled) and put it in `google.clientId` and `google.clientSecret` in `config/defaults.json`, or in `NMT_GOOGLE_CLIENT_ID` and `NMT_GOOGLE_CLIENT_SECRET`. In a desktop app they are not confidential and PKCE protects the flow. Published releases get them at build time from the GitHub Actions secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; without them the button says so and the app password stays available.

A `v*` tag builds the installers on GitHub Actions and publishes them with `SHA256SUMS.txt` and stable-name copies
(`NoniMail-Tools-Setup.exe`, `NoniMail-Tools-Portable.exe`, `NoniMail-Tools.AppImage`, `nonimail-tools_amd64.deb`).

## License

[MIT](LICENSE) © Danilo Estuardo Gonzalez Rizzo. Dependencies and the Figtree font: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
