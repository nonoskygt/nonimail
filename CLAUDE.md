# NoniMail Tools: apps de código abierto

Aquí viven las apps de NoniMail Tools (MIT):

| Carpeta | Qué es | Probar |
|---|---|---|
| `escritorio/` | Windows, Linux y Mac. Electron con servidor local; IA local con Ollama | `cd escritorio && npm ci && npm test` |
| `android/` | Android. Kotlin/Compose, módulos `:core` y `:app`; IA en el teléfono con LiteRT-LM | CI de GitHub (`android.yml`) |
| `herramientas/banco.py` | Banco de 24 correos etiquetados para probar un modelo de IA | `OLLAMA_URL=… python3 herramientas/banco.py <modelo>` |

El servicio web (mt.nonosky.com) **no** está en este repositorio. Las apps solo hablan con él por HTTP: plan y suscripción, licencias, IA de Nonosky, tareas permanentes, telemetría, filtro colectivo, inicio de sesión y actualizaciones. Los contratos están en `SERVICIO.md` y en el código de cada app.

## Reglas de las apps
1. **Escritorio, Android y web hacen lo mismo.** Toda función o regla nueva se aplica en las dos apps en el mismo cambio, y se deja anotado lo que toque a la web.
2. **Interfaz en español con «usted»**, más inglés; nada de textos explicativos de relleno.
3. **Nada hardcodeado:** URLs, umbrales, modelos, prompts y presets van en `escritorio/config/defaults.json` y en `android/core/src/main/resources/.../defaults.json`, o en `gradle.properties`.
4. **IA:**
   - Solo se ofrecen modelos que el desarrollador ya probó con `herramientas/banco.py` y que aciertan todos los correos importantes. La app nunca prueba modelos en el equipo del usuario.
   - Modelo actual: escritorio `qwen3.5:2b` (Ollama), Android Gemma 4 E2B (LiteRT-LM).
   - Tres modos: «IA de este equipo», «IA de Nonosky (suscripción)» (`POST /api/ia/v1/clasificar`, remitente y asuntos, nunca el cuerpo) y «Sin IA». Si la IA falla (Ollama caído, 402/429/503, sin red), la limpieza sigue con reglas: nunca se corta por la IA.
   - El prompt es por categoría: el modelo responde una palabra (PERSONAL, TRANSACCION, SEGURIDAD, PROMOCION, BOLETIN, SOCIAL u OTRO) y la app la convierte en puntaje con `categoryScores`.
   - El modo de pensamiento queda apagado.
   - Usar al máximo el equipo: GPU si hay, y si no, todos los núcleos.
5. **Limpiar:**
   - Solo por días; no hay «últimos mensajes».
   - Fases: Conectando → Escaneando N / M correos → Agrupando por remitente → Clasificando N / M remitentes → Eliminando → Dándose de baja → Listo, con Cancelar.
   - Los remitentes del mismo dominio salen agrupados (con 2 o más): la fila del dominio conserva o elimina a todos y elegir uno aparte crea una excepción.
   - Cada remitente tiene:
     - **Conservar / Eliminar**, que guardan una regla (clave: correo o `@dominio`; la del remitente manda sobre la del dominio). Eliminar vence a las protecciones automáticas, también en contactos («Usted les escribe»);
     - casilla **Darse de baja**, si trae List-Unsubscribe;
     - **Quitar regla**, que devuelve la decisión al ruido y la dureza.
   - La dureza se muestra explícita: valor 0–100, Suave/Estricta y el ruido mínimo que se elimina.
   - La baja se hace al ejecutar, después de eliminar: one-click, luego correo por SMTP, luego enlace; solo https y nunca hacia la red local. En simulación no se envía nada.
   - Lo que se elimina va a la Papelera y sale de la lista.
   - Las reglas se sincronizan con la cuenta de la web (`SERVICIO.md`) si compró al menos una vez; sin sesión, sin servicio o sin compra (`404 requiere_compra`) quedan en el equipo y Ajustes lo explica. Ajustes tiene la tarjeta «Preferencias y sincronización» para crear la cuenta (correo válido o Google).
   - «Mantener funcionando en el servidor» (Limpiar y Sincronizar, suscripción): crea, cambia o borra la tarea con `/api/tareas`, con consentimiento explícito para guardar las credenciales cifradas; dureza nunca menor que `tareas.durezaMin` (30). Gmail con OAuth pide contraseña de aplicación para la tarea.
6. **Terminales en vivo:**
   - Limpiar: «CPU · lectura + heurística» e «IA · modelo».
   - Sincronizar: «Red · sincronización».
   - Arriba, el uso de RAM, CPU y GPU.
7. **Planes (gratis y suscripción):**
   - No hay pestaña de licencias. Ajustes tiene la sección «Planes» (plan actual, tabla de precios y qué incluye), visible para todos.
   - Las cuentas personales (dominios públicos) son gratis: ven la explicación de los planes en Ajustes, pero sin avisos ni bloqueos en Limpiar y Sincronizar.
   - Las cuentas de dominio propio ven «Iniciar sesión» (la cuenta de la web, que trae sola el plan y las licencias) y «Suscribirse». Sin cobertura escanean y simulan.
   - Abre la puerta una licencia `NMT1.` vigente (las ya vendidas siguen valiendo) o el comprobante de suscripción `NMTS1.` de `GET /api/plan`; los dos van firmados (Ed25519) y se verifican sin conexión. El plan se renueva al abrir y cada 12 h con sesión.
   - Precios, URL de suscripción y rutas del servicio van en `defaults.json` / `gradle.properties`; si hay red, manda la tabla de `/api/plan`.
8. **Sin asistente de configuración:** todo está en Ajustes y la app abre directo en sus pestañas. Solo pide de nuevo lo que se desconecta, como el inicio de sesión con Google.
9. **Gmail:** botón «Iniciar sesión con Google» de un toque (OAuth + XOAUTH2); la contraseña de aplicación queda como alternativa.
10. **Actualización automática** desde el punto fijo `https://mt.nonosky.com/actualizaciones/` (`SERVICIO.md`), con GitHub de respaldo:
    - Escritorio: electron-updater (provider `generic`, primer `build.publish`); portable y `.deb` leen `latest.json`.
    - Android: PackageInstaller; busca versión nueva al abrir y cada 12 h leyendo `latest.json`.
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
1. **Servicio (1.7.0):** `GET /api/plan` y `POST /api/suscripcion/cubrir` ya están en producción; faltan `POST /api/ia/v1/clasificar`, `/api/tareas` y el punto fijo `/actualizaciones/` (`latest*.yml`, `latest.json` y las redirecciones a GitHub, ver `SERVICIO.md`). Sin ellos las apps siguen con reglas, el interruptor de tareas da error claro y las actualizaciones van directo a GitHub.
2. **Probar en un teléfono real** el inicio de sesión con Google (en Android depende de que Google entregue el `id_token` con `openid email`), la baja, Planes, la IA de Nonosky y las tareas del servidor.
3. **Filtro colectivo en Android:** confirmar contra el servicio el cuerpo de las decisiones (`{install_id, app, version, decisiones}`) y la firma `NMTF1.`; se dedujeron del escritorio.
4. **Release `v1.7.0`:** etiquetar y revisar que traiga los archivos de Windows, Linux, Mac y Android, y que `https://mt.nonosky.com/actualizaciones/latest.yml` y `latest.json` ya apunten a la 1.7.0. Las apps 1.6.0 se actualizan desde GitHub como antes.
5. **Mac:** sale sin firma de Apple; la actualización automática en Mac necesita firma.
