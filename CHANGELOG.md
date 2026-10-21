# Changelog

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
