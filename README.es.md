# NoniMail Tools

[English](README.md) · **Español**

Aplicación de escritorio (Windows y Linux) con dos herramientas para su correo. Sin cuenta y sin registro.

- **Limpiar**: limpia su bandeja de entrada por remitente. Todo lo promocional va a la Papelera. Nunca se borra nada.
- **Sincronizar**: copia un buzón IMAP en otro sin duplicados, conservando carpetas, banderas y fechas.
  El origen nunca se toca.

Español e inglés según el idioma de su sistema. Tema «Dulce» con modo claro, oscuro y automático, y seis colores de acento.

## Descarga

| Sistema | Descarga principal | Alternativa |
|---|---|---|
| Windows, instalador (por usuario) | [`/api/descargas/windows`](https://mt.nonosky.com/api/descargas/windows) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |
| Windows portable | [`/api/descargas/windows-portable`](https://mt.nonosky.com/api/descargas/windows-portable) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |
| Linux AppImage | [`/api/descargas/linux-appimage`](https://mt.nonosky.com/api/descargas/linux-appimage) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |
| Linux `.deb` | [`/api/descargas/linux-deb`](https://mt.nonosky.com/api/descargas/linux-deb) | [GitHub Releases](https://github.com/nonoskygt/nonimail-tools/releases/latest) |

Cada versión trae también `SHA256SUMS.txt`.

## Instalación

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/nonoskygt/nonimail-tools/main/scripts/install.ps1 | iex
```

**Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/nonoskygt/nonimail-tools/main/scripts/install.sh | bash
```

El script de Linux deja el AppImage en `~/.local/bin`, crea la entrada del menú y, si usted lo acepta, instala Ollama.
Los dos descargan de `https://github.com/nonoskygt/nonimail-tools/releases/latest/download/` y comprueban la suma SHA256.

También puede bajar el instalador de la tabla y ejecutarlo. Para el `.deb`: `sudo apt install ./nonimail-tools_amd64.deb`.

## Primer arranque: el configurador

Se abre la primera vez y puede repetirlo cuando quiera en **Ajustes → Sistema → Ejecutar el configurador**.

1. **Idioma y apariencia**: idioma, modo (auto, claro, oscuro) y color de acento. El modo auto sigue la hora: claro de 06:00 a 17:59.
2. **Dependencias**: detecta [Ollama](https://ollama.com) (IA local).
   - Si no está instalado, **Instalar** baja el instalador oficial por HTTPS y lo ejecuta, con progreso.
     En Windows corre `OllamaSetup.exe` en silencio. En Linux corre el script oficial con `pkexec` (una ventana del sistema pide su contraseña);
     sin escritorio muestra el comando exacto para la terminal.
   - Después descarga el modelo con `/api/pull` de Ollama, con barra de progreso.
   - **Omitir (sin IA)** usa solo heurísticas.
3. **Telemetría**: un interruptor, encendido por defecto. Vea [Privacidad](#privacidad-y-telemetría).
4. **Primera cuenta**: elija el proveedor (Gmail, Yahoo, iCloud, AOL, Zoho, GMX, Yandex, Fastmail u otro manual), escriba correo y contraseña y pruebe la conexión.

## Limpiar

1. **Escanear** lee el rango elegido por lotes de fechas, agrupa por remitente y puntúa cada uno (0 = importante, 100 = basura segura). No cambia nada.
2. Ajuste la **Dureza** y corrija remitentes con **Conservar** / **Mover**. **Proteger** conserva a un remitente para siempre.
3. **Mover a la Papelera** mueve los correos de los remitentes marcados. **Limpiar todo** hace todo de corrido.

Reglas de seguridad:

- Mover es llevar a la **Papelera**, que usted puede recuperar. No existe el borrado definitivo.
- Sin carpeta Papelera, o con un servidor sin MOVE/UIDPLUS, no se mueve nada.
- Bancos, recibos, códigos de seguridad y conversaciones en las que usted participó se protegen antes de que cuente cualquier puntaje.
- **Simulación** viene activada y muestra lo que pasaría.
- Si usted para, se cae Ollama o cierra la app, **Continuar** sigue desde el último lote terminado.
- **Dar de baja** prueba un clic (RFC 8058), luego un correo `mailto:` y luego el enlace. Solo se abren enlaces `https` a direcciones públicas.

El puntaje lo da su modelo local de Ollama: ningún asunto ni cuerpo sale hacia un servicio externo de IA. Sin Ollama deciden las heurísticas.

## Sincronizar

Elija **Origen** y **Destino** entre sus cuentas (opcionalmente filtre carpetas) y luego **Simular** o **Sincronizar**.

- Copia solo lo que falta, comparando por Message-ID (o por una huella si no lo hay).
- Conserva carpetas, banderas (leído, destacado) y las fechas originales. Enviados, Papelera, Borradores y Spam se unen con los propios del destino.
- Al final verifica que todo lo del origen esté en el destino.
- Una segunda corrida no copia nada nuevo.

## Licencias y precios

- Las **cuentas personales** (Gmail, Hotmail, Outlook, Yahoo, iCloud, Proton y otros proveedores públicos) son **gratis**.
- Las **cuentas con dominio propio** son uso comercial. Siempre puede **simular**. Para ejecutar de verdad se necesita una clave **por cuenta y por función**, válida 30 días.

| Función | Precio (30 días) |
|---|---|
| Limpiar | USD 1 |
| Sincronizar | USD 2 |

La pestaña **Licencias** muestra el estado de cada cuenta y un enlace **Comprar**. Pegue la clave (`NMT1.…`) en **Agregar clave**.
Las claves van firmadas (Ed25519) y se validan sin conexión con la clave pública incluida en la app. Las licencias compradas en el servicio web también valen.

## Conectar con Google

Cada persona usa **su propio** cliente de Google. Así no hay una app compartida que auditar y sus credenciales no pasan por nadie más. Es una sola vez, unos 10 minutos:

1. Cree un proyecto en [Google Cloud Console](https://console.cloud.google.com/projectcreate).
2. Habilite la **Gmail API**.
3. **Pantalla de consentimiento de OAuth**: tipo **Externo**; agregue el permiso `https://mail.google.com/`.
4. Publique la app (estado «En producción»); en «Prueba» Google corta el acceso cada 7 días. No necesita verificación: es solo suya.
5. **Credenciales → ID de cliente de OAuth**, tipo **App de escritorio**. Copie el **Client ID** y el **Client Secret** en **Ajustes → Cuentas → Google**.
6. Toque **Conectar con Google** y acepte. Google avisará que la app no está verificada: es la suya, continúe por **Configuración avanzada**.

Más simple: Gmail con una [contraseña de aplicación](https://myaccount.google.com/apppasswords) (requiere verificación en 2 pasos).
Outlook/Hotmail con contraseña no está soportado: Microsoft ya no acepta contraseñas por IMAP.

## Privacidad y telemetría

Todo se analiza en su computadora. Las contraseñas y los tokens se guardan cifrados (`safeStorage` de Electron: DPAPI en Windows, el llavero del sistema en Linux).

Si deja la telemetría encendida (el valor por defecto), la app envía **solo esto** a `https://mt.nonosky.com`:

- Al instalar y como máximo una vez al día: un identificador aleatorio de instalación, la app (`desktop`), la versión, el sistema (`windows`/`linux`), su versión, la arquitectura, el idioma, la zona horaria, el origen de la descarga (`github`, `mt` o `desconocido`), si la IA local está activa y el nombre de su modelo.
- Eventos: `inicio` (se abrió la app) · `cuenta` (se agregó o probó una cuenta: dirección, proveedor, si es personal) · `limpiar` (cifras y duración de un escaneo o una limpieza) · `sincronizar` (cuentas y cifras de una sincronización) · `licencia` (se agregó una clave válida: cuenta, función, canal, vencimiento) · `error` (mensaje y pila, sin contraseñas, tokens ni direcciones que no sean sus cuentas).

**Nunca se envían:** contraseñas, tokens, claves de licencia completas, asuntos, cuerpos ni remitentes de sus correos. El servidor agrega la fecha y una ubicación aproximada por GeoIP de la petición; la app no manda su IP.
Los eventos esperan en una cola en disco y salen en lotes cada 5 minutos, al terminar una operación y al cerrar la app.

**Para apagarla:** el interruptor del configurador, **Ajustes → Privacidad**, o la variable de entorno `NMT_TELEMETRY=0`. Apagada, la app no envía nada, ni siquiera el aviso de instalación, y se vacía la cola.

## Configuración

Todo vive en `config/defaults.json` y se puede cambiar con su propio `config.json` y con variables de entorno:

| Variable | Qué |
|---|---|
| `NMT_SERVICE_URL` | Dirección base del servicio (por defecto `https://mt.nonosky.com`) |
| `NMT_OLLAMA_URL`, `NMT_MODEL` | Dirección de Ollama y modelo |
| `NMT_OLLAMA_INSTALLER_WINDOWS`, `NMT_OLLAMA_INSTALLER_LINUX` | Direcciones de los instaladores |
| `NMT_GOOGLE_CLIENT_ID` | Client ID de Google |
| `NMT_LANGUAGE` | `es` o `en` |
| `NMT_TELEMETRY` | `0` / `1` |
| `NMT_PORT`, `NMT_HOST` | Puerto y dirección del servidor sin ventana |
| `NMT_DATA_DIR` | Carpeta de datos |
| `NMT_CONFIG_FILE` | Archivo JSON adicional con valores |

Carpeta de datos: `%APPDATA%\NoniMail Tools` en Windows y `~/.config/nonimail-tools` en Linux. Contiene `config.json`, `secrets.json`, `licenses.json`, `senders.json`, `progress.json`, la cola de telemetría y `logs/`.
El registro (`logs/nonimail-tools.log`) rota por tamaño; los errores también van al registro. **Ajustes → Sistema → Abrir carpeta de registros** lo abre.

## Sin ventana

```bash
npm install
npm start        # imprime http://127.0.0.1:8765/
```

## Compilar desde el código

Requiere Node.js 20 o superior.

```bash
git clone https://github.com/nonoskygt/nonimail-tools.git
cd nonimail-tools
npm install
npm test                # pruebas con servidores IMAP/SMTP en memoria; no tocan ningún buzón real
npm run desktop         # abre la app Electron
npm run dist:linux      # AppImage + deb en dist/
npm run dist:win        # instalador NSIS + portable en dist/ (mejor en Windows)
npm run icons           # regenera los iconos de build/
```

Una etiqueta `v*` compila los instaladores en GitHub Actions y los publica con `SHA256SUMS.txt` y copias con nombre estable
(`NoniMail-Tools-Setup.exe`, `NoniMail-Tools-Portable.exe`, `NoniMail-Tools.AppImage`, `nonimail-tools_amd64.deb`).

## Licencia

[MIT](LICENSE) © Danilo Estuardo Gonzalez Rizzo. Dependencias y la letra Figtree: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
