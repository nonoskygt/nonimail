# NoniMail Limpieza 2.0 — Configuración, IMAP y lotes por fecha

Fecha: 2026-10-09 · Estado: aprobado (el usuario pidió hacer las dos etapas de una vez)

## Objetivo

Proyecto open source que cualquiera instala en su PC y usa con su propio correo. Hoy depende de un
Apps Script desplegado en la cuenta personal del autor. La versión 2.0:

1. Agrega un panel **⚙ Configuración** con todas las variables, más los botones **Probar conexión** y **Guardar**.
2. Conecta el correo por **IMAP**, sin el Apps Script:
   - Gmail con **"Conectar con Google"** (OAuth 2.0 con el cliente propio de cada usuario, PKCE, redirect loopback).
   - Gmail con **contraseña de aplicación**.
   - **Otro proveedor IMAP**, con presets (Yahoo, iCloud, Zoho) o manual (Carbonio, hosting, etc.).
3. Envía las bajas por correo (`mailto:` de List-Unsubscribe) por **SMTP** con la misma cuenta.
4. En la ventana principal agrega un **slider de días hacia atrás** (7 d … 5 años, Todo). El rango se procesa
   en **lotes de N días**, del más nuevo al más viejo, con **progreso guardado y botón Continuar**.
5. Elimina el Apps Script y todo lo que estaba fijo en el código.

Fuera de alcance: Outlook/Hotmail (Microsoft exige su propio OAuth), multiusuario, servidor web público.

## Decisiones

| Tema | Decisión |
|---|---|
| Motor de correo | `imapflow` (decodifica charset y transfer-encoding; lectura con PEEK). `mailparser` resultó innecesario |
| Envío (bajas mailto) | `nodemailer` por SMTP; Gmail usa `smtp.gmail.com:465` con el mismo OAuth o contraseña |
| Versiones | Fijas y con al menos 14 días de publicadas (`npm install --before`) |
| Apps Script | Eliminado (`gmail_bridge.example.gs` y su nota de licencia) |
| Borrado | Solo `MOVE` a la carpeta `\Trash` (detectada o configurada). Sin Papelera, o sin MOVE ni UIDPLUS, **no se borra** |
| Lectura | Cabeceras con FETCH en bloque y cuerpo solo del primer correo de cada remitente nuevo (para el LLM) |
| Secretos | `secrets.json` aparte (gitignored). La API nunca los devuelve; la UI muestra "guardada ••••" |
| Red | El servidor escucha solo en `127.0.0.1`. Los POST exigen `Content-Type: application/json` y mismo origen (anti-CSRF) |
| Modelo LLM | Se elige entre los instalados en Ollama (`/api/tags`), dentro de Configuración |

## Arquitectura

| Archivo | Responsabilidad |
|---|---|
| `server.js` | Rutas HTTP, SSE y orquestación de trabajos |
| `lib/paths.js` | Carpeta de datos (`NONIMAIL_DATA_DIR`, por defecto la del proyecto) |
| `lib/config.js` | Valores por defecto, migración del formato 1.x, validación, guardado atómico, merge con lista blanca |
| `lib/secrets.js` | Lectura y escritura de `secrets.json`, estado sin exponer valores |
| `lib/classify.js` | Funciones puras: remitente, reglas, protección, conversación, decisión por dureza, HTML a texto |
| `lib/llm.js` | Ollama: generar (rápido / pensando), puntaje, modelos instalados, prueba |
| `lib/batches.js` | Ventanas de fechas y almacén de progreso (`progress.json`) |
| `lib/mail/presets.js` | Servidores IMAP/SMTP conocidos |
| `lib/mail/google-oauth.js` | URL de autorización, intercambio de código, refresco y revocación |
| `lib/mail/account.js` | Arma las opciones IMAP/SMTP desde config + secretos (y token de Google) |
| `lib/mail/imap.js` | `MailClient`: info, buscar por rango, leer metadatos y cuerpo, conversación, mover a Papelera |
| `lib/mail/smtp.js` | Verificar y enviar con nodemailer |
| `lib/engine.js` | Trabajos `scan`, `execute` y `auto` sobre ventanas, con reintentos, pausa y continuación |

## Flujo por lotes

1. Al iniciar, el trabajo calcula las ventanas `[since, before)` en días UTC y las guarda junto con el resto del trabajo.
2. Para cada ventana:
   1. `UID SEARCH SINCE/BEFORE` en la bandeja.
   2. Metadatos en bloques de `fetchChunk`.
   3. Clasificación.
   4. Guardia de conversación.
   5. `MOVE` a la Papelera en bloque.
   6. Se guarda el progreso.
3. Si se cae Ollama o IMAP, reintenta 3 veces con espera. Si sigue fallando, el trabajo queda **pausado**:
   el progreso está guardado y la UI ofrece **Continuar**.
4. La clave del trabajo es: tipo + cuenta + carpeta + días + días por lote + dry-run. Si una corrida en
   dry-run no se cierra, no se mezcla con una real.

## Protecciones (se mantienen y se refuerzan)

- Regla por remitente (`protect` / `delete`) y regex `keepOverride` (bancos, facturas, 2FA).
- **Conversación**, solo sobre los candidatos a borrar:
  1. Cabecera de respuesta (`In-Reply-To`, `References`, o asunto `Re:/Fwd:/RV:`).
  2. Remitente que sea una de "mis direcciones" (incluida la cuenta conectada).
  3. En Gmail, un hilo (`X-GM-THRID` en All Mail) con un mensaje mío o con 2 o más remitentes.
  4. En otros servidores, una respuesta en Enviados que lo referencie.
- Un patrón de heurística vacío **nunca** coincide. Antes, `new RegExp('')` coincidía con todo.
- Dry-run no mueve nada ni envía bajas.

## Pruebas

- `node --test` sobre las funciones puras (puntaje, ventanas, decisión, conversación, config y migración, OAuth).
- Integración con **hoodiecrow-imap** (servidor IMAP en memoria) y **smtp-server** (SMTP local): leer sin marcar
  como leído, mover a la Papelera, guardia de conversación, trabajo completo `auto` con pausa y continuación, envío de baja.
- HTTP: la API no filtra secretos y rechaza POST sin JSON o de otro origen.
- Verificación de la UI en el navegador contra el servidor de prueba.
- Prueba final con la cuenta real en dry-run, con credenciales cargadas por el usuario.
