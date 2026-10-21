'use strict';
// Tacha de un texto (mensaje o pila de un error) lo que nunca debe salir de la PC:
// contraseñas, tokens, claves de licencia, direcciones de correo de terceros y la carpeta del usuario.
const os = require('os');

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const KEY_NAMES = '(?:pass(?:word|wd)?|pwd|contrase(?:ñ|n)a|clave|secret|client_secret|(?:access|refresh|id)_?token|token|api[_-]?key|authorization|auth|cookie)';
const SECRET_QUOTED = new RegExp(`(["']${KEY_NAMES}["']\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi');
const SECRET_KV = /(\b(?:pass(?:word|wd)?|pwd|contrase(?:ñ|n)a|clave|secret|client_secret|(?:access|refresh|id)_?token|token|api[_-]?key|authorization|auth|cookie)\b)(\s*["']?\s*[:=]\s*["']?)(?!\[oculto\])([^\s"',;&}\])]+)/gi;
const RULES = [
  [/\bNMT1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, 'NMT1.[clave]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [token]'],
  [/\bya29\.[A-Za-z0-9._-]+/g, '[token]'],
  [/\b1\/\/[A-Za-z0-9._-]+/g, '[token]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[token]'],
  [SECRET_QUOTED, '$1"[oculto]"'],
  [SECRET_KV, '$1$2[oculto]'],
  // cadenas largas tipo token (base64url o hex) con letras y números; las rutas de la pila no entran
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[token]'],
  [/(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40,}={0,2}/g, '[token]'],
];

function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// keep: direcciones que sí pueden ir (las cuentas del propio usuario)
// emails: false deja las direcciones (registro local)
function scrub(text, { keep = [], home = os.homedir(), emails = true } = {}) {
  let s = String(text == null ? '' : text);
  if (home && home.length > 2) s = s.replace(new RegExp(escapeRx(home), 'gi'), '~');
  for (const [rx, rep] of RULES) s = s.replace(rx, rep);
  if (!emails) return s;
  const allowed = new Set(keep.map(e => String(e || '').toLowerCase()).filter(Boolean));
  s = s.replace(EMAIL, (m) => (allowed.has(m.toLowerCase()) ? m : '[correo]'));
  return s;
}

module.exports = { scrub };
