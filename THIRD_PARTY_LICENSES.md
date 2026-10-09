# Licencias de terceros

Este repositorio no incluye código de terceros. Las dependencias se instalan con `npm install` y cada
una trae su licencia en `node_modules/<paquete>/`.

| Paquete | Uso | Licencia |
|---|---|---|
| [imapflow](https://github.com/postalsys/imapflow) | Cliente IMAP | MIT |
| [nodemailer](https://github.com/nodemailer/nodemailer) | Envío SMTP de bajas por correo | MIT-0 |
| [hoodiecrow-imap](https://github.com/andris9/hoodiecrow) (solo pruebas) | Servidor IMAP en memoria | MIT |
| [smtp-server](https://github.com/nodemailer/smtp-server) (solo pruebas) | Servidor SMTP local | MIT-0 |

Las dependencias transitivas de producción (libmime, libqp, libbase64, iconv-lite, pino, etc.) son MIT o ISC.

Hasta la versión 1.x, el repositorio incluía `gmail_bridge.example.gs`, derivado del Gmail Bridge de
[AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) (Mintplex Labs Inc., MIT). La versión 2.0 lo eliminó.
