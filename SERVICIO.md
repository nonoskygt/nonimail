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
