# Changelog

## 1.1.1

Arreglos de la IA local y de la ventana.

- **Ollama ya instalado se detecta bien.** Causa del falso «Ollama no está instalado»: el configurador daba por no instalado todo Ollama cuya API no contestaba (por ejemplo, con la app de la bandeja cerrada) y nunca buscaba el programa. Ahora el orden es: API en la dirección configurada, en `OLLAMA_HOST` y en `127.0.0.1`/`localhost`; después el ejecutable (rutas de `ollama.exePaths` en `config/defaults.json`, `%LOCALAPPDATA%\Programs\Ollama`, Archivos de programa y el PATH); si está pero no corre, se inicia solo y se espera a la API. El botón **Instalar** solo sale si no hay nada.
- **Tres modelos: Básico, Mediano y Grande**, definidos en `ollama.tiers` (etiqueta, tamaño y RAM/VRAM) y recomendados según la RAM y la GPU del equipo (`nvidia-smi`, PowerShell o `/sys/class/drm`). Tarjetas seleccionables con «Recomendado para su equipo» y «Instalado»; se quita el campo de texto del modelo del configurador (queda como opción avanzada en Ajustes → IA).
- **Una sola barra de progreso** para verificar, instalar Ollama, descargar el modelo (`37% (1.2 / 3.3 GB)`) y configurarlo (verificación y una generación de 1 token). Errores en una línea con **Reintentar**.
- **Cancelar** durante la instalación, la descarga o la configuración: aborta la descarga, mata el instalador, corta `/api/pull`, borra los temporales y deja el paso listo para **Reintentar** u **Omitir (sin IA)**.
- **Bandeja del sistema**: el botón de cerrar pregunta «¿Qué desea hacer?» (**Mantener minimizada** o **Cerrar por completo**, con «Recordar mi elección»). El trabajo en curso sigue con la ventana oculta. La opción se cambia en Ajustes → Sistema (`closeAction`). Sin bandeja disponible, se minimiza normal. Un segundo arranque restaura la ventana.

## 1.1.0

Interfaz rehecha: cada pantalla cabe en una ventana (1280x800, y también 1024x700) sin desplazar la página.

- **Pestañas nuevas**: **Cuentas** primero, luego **Sincronizar**, **Limpiar**, **Licencias** y **Ajustes**. Sincronizar y Limpiar quedan deshabilitadas (con aviso a lectores de pantalla y descripción emergente) hasta que haya una cuenta guardada y probada.
- **Ajustes** en subpestañas (IA, Limpieza, Reglas, Apariencia, Sistema) que caben sin desplazar. Solo las listas largas (remitentes, licencias, cuentas) se desplazan dentro de su panel.
- **Iniciar sesión con Google** con un clic: PKCE y redirección local, permiso solo de correo (`https://mail.google.com/` más `openid email`), cuenta guardada y probada sola. Se quitan el Client ID y el Client Secret de la interfaz normal; el cliente viene de `config/defaults.json` (`google.clientId`, `google.clientSecret`), de `NMT_GOOGLE_CLIENT_ID`/`NMT_GOOGLE_CLIENT_SECRET` o de **Ajustes → Sistema**. La compilación de la versión los inyecta desde los secretos `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`; sin cliente el botón avisa y queda la contraseña de aplicación.
- **Sesión con el servicio solo para cuentas de dominio propio**: las personales no piden nada. Entrar compacto (correo, contraseña, código de 6 dígitos si el correo es nuevo, «¿Olvidó su contraseña?»); al entrar se traen las licencias de `/api/licencias` y cada clave pasa por la verificación sin conexión. Token cifrado como los demás secretos y **Cerrar sesión** en Licencias. La puerta real sigue siendo la clave firmada.
- El configurador también cabe sin desplazar y termina en la pestaña Cuentas.
- Pruebas nuevas: pestañas, sesión solo para dominios propios, traída de licencias (200, 202 con código y contraseña mala), flujo de Google y secretos fuera de registros y telemetría.

## 1.0.0

Primera versión de NoniMail Tools de escritorio (Windows y Linux), sobre la base de NoniMail Cleaner 2.0.

- Una sola app con cuatro pestañas: **Limpiar**, **Sincronizar**, **Licencias** y **Ajustes**. Sin login ni registro.
- **Sincronizar** (portado del servicio web): copia IMAP a IMAP sin duplicados, con carpetas, banderas y fechas, y con verificación al final. El origen no se toca.
- **Licencias**: cuentas personales gratis; cuentas de dominio propio simulan siempre y ejecutan con clave por cuenta y función (30 días, USD 1 limpiar, USD 2 sincronizar). Claves `NMT1` Ed25519 validadas sin conexión.
- **Configurador inicial** (se puede repetir): idioma y apariencia, detección e instalación de Ollama con progreso, telemetría y primera cuenta con prueba de conexión.
- **Telemetría** según el contrato v1: cola en disco, lotes, reintentos, consentimiento y datos sin secretos. Se apaga desde el configurador, Ajustes o `NMT_TELEMETRY=0`.
- **Registro** con rotación en la carpeta de datos; los errores no controlados y los fallos de operaciones se registran y se reportan como eventos `error`.
- Español (usted) e inglés, según el idioma del sistema, con selector.
- Tema **Dulce** (claro, oscuro y auto por la hora, seis acentos) con la letra Figtree incluida.
- Configuración en tres capas: `config/defaults.json`, `config.json` del usuario y variables `NMT_*`. Carpeta de datos propia de cada sistema. Contraseñas y tokens cifrados con `safeStorage`.
- Empaquetado con Electron: instalador NSIS por usuario y portable para Windows; AppImage y deb para Linux. Scripts `scripts/install.sh` y `scripts/install.ps1`.
- GitHub Actions: pruebas en Ubuntu y Windows, y compilación de versiones con sumas SHA256.
- Seguridad: el instalador de Ollama usa una carpeta temporal privada y pasa el script a `pkexec` por la entrada estándar.
- Se corrige el botón «Probar modelo», que fallaba por una variable que ocultaba la función de traducción.
