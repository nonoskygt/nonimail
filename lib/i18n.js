'use strict';
// Textos de la app en español (usted) e inglés. Los mismos archivos de locales/ los usa la interfaz.
// Idioma: el elegido en Ajustes; si no hay, el del sistema (español si empieza con "es", si no inglés).
const DICTS = { es: require('../locales/es.json'), en: require('../locales/en.json') };
const SUPPORTED = Object.keys(DICTS);

function systemLocale(env = process.env) {
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  const fromEnv = raw && !/^(C|POSIX)(\.|$)/i.test(raw) ? raw.split('.')[0].replace(/_/g, '-') : '';
  if (fromEnv) return fromEnv;
  try { return Intl.DateTimeFormat().resolvedOptions().locale || 'en'; } catch (_) { return 'en'; }
}

const fromLocale = (locale) => { const l = String(locale || '').toLowerCase().slice(0, 2); return SUPPORTED.includes(l) ? l : 'en'; };
const resolve = (configured, locale) => SUPPORTED.includes(configured) ? configured : fromLocale(locale || systemLocale());

let current = resolve(process.env.NMT_LANGUAGE, systemLocale());

function setLanguage(lang) { if (SUPPORTED.includes(lang)) current = lang; return current; }
function language() { return current; }

function t(key, params, lang = current) {
  const d = DICTS[lang] || DICTS.en;
  const s = d[key] ?? DICTS.es[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params && params[k] != null ? String(params[k]) : m)) : s;
}

// Error con texto traducido (y código HTTP opcional para la API)
function err(key, params, extra) { return Object.assign(new Error(t(key, params)), { i18nKey: key }, extra || {}); }

module.exports = { t, err, setLanguage, language, resolve, fromLocale, systemLocale, SUPPORTED, DICTS };
