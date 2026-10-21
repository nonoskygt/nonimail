# Licencias de terceros

El código propio de este repositorio es MIT (ver [LICENSE](LICENSE)). Las dependencias se instalan con `npm install`
y cada una trae su licencia en `node_modules/<paquete>/`. Lo siguiente se distribuye dentro de la aplicación o se usa para construirla.

## Incluido en la aplicación

| Componente | Uso | Licencia |
|---|---|---|
| [Electron](https://www.electronjs.org/) | Ventana de escritorio (Chromium y Node.js) | MIT; el paquete incluye `LICENSES.chromium.html` con las licencias de Chromium |
| [imapflow](https://github.com/postalsys/imapflow) | Cliente IMAP (Limpiar y Sincronizar) | MIT |
| [nodemailer](https://github.com/nodemailer/nodemailer) | Envío SMTP de bajas por correo | MIT-0 |
| [Figtree](https://github.com/erikdkennedy/figtree) | Letra de la interfaz (`public/fonts/`) | SIL Open Font License 1.1 (texto en `public/fonts/OFL.txt`) |

Las dependencias transitivas de producción (libmime, libqp, libbase64, iconv-lite, pino, etc.) son MIT o ISC.

## Solo desarrollo y pruebas

| Componente | Uso | Licencia |
|---|---|---|
| [electron-builder](https://github.com/electron-userland/electron-builder) | Empaquetado (NSIS, portable, AppImage, deb) | MIT |
| [hoodiecrow-imap](https://github.com/andris9/hoodiecrow) | Servidor IMAP en memoria | MIT |
| [smtp-server](https://github.com/nodemailer/smtp-server) | Servidor SMTP local | MIT-0 |

## Programas externos que la app puede instalar a pedido suyo

[Ollama](https://ollama.com) (MIT) se descarga desde el sitio oficial cuando usted lo pide en el configurador; no se distribuye con la app.

## Historia

Hasta la versión 1.x de NoniMail Cleaner, el repositorio incluía `gmail_bridge.example.gs`, derivado del Gmail Bridge de
[AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (Mintplex Labs Inc., MIT). La versión 2.0 lo eliminó.
