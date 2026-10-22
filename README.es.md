# NoniMail Tools para Android

[English](README.md)

Dos herramientas de correo en una sola app Android de código abierto. Todo corre en el teléfono, directo contra su servidor IMAP.

- **Limpiar**: revisa su INBOX sin modificarla, agrupa por remitente, califica a cada uno y manda el ruido a la papelera.
- **Sincronizar**: copia un buzón IMAP a otro, solo lo que falta, conservando banderas y fechas.

<p>
<img src="docs/screenshots/limpiar-claro.png" width="220" alt="Limpiar">
<img src="docs/screenshots/sincronizar-claro.png" width="220" alt="Sincronizar">
<img src="docs/screenshots/ajustes-oscuro.png" width="220" alt="Ajustes, oscuro">
</p>

## Instalación

1. Descargue el APK: **<https://mt.nonosky.com/api/descargas/android>**
   (o desde [GitHub Releases](https://github.com/nonoskygt/nonimail-tools-android/releases): `NoniMail-Tools.apk` siempre es la última versión).
2. Abra el archivo. Si Android lo pide, permita instalar desde este origen (Ajustes → Apps → Acceso especial → Instalar apps desconocidas → su navegador o administrador de archivos).
3. Opcional: compruebe la descarga con `SHA256SUMS.txt` de la versión.

Requiere Android 8.0 (API 26) o superior.

**Actualizaciones:** la app busca en GitHub Releases al iniciar y cada 12 horas, descarga y verifica el APK nuevo (SHA-256 y el mismo certificado de firma) y le pide un toque en «Instalar»; en Ajustes → Actualizaciones se apaga.

## Primer arranque

Un configurador corto se ejecuta una vez y puede repetirse desde Ajustes:

1. Idioma (español, inglés o el del dispositivo) y apariencia (modo y color).
2. Permisos: notificaciones (Android 13+) y exención de optimización de batería, para que las tareas largas no se corten.
3. IA opcional: un modelo que corre en el propio teléfono (Básico, Mediano o Grande; la app recomienda el mayor que su RAM y su espacio permiten) o un servidor Ollama en su red. Una sola barra de progreso cubre la verificación, la descarga (reanudable, con Cancelar) y la configuración del modelo. Puede omitirla.
4. Interruptor de telemetría (vea [Privacidad](#privacidad--telemetría)).
5. Su primera cuenta: Gmail, Outlook/Hotmail, Yahoo, iCloud o IMAP personalizado, con prueba de conexión.

**Gmail requiere una contraseña de aplicación con IMAP activado.** Active la verificación en dos pasos, cree una contraseña de aplicación y úsela en lugar de su contraseña normal. Outlook, Yahoo e iCloud también usan contraseñas de aplicación.

## Limpiar

- Escanee los últimos N mensajes o los últimos N días. El escaneo solo lee; no marca nada como leído.
- Cada remitente recibe una calificación de 0 a 100 con las reglas compartidas (promociones, encabezados de envío masivo, remitentes automáticos). Si configuró la IA (en el teléfono o con Ollama), también puede calificar.
- El control de **dureza** traza una línea de corte sobre las calificaciones; los remitentes por encima quedan marcados. Usted puede marcar o desmarcar cualquiera.
- **Las protecciones siempre ganan**: bancos, facturas, códigos de verificación (un patrón regex que usted puede editar), su lista de protegidos y las personas a quienes usted escribe. Un remitente protegido nunca se mueve.
- El correo va solo a la papelera (se detecta con la marca `\Trash` o por nombre). Si el buzón no tiene papelera, la ejecución se rechaza.
- **Solo simular** viene encendido de fábrica.

**IA en el teléfono.** Tres niveles (Básico, Mediano y Grande) corren en el teléfono con [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM); la app lee su RAM y su espacio libre y recomienda el mayor que cabe (RAM de al menos 2 veces el modelo más 2 GB, y espacio de al menos el modelo más 1 GB). Los modelos salen de los repositorios `litert-community` de Hugging Face que no piden inicio de sesión; las direcciones, los tamaños y las sumas SHA-256 están en el bloque `localAi` de `core/src/main/resources/com/nonosky/nonimailtools/core/defaults.json`, y el archivo se comprueba antes de cargarlo. «Servidor en mi red» (Ollama) queda como cuarta opción y las reglas siempre son el respaldo.

## Sincronizar

- Elija origen y destino, incluya o excluya carpetas si quiere, simule primero y luego ejecute.
- Solo se copia lo que falta. La identidad es el Message-ID; sin él, un hash de fecha, remitente, destinatarios, asunto y tamaño. Los duplicados legítimos se respetan.
- Se conservan banderas y fecha interna, se mapean las carpetas especiales (Enviados, Papelera, Borradores, Spam, Archivo) y se omiten las carpetas virtuales de Gmail.
- El avance muestra carpetas, mensajes y bytes. Al final la app verifica que todo lo del origen esté en el destino.
- El origen nunca se modifica.

Las operaciones largas corren en un servicio en primer plano con notificación y botón Cancelar.

## Licencias y precios

- Las **cuentas personales** (proveedores públicos como Gmail, Outlook, Yahoo, iCloud) son **gratis**.
- Las **cuentas comerciales** (dominio propio) siempre pueden simular. Para ejecutar de verdad se necesita una clave de esa cuenta y de esa función, válida por 30 días: **USD 1 Limpiar, USD 2 Sincronizar**.
- Compre desde la pestaña Licencias (abre `{servicio}/licencias.html?cuenta=…&tipo=…&canal=app`) y pegue la clave `NMT1.…`. Las claves se verifican sin conexión con una firma Ed25519. Las claves compradas en el sitio web también sirven.

## Privacidad / Telemetría

El interruptor «Enviar uso y errores a Nonosky» viene **encendido de fábrica** y usted puede apagarlo en el configurador o en Ajustes. Apagado, la app no envía nada (ni siquiera el registro de instalación).

Qué se envía (contrato v1, `app: "android"`):

- **Instalación** (una vez al día como máximo): identificador de instalación (UUID aleatorio), versión de la app, sistema y versión, arquitectura, idioma, zona horaria, origen de la descarga (`github`, `mt` o `desconocido`), si hay IA local y el nombre de su modelo.
- **Eventos**: `inicio` (se abrió la app); `cuenta` (dirección agregada, proveedor, personal o no); `limpiar` (cuenta, escaneo o ejecución, simulación, correos revisados, remitentes, correos movidos, segundos, resultado, con licencia); `sincronizar` (direcciones de origen y destino, simulación, carpetas, mensajes, copiados, bytes, segundos, resultado, con licencia); `licencia` (cuenta, función, canal, vencimiento); `error` (mensaje, pila de hasta 4000 caracteres, contexto, cuenta).
- El servidor agrega su IP, país, región, ciudad y la fecha.

**Nunca se envía**: contraseñas, tokens, claves de licencia completas, asuntos, cuerpos ni remitentes de sus correos. En los errores se tachan las direcciones de correo que no sean sus cuentas y todo lo que parezca una contraseña o un token.

Los eventos se encolan en el dispositivo y se envían en lote (cada 5 minutos con la app abierta, al terminar cada operación, al cerrarla y con WorkManager). En el teléfono siempre se guarda un registro local rotativo; use Ajustes → Ver registros / Compartir registros.

## Compilación

Requisitos: JDK 17 y el SDK de Android (plataforma 37).

```bash
./gradlew :core:test :app:testDebugUnitTest assembleDebug
```

- `core`: Kotlin/JVM puro (IMAP, calificación, sincronización, licencias, telemetría), probado sin dispositivo, incluso con conversaciones IMAP reales contra GreenMail.
- `app`: Jetpack Compose, Material 3 mapeado al tema «Dulce», Figtree incluida (OFL, vea `licenses/`).
- Los valores por defecto (dirección del servicio, modelo y puerto de Ollama, tiempos, precios) viven en `gradle.properties` y llegan a `BuildConfig`.
- Capturas: `./gradlew :app:testDebugUnitTest -Pnmt.shotsDir=/una/carpeta` (Robolectric + Roborazzi).

### Firma

La compilación de lanzamiento lee `NMT_KEYSTORE_FILE`, `NMT_KEYSTORE_PASSWORD`, `NMT_KEY_ALIAS` y `NMT_KEY_PASSWORD` del entorno y, si faltan, firma con la llave de depuración.

```bash
keytool -genkeypair -keystore release.jks -alias nonimail-tools -keyalg RSA -keysize 4096 -validity 10950
```

Nunca suba el keystore al repositorio. En GitHub cree los secretos `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` y `ANDROID_KEY_PASSWORD`. Al subir una etiqueta `vX.Y.Z` se compilan el APK y el AAB firmados (`origen_descarga=github`) y se adjuntan a una versión con sumas SHA-256, también como `NoniMail-Tools.apk`.

## Licencia

MIT, © Danilo Estuardo Gonzalez Rizzo. Vea [LICENSE](LICENSE). Figtree usa la licencia SIL Open Font License.
