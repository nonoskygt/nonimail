# Contrato con el servicio web (mt.nonosky.com)

El servicio no está en este repositorio. Esto es lo que las apps esperan de él. Todo va por HTTPS con JSON; las rutas con sesión llevan `Authorization: Bearer <access_token>`.

## Cuenta (ya existente)
- `POST /api/auth/acceder` `{email, password}` → `200 {access_token}` o `202 {codigo: true}` (correo nuevo: llega un código de 6 dígitos).
- `POST /api/auth/register-confirm` `{email, code, password}` → `200 {access_token}`.
- `POST /api/auth/password-reset-request` y `/password-reset-confirm`.
- `GET /api/licencias` → `{licencias: [{clave, estado}]}`.

## Inicio de sesión con Google (nuevo)
`POST /api/auth/google` `{id_token}` → `200 {access_token, email}`.
- Las apps piden a Google solo `openid email` (sin permiso de correo) y mandan el `id_token`.
- El servicio debe **verificar la firma** del `id_token` con los certificados de Google, comprobar `aud` (el cliente OAuth de la app), `exp` y `email_verified`, y abrir la cuenta de ese correo, creándola si no existe (sin contraseña).
- Si no está implementado responde `404`: las apps avisan «El servicio todavía no acepta Google; use correo y contraseña».

## Reglas por remitente (nuevo)
Las preferencias de Limpiar (qué remitentes y dominios conservar o eliminar) se sincronizan entre apps de la misma cuenta.

`GET /api/reglas-remitentes` → `200 {reglas: {<clave>: {regla, ts}}}`
`PUT /api/reglas-remitentes` `{reglas: {...}}` → `200 {reglas: {...}}` (el cuerpo completo ya fusionado)

- `<clave>`: correo del remitente en minúsculas, o `@dominio` (p. ej. `@tienda.com`) para todo un dominio. La regla del remitente es una excepción a la del dominio.
- `regla`: `protect` (conservar siempre), `delete` (eliminar siempre) o `none` (quitada; se guarda para que el borrado viaje).
- `ts`: milisegundos desde 1970 del último cambio.
- Fusión (la hacen las apps, el servicio solo guarda): por clave gana el `ts` mayor. El servicio puede aplicar la misma regla en el `PUT` si recibe una versión anterior.
- Una cuenta de la web guarda un único conjunto de reglas. Sin datos: `{reglas: {}}`.
- `401/403`: sesión vencida; `404/501`: sin servicio (las apps siguen en local sin mostrar error).

Escritorio: `escritorio/lib/reglas-sync.js`. Android: módulo `:core`, paquete `limpiar` (ver su CHANGELOG).

## Suscripción (1.7.0)
Precio por cuenta de correo y por mes o año; cada cuenta incluye limpiar y sincronizar. Las cuentas personales siguen gratis en las apps.

`GET /api/plan` → `200 {activa_en_servicio, precios, suscripcion, compro_alguna_vez, web_permitida, token}`
- `suscripcion`: `null` o `{estado, periodo, cantidad, cuentas: [correo], pagado_hasta, vigente, precio_por_cuenta, total}`.
- `token`: comprobante `NMTS1.<payload b64url>.<firma b64url>`, firmado con la misma llave Ed25519 que las licencias `NMT1.` (se verifica con `clave-publica.pem` sobre el texto `NMTS1.<payload>`). Payload: `{v: 1, uid, cuentas: [correo en minúsculas], periodo, iat, exp}` (segundos). Dura como mucho 7 días: las apps lo renuevan al abrir y cada 12 h, y lo guardan para trabajar sin conexión.
- `POST /api/suscripcion/cubrir` `{cuenta}` → `200 {cobertura}`: la cuenta ocupa un lugar libre (o ya lo tenía). `402` si no hay suscripción vigente o no quedan lugares. Después de un `200`, las apps piden `/api/plan` otra vez para tener el token con esa cuenta.
- Una cuenta de dominio propio puede ejecutar si tiene una licencia `NMT1.` vigente (las ya vendidas siguen valiendo) **o** si está en `cuentas` de un `NMTS1.` vigente. Si no, escanea y simula como siempre.
- `GET/PUT /api/reglas-remitentes` responden `404 {detail, codigo: "requiere_compra"}` a quien nunca compró: las reglas quedan en el equipo y Ajustes lo explica.
- Suscribirse, cambiar la cantidad o cancelar se hace en la web: `https://mt.nonosky.com/herramienta.html#suscripcion`.

## IA de Nonosky (1.7.0)
`POST /api/ia/v1/clasificar` `{items: [{id, from, subjects: [texto], bulk}]}` → `200 {modelo, resultados: [{id, categoria}]}`
- Hasta 50 ítems por pedido y 5 asuntos por ítem (200 caracteres cada uno). Nunca se manda el cuerpo del correo.
- `categoria`: `PERSONAL`, `TRANSACCION`, `SEGURIDAD`, `PROMOCION`, `BOLETIN`, `SOCIAL`, `OTRO` o `null` (sin respuesta). Las apps la convierten en puntaje con su `categoryScores`, igual que con la IA local.
- `402`: sin suscripción vigente. `429 {codigo: "tope_diario"}`: se pasó el tope diario por usuario. `503`: IA no disponible. En cualquiera de esos casos las apps siguen con reglas (heurística), sin cortar la limpieza.

## Tareas permanentes (1.7.0)
Limpieza que se repite sola y sincronización continua, en el servidor, aunque el equipo esté apagado. Solo con suscripción; la cuenta ocupa un lugar como al cubrirla.

`GET /api/tareas` → `{tareas: [Tarea]}`
`POST /api/tareas` → `201 Tarea`
```
{ tipo: "limpiar" | "sincronizar",
  cuenta:  {correo, host, puerto, usuario, password, tls},
  destino: {correo, host, puerto, usuario, password, tls}   // solo sincronizar
  cada_dias: 1 | 3 | 7 | 14 | 30,                           // solo limpiar
  dureza: 0-100,                                            // solo limpiar; ruido mínimo que se elimina
  consentimiento: true }                                    // obligatorio: guardar las credenciales cifradas
```
`PATCH /api/tareas/{id}` `{activa?, cada_dias?, dureza?, password?, password_destino?}` → `Tarea`
`DELETE /api/tareas/{id}` → `204` (borra también las credenciales)

`Tarea`: `{id, tipo, cuenta, destino, cada_dias, cada_minutos, dureza, estado: "activa" | "pausada" | "error", motivo, ultima_corrida, proxima_corrida, ultimo_resultado: {ok, resumen} | null}` (fechas ISO 8601).
- Sincronizar corre cada `cada_minutos` (15). Limpiar manda a la Papelera solo lo que supera la dureza, respeta las reglas por remitente de la cuenta web y nunca toca contactos ni conversaciones.
- `402`: sin suscripción o sin lugar para la cuenta. `400`: datos inválidos o falta el consentimiento. `422 {codigo: "credenciales"}`: no se pudo entrar a la cuenta al crearla.
- Gmail en el servidor va por IMAP con contraseña de aplicación (no por «Iniciar sesión con Google»).
- Si la suscripción vence, las tareas se pausan solas (`motivo: "suscripcion"`); si las credenciales fallan, se pausan y se avisa por correo.
