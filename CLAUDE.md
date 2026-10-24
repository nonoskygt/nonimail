# NoniMail Tools: apps de código abierto

Aquí viven las apps de NoniMail Tools (MIT):

| Carpeta | Qué es | Probar |
|---|---|---|
| `escritorio/` | Windows, Linux y Mac. Electron con servidor local; IA local con Ollama | `cd escritorio && npm ci && npm test` |
| `android/` | Android. Kotlin/Compose, módulos `:core` y `:app`; IA en el teléfono con LiteRT-LM | CI de GitHub (`android.yml`) |
| `herramientas/banco.py` | Banco de 24 correos etiquetados para probar un modelo de IA | `OLLAMA_URL=… python3 herramientas/banco.py <modelo>` |

El servicio web (mt.nonosky.com) **no** está en este repositorio. Las apps solo hablan con él por HTTP: licencias, telemetría, filtro colectivo e inicio de sesión. Los contratos están en `SERVICIO.md` (cuenta, Google, reglas por remitente) y en el código de cada app.

## Reglas de las apps
1. **Escritorio, Android y web hacen lo mismo.** Toda función o regla nueva se aplica en las dos apps en el mismo cambio, y se deja anotado lo que toque a la web.
2. **Interfaz en español con «usted»**, más inglés; nada de textos explicativos de relleno.
3. **Nada hardcodeado:** URLs, umbrales, modelos, prompts y presets van en `escritorio/config/defaults.json` y en `android/core/src/main/resources/.../defaults.json`, o en `gradle.properties`.
4. **IA:**
   - Solo se ofrecen modelos que el desarrollador ya probó con `herramientas/banco.py` y que aciertan todos los correos importantes. La app nunca prueba modelos en el equipo del usuario.
   - Modelo actual: escritorio `qwen3.5:2b` (Ollama), Android Gemma 4 E2B (LiteRT-LM).
   - El prompt es por categoría: el modelo responde una palabra (PERSONAL, TRANSACCION, SEGURIDAD, PROMOCION, BOLETIN, SOCIAL u OTRO) y la app la convierte en puntaje con `categoryScores`.
   - El modo de pensamiento queda apagado.
   - Usar al máximo el equipo: GPU si hay, y si no, todos los núcleos.
5. **Limpiar:**
   - Solo por días; no hay «últimos mensajes».
   - Fases: Conectando → Escaneando N / M correos → Agrupando por remitente → Clasificando N / M remitentes → Eliminando → Dándose de baja → Listo, con Cancelar.
   - Cada remitente tiene:
     - casilla **Eliminar**, también en contactos («Usted les escribe»);
     - casilla **Darse de baja**, si trae List-Unsubscribe;
     - **Nunca eliminar**, que guarda una regla y bloquea la fila.
   - La baja se hace al ejecutar, después de eliminar: one-click, luego correo por SMTP, luego enlace; solo https y nunca hacia la red local. En simulación no se envía nada.
   - Lo que se elimina va a la Papelera y sale de la lista.
6. **Terminales en vivo:**
   - Limpiar: «CPU · lectura + heurística» e «IA · modelo».
   - Sincronizar: «Red · sincronización».
   - Arriba, el uso de RAM, CPU y GPU.
7. **Licencias:**
   - No hay pestaña de licencias.
   - Las cuentas personales (dominios públicos) son gratis y no ven nada de licencias ni precios.
   - Las cuentas de dominio propio ven «Iniciar sesión» (la cuenta de la web, que trae sola las licencias) y «Comprar licencia».
   - La licencia es una clave firmada (Ed25519) que se verifica sin conexión.
8. **Sin asistente de configuración:** todo está en Ajustes y la app abre directo en sus pestañas. Solo pide de nuevo lo que se desconecta, como el inicio de sesión con Google.
9. **Gmail:** botón «Iniciar sesión con Google» de un toque (OAuth + XOAUTH2); la contraseña de aplicación queda como alternativa.
10. **Actualización automática:**
    - Escritorio: electron-updater.
    - Android: PackageInstaller; busca versión nueva al abrir y cada 12 h.
11. **Pruebas proporcionadas:** solo lo que cambia y el riesgo real.
12. **Commits:** commit por ruta (nunca `git add -A`), nunca `push --force`.
13. **Secretos:** ninguno en el repo. El cliente OAuth de Google y la firma de Android son secretos de GitHub Actions.

## Versiones
- Escritorio y Android llevan **el mismo número de versión**: `escritorio/package.json` → `version` y `android/gradle.properties` → `nmt.versionName`.
- Una etiqueta `vX.Y.Z` compila todo y lo publica en un solo release de este repositorio, que es de donde se actualizan las apps:
  - `escritorio-release.yml`: Windows, Linux y Mac;
  - `android.yml`: APK firmado.
- Android no se compila en máquinas con poca memoria; para eso está el CI.

## Pendiente
1. **Android:**
   - mostrar el medidor de RAM/CPU/GPU encima de las terminales (`Operaciones.uso` y `motorIa` ya existen);
   - probar en un teléfono real el inicio de sesión con Google y la baja.
2. **Escritorio**, para igualar a Android:
   - casilla de eliminar también en contactos;
   - quitar de la lista lo eliminado;
   - medidor de RAM/CPU/GPU.
3. **Android:** falta el filtro colectivo (el escritorio ya lo tiene).
4. **Primera versión desde este repositorio** (`v1.6.0` para las dos apps):
   - igualar `escritorio/package.json` a 1.6.0;
   - etiquetar y revisar que el release traiga los archivos de Windows, Linux, Mac y Android.
5. **Mac:** sale sin firma de Apple; la actualización automática en Mac necesita firma.
