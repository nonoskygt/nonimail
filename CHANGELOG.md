# Changelog

## 1.2.1

Licencias discretas, terminales en vivo y bajas bajo control.

- **Sin pestaña Licencias.** La verificación sin conexión y la descarga automática de licencias tras iniciar sesión siguen igual. Lo único visible es «Iniciar sesión» junto a cada cuenta de dominio propio (Cuentas), que abre el formulario en línea (correo, contraseña, código) y trae las licencias solo. Una cuenta comercial en simulación muestra una línea con «Comprar licencia» (abre `licencias.html?cuenta=…&tipo=…&canal=app` en el navegador). «Agregar clave de licencia» pasó a Ajustes → Sistema. Se quitaron la tarjeta de precios y la tabla de licencias.
- **Terminales de vuelta.** Limpiar muestra «CPU · lectura + heurística» (medidor de CPU y lo que lee y decide la heurística) y «GPU · LLM (modelo)» (medidor de GPU/VRAM y lo que se le pregunta al modelo, qué responde y el puntaje). Sincronizar muestra «Red · sincronización»: carpeta en curso, mensajes comparados y copiados, bytes, errores y velocidad. Pantalla oscura de terminal en tema claro y oscuro; ocupan el alto restante y se desplazan por dentro. El motor emite ahora «Leídos N correos» y la respuesta cruda del modelo.
- **Barra de progreso con fases** sobre la lista de remitentes: Conectando, Escaneando N / M correos, Agrupando por remitente, Clasificando N / M remitentes, Eliminando, Dándose de baja y Listo (se desvanece), con botón **Cancelar**.
- **Eliminar en lugar de Mover** (sigue yendo a la Papelera y se puede recuperar). **Proteger** pasó a **Nunca eliminar** (guarda una regla; la fila muestra un candado y «Siempre se conserva», y el botón pasa a «Quitar regla»). Ajustes → Reglas lista los remitentes con regla y deja quitarlos.
- **«Darse de baja» ya no actúa al instante**: marca al remitente («Se dará de baja al ejecutar») y la baja se hace junto con **Eliminar**, solo a los marcados; en simulación se informa «se daría de baja» y no se envía nada. El interruptor de arriba ahora es «Marcar baja en todos los que se eliminen». Cada resultado sale en la terminal.
- **Google sin permiso de Gmail**: la página de retorno ofrece «Volver a intentar», que reinicia el flujo directo; antes de abrir Google se avisa «En Google marque la casilla de acceso a Gmail».

## 1.2.0

Actualización automática.

- **La app busca sola versiones nuevas** (a los 10 s de abrir y cada 4 horas, también minimizada en la bandeja) con `electron-updater`; el repositorio sale de `build.publish` de `package.json`. Instalador de Windows (NSIS) y AppImage: la descarga es en segundo plano; con la versión lista aparece el aviso «Versión X lista · Reiniciar ahora» y, si no, se instala al cerrar la aplicación. Nunca se reinicia con una sincronización, una limpieza o la descarga de un modelo en curso: espera a que terminen.
- **Portable y `.deb`** no pueden actualizarse solos: se consulta `releases/latest` de GitHub y el aviso «Versión X disponible · Descargar» abre el archivo que corresponde.
- **Ajustes → Sistema → Actualizaciones**: interruptor «Actualizar automáticamente» (encendido de fábrica; apagado, solo se avisa), versión instalada y «Buscar actualizaciones» con el resultado en una línea. Los fallos se registran y se envían como evento `error` de telemetría con contexto `actualizacion`; nunca abren avisos.
- Las versiones sin firma de código no se rechazan (no se define `publisherName`).
- **Versión**: el flujo de publicación ahora también sube `latest.yml` y su `.blockmap` (Windows) y `latest-linux.yml` (Linux), que citan los archivos con versión en el nombre. La versión anterior (1.1.1) no se actualiza sola: instale la 1.2.0 una vez a mano.
- Al cerrar se usa `app.quit()` en lugar de `app.exit()`, para que se emita `quit` y se instale la versión ya descargada.

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
