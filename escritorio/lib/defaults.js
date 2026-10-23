'use strict';
// Valores por defecto de config/defaults.json, leídos una sola vez. Los módulos los usan como
// respaldo cuando no reciben la configuración completa (pruebas, uso como biblioteca).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULTS_FILE = path.join(ROOT, 'config', 'defaults.json');
let cache = null;

function defaults() {
  if (!cache) cache = Object.freeze(JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8')));
  return cache;
}

// Valor anidado: get(obj, 'ollama.requestTimeoutMs')
function get(obj, dotted, fallback) {
  let cur = obj;
  for (const k of String(dotted).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(k in cur)) return fallback;
    cur = cur[k];
  }
  return cur === undefined ? fallback : cur;
}

// Primero la configuración recibida; si no trae la clave, la de defaults.json
const pick = (cfg, dotted) => get(cfg, dotted, get(defaults(), dotted));

module.exports = { ROOT, DEFAULTS_FILE, defaults, get, pick };
