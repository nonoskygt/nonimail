# Plan — NoniMail Limpieza 2.0

Spec: `docs/superpowers/specs/2026-10-09-config-imap-lotes-design.md`. Ejecución en línea, en esta sesión.

1. **Base**
   - `package.json`, dependencias fijas, `lib/paths.js`.
   - `.gitignore`: `secrets.json`, `progress.json` y `config.json.bak*`.
2. **`lib/classify.js` + pruebas:** `parseFrom`, `compileRules` (vacío = nunca), `isProtected`, `looksLikeReply`,
   `isConversation`, `decide`, `htmlToText`, `shortSubj`.
3. **`lib/llm.js` + pruebas:**
   - `parseScore`, que debe ignorar "Puntaje (0-100)" del razonamiento.
   - `generate` con estado de error explícito, `listModels`, `testModel`.
4. **`lib/batches.js` + pruebas:** `makeWindows` (días UTC, del más nuevo al más viejo, cubre el rango completo sin huecos ni solapes), `ProgressStore`.
5. **`lib/config.js` + `lib/secrets.js` + pruebas:** valores por defecto, migración 1.x (respaldo `config.json.bak-*`), validación, `mergeKnown`, guardado atómico.
6. **`lib/mail/*` + pruebas de integración (hoodiecrow, smtp-server):** presets, OAuth contra un endpoint falso, `MailClient`, SMTP.
7. **`lib/engine.js` + prueba de integración:** `scan`, `execute` y `auto` por ventanas, guardia de conversación, dry-run, pausa y continuación, bajas (https y mailto).
8. **`server.js`:** rutas nuevas (settings, test, llm, oauth, jobs), SSE de progreso, 127.0.0.1, anti-CSRF. Fuera: Apps Script, `/api/start`, `/api/model`, `/api/trash-sender`.
9. **`public/index.html`:**
   - Slider de días, banner de continuar, barra de progreso por lote e indicador de cuenta.
   - Modal de Configuración: Cuenta, LLM, Limpieza y Servidor, con Probar conexión, Guardar, Conectar con Google y Probar LLM.
10. **Limpieza y docs:**
    - Borrar `gmail_bridge.example.gs` y su nota en `THIRD_PARTY_LICENSES.md`.
    - Actualizar `config.example.json` y el README (instalación, Google, contraseña de aplicación, IMAP, seguridad).
11. **Verificación:**
    - `npm test`.
    - App completa contra hoodiecrow en el navegador: configuración, escaneo de 1 año en lotes, Parar y Continuar, borrado real a la Papelera de prueba.
    - Medir el presupuesto de pensamiento con Ollama.
