# Nono Mail Cleaner

Limpiador de bandeja de entrada con panel web local. Se conecta a tu correo por **IMAP** (Gmail u otro
proveedor) y clasifica los correos en dos capas: protecciones y heurísticas por expresión regular, y un
**LLM local vía [Ollama](https://ollama.com)**. Mueve a la Papelera solo lo claramente promocional.

Todo el análisis ocurre en tu máquina. Ningún asunto ni cuerpo de correo sale hacia un servicio externo de IA.

## Cómo funciona

- **`server.js`**: servidor Node que escucha solo en `127.0.0.1:8765`. Orquesta los trabajos y sirve el panel.
- **`public/index.html`**: panel de control, con eventos en vivo por SSE: remitentes, progreso por lotes y métricas de CPU/GPU.
- **`lib/`**: el motor.
  - `mail/imap.js`: acceso IMAP con [imapflow](https://github.com/postalsys/imapflow).
  - `mail/smtp.js`: bajas por correo con [nodemailer](https://nodemailer.com).
  - `mail/google-oauth.js`: "Conectar con Google".
  - `engine.js`: trabajos por lotes.
  - `classify.js` y `llm.js`: decisión.

### Las capas de decisión

1. **Protecciones**: siempre ganan.
   - `keepOverride` (banco, factura, recibo, 2FA, alertas de seguridad): ese correo nunca se borra.
   - Tus reglas por remitente (**Conservar** / **Descartar**), guardadas en `senders.json`.
   - **Conversaciones**: no se borra un correo que sea una respuesta, ni uno de un hilo donde vos escribiste.
     En Gmail se revisa el hilo completo; en otros servidores, tu carpeta de Enviados.
2. **Puntaje del LLM**: un entero de 0 (importante) a 100 (basura segura) por remitente. Los dudosos se
   vuelven a evaluar "pensando". La **dureza** decide desde qué puntaje se borra; lo que queda en el medio
   se marca como duda y no se borra solo.

### Lotes por fecha

En la pantalla principal elegís cuánto revisar: **7 días, 30 días, 3 meses, 6 meses, 1 año, 2 años,
3 años, 5 años o Todo**.

- El rango se parte en lotes de N días (30 por defecto), del más nuevo al más viejo.
- El progreso se guarda al terminar cada lote. Si tocás **Parar**, se cae Ollama o cerrás la app, aparece
  un aviso con **▶ Continuar** que sigue desde donde quedó.

### Reglas de seguridad del borrado

- Borrar = **mover a la Papelera** (recuperable). Nunca hay borrado definitivo.
- Si no se encuentra la carpeta Papelera, o el servidor no soporta MOVE/UIDPLUS, la app **no borra nada**.
- La lectura se hace en solo lectura: los correos no se marcan como leídos.
- **Dry-run** (activado por defecto) muestra lo que haría sin tocar el buzón. Empezá siempre por ahí.

## Instalación

Requisitos: **Node.js 18+** y **Ollama** con un modelo instalado.

```bash
git clone https://github.com/nonoskygt/nono-mail-cleaner.git
cd nono-mail-cleaner
npm install
ollama pull qwen3.5:9b
npm start
```

Abrí <http://localhost:8765>. La primera vez se abre **⚙ Configuración** para conectar tu correo.

**Sobre el modelo:** en **⚙ Configuración → LLM**, **🧪 Probar LLM** comprueba dos cosas: que el modelo
distinga una promoción de un correo personal, y que termine de "pensar" un caso dudoso. Medido en una
RTX 4070 de 8 GB:
- `qwen3.5:9b` clasifica bien en modo rápido, pero al pensar no termina ni con 2048 tokens (más de un
  minuto por correo).
- Un derivado más escueto (`ornith:9b`, de la misma familia) responde pensando en unos 10 segundos.

Si el modelo se corta pensando, el trabajo desactiva solo esa fase y sigue con el puntaje rápido. También
podés desmarcar **Pensar los dudosos**.

## Conectar tu correo

En **⚙ Configuración → Cuenta** elegí una de estas tres opciones y usá **🔌 Probar conexión** antes de **💾 Guardar**.

### Gmail · Conectar con Google (recomendado)

Cada persona usa **su propio** cliente de Google. Así no hay una app compartida que Google tenga que
auditar, y tus credenciales no pasan por nadie más. Es una sola vez y lleva unos 10 minutos:

1. En [Google Cloud Console](https://console.cloud.google.com/projectcreate) creá un proyecto.
2. En **APIs y servicios → Biblioteca**, habilitá la **Gmail API**.
3. En **Pantalla de consentimiento de OAuth**:
   - Tipo **Externo**.
   - En **Permisos**, agregá `https://mail.google.com/`.
4. En **Público**, tocá **Publicar app** (estado "En producción"). En estado "En prueba", Google corta el
   acceso cada 7 días. No hace falta verificar la app: es solo tuya.
5. En **Credenciales → ID de cliente de OAuth**:
   - Tipo **App de escritorio**.
   - Copiá el **Client ID** y el **Client Secret** en el panel.
6. Tocá **Conectar con Google** y aceptá. Google avisará que la app no está verificada: es la tuya,
   entrá por **Configuración avanzada**.

El permiso `https://mail.google.com/` es el que exige Google para IMAP y SMTP. La app solo lee, mueve
a la Papelera y envía correos de baja.

### Gmail · contraseña de aplicación

Requiere la verificación en 2 pasos. Creá una en <https://myaccount.google.com/apppasswords> y
pegala junto con tu correo.

### Otro proveedor (IMAP)

Yahoo, iCloud y Zoho ya vienen configurados. Para Carbonio, cPanel o cualquier otro, cargá a mano
el servidor IMAP (y SMTP, para las bajas por correo).

**Outlook/Hotmail no está soportado:** Microsoft ya no acepta contraseñas por IMAP/SMTP.

## Uso

1. **🔄 Escanear**: lee el rango elegido, agrupa por remitente y puntúa cada uno. No borra nada.
   Ajustá la **dureza** y corregí con **Conservar** / **Descartar**, que queda guardado para siempre.
2. **▶ Ejecutar**:
   - Mueve a la Papelera los correos de los remitentes descartados, en el mismo rango.
   - Da de baja a los marcados en la cola. Prueba en orden: *one-click* (RFC 8058), correo (`mailto:`)
     y enlace.
3. **⚡ Limpiar TODO**: hace todo de corrido, borrando solo lo claramente promocional.

**⚙ Configuración** reúne todas las variables:
- **Cuenta y carpetas.**
- **LLM**:
  - Dirección de Ollama y modelo. Se elige entre los instalados; **🧪 Probar LLM** comprueba que
    distinga una promoción de un correo personal.
  - Pensamiento de dudosos, contexto y paralelismo.
- **Limpieza**: días por lote, dureza, margen de duda, protección de conversaciones, tus otras direcciones.
- **Servidor**: el puerto.

**📜 Reglas** muestra y edita los patrones de protección y de ruido, y el prompt del LLM.

## Archivos locales

Ninguno de estos archivos se versiona (están en `.gitignore`):

| Archivo | Contiene |
|---|---|
| `config.json` | Configuración, sin secretos. Se crea desde `config.example.json` |
| `secrets.json` | Contraseña IMAP, Client Secret y token de Google. **No lo compartas** |
| `senders.json` | Tus reglas por remitente y las bajas hechas |
| `progress.json` | Trabajos sin terminar (para "Continuar") |
| `logs/` | Registro de cada corrida, con asuntos y remitentes reales |

Para guardarlos en otra carpeta, usá `NONIMAIL_DATA_DIR=/ruta npm start`.

## Seguridad

- El servidor escucha solo en `127.0.0.1`. Rechaza pedidos con un `Host` ajeno (DNS rebinding) y POST
  de otro origen o sin `Content-Type: application/json` (CSRF).
- La API nunca devuelve secretos; el panel solo muestra "guardada".
- Los enlaces de baja vienen del remitente: solo se abren si son `https` y nunca hacia direcciones de tu
  red local.

## Actualizar desde la versión 1.x (Apps Script)

La 2.0 ya no usa el puente de Google Apps Script. Al arrancar:
- `config.json` se migra solo y queda un respaldo `config.json.bak-<fecha>`.
- Después conectás tu correo desde **⚙ Configuración**.

**Importante:** archivá el despliegue viejo en <https://script.google.com>, en **Implementar → Gestionar
implementaciones → Archivar**. Mientras siga activo, su URL más la clave dan acceso a tu buzón.

## Pruebas

```bash
npm test
```

Usan un servidor IMAP en memoria ([hoodiecrow-imap](https://github.com/andris9/hoodiecrow)), un SMTP
local y servidores falsos de Google y Ollama. No tocan ningún buzón real.

## Licencia

El código propio de este repositorio no lleva licencia declarada: todos los derechos reservados.
Para abrirlo, agregá un archivo `LICENSE`. Las dependencias y sus licencias están en
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
