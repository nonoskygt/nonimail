'use strict';
// Configuración en tres capas (sin secretos):
//   1. config/defaults.json         valores por defecto (se actualizan con cada versión)
//   2. <datos>/config.json          solo lo que la persona cambió (se guarda como diferencia)
//   3. variables de entorno NMT_*   ganan sobre todo, nunca se escriben en disco
// Además migra los formatos viejos: 1.x (Apps Script) y 2.0 (una sola cuenta en "account").
const fs = require('fs');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { compileRules } = require('./classify');
const { defaults: loadDefaults } = require('./defaults');
const { t } = require('./i18n');

const ACCOUNT_TYPES = ['gmail-oauth', 'gmail-password', 'imap'];
const MODES = ['auto', 'claro', 'oscuro'];
const ACCENTS = ['carmesi', 'verde-azulado', 'violeta', 'azul', 'ambar', 'verde'];
const ACCOUNT_DEFAULT = {
  id: '', type: 'imap', email: '', username: '', provider: 'custom',
  imap: { host: '', port: 993, secure: true },
  smtp: { host: '', port: 465, secure: true },
  inboxFolder: 'INBOX', trashFolder: '',
};

// Variables de entorno → ruta en la configuración y tipo
const ENV_MAP = {
  NMT_LANGUAGE: ['language', 'string'],
  NMT_HOST: ['host', 'string'],
  NMT_PORT: ['port', 'int'],
  NMT_SERVICE_URL: ['service.url', 'string'],
  NMT_SERVICE_TIMEOUT_MS: ['service.timeoutMs', 'int'],
  NMT_OLLAMA_URL: ['ollamaUrl', 'string'],
  NMT_MODEL: ['model', 'string'],
  NMT_OLLAMA_INSTALLER_WINDOWS: ['ollama.installer.windows', 'string'],
  NMT_OLLAMA_INSTALLER_LINUX: ['ollama.installer.linux', 'string'],
  NMT_GOOGLE_CLIENT_ID: ['google.clientId', 'string'],
  NMT_GOOGLE_CLIENT_SECRET: ['google.clientSecret', 'string'],
  NMT_GOOGLE_AUTH_URL: ['google.authUrl', 'string'],
  NMT_GOOGLE_TOKEN_URL: ['google.tokenUrl', 'string'],
  NMT_GOOGLE_REVOKE_URL: ['google.revokeUrl', 'string'],
  NONIMAIL_GOOGLE_TOKEN_URL: ['google.tokenUrl', 'string'],   // nombre de la 2.0
  NONIMAIL_GOOGLE_REVOKE_URL: ['google.revokeUrl', 'string'], // nombre de la 2.0
  NMT_TELEMETRY: ['telemetry.enabled', 'bool'],
  NMT_FILTRO: ['filtro.compartir', 'bool'],
  NMT_FILTRO_REPUTACION: ['filtro.reputacion', 'bool'],
  NMT_TELEMETRY_FLUSH_MS: ['telemetry.flushIntervalMs', 'int'],
  NMT_LICENSE_PUBLIC_KEY: ['licenses.publicKeyFile', 'string'],
  NMT_IMAP_TIMEOUT_MS: ['imap.socketTimeoutMs', 'int'],
  NMT_OLLAMA_TIMEOUT_MS: ['ollama.requestTimeoutMs', 'int'],
};

// Lo que se edita desde Ajustes. Cuentas, reglas y configurador tienen su propia ruta en la API.
const SETTINGS_PATHS = ['language', 'closeAction', 'appearance.mode', 'appearance.accent', 'port', 'service.url', 'ollamaUrl', 'model', 'google.clientId', 'llm', 'cleaning', 'telemetry.enabled', 'filtro.compartir'];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Modelos que ofrecieron versiones anteriores y se retiraron por no pasar nuestras pruebas
const RETIRED_MODELS = ['qwen3.5:4b', 'qwen3.5:9b'];

function getPath(obj, dotted) { let c = obj; for (const k of dotted.split('.')) { if (!isObj(c) || !(k in c)) return undefined; c = c[k]; } return c; }
function setPath(obj, dotted, value) {
  const ks = dotted.split('.'); let c = obj;
  for (const k of ks.slice(0, -1)) { if (!isObj(c[k])) c[k] = {}; c = c[k]; }
  c[ks[ks.length - 1]] = value;
}
function pickShape(src, paths) { const out = {}; for (const p of paths) setPath(out, p, clone(getPath(src, p))); return out; }

// Copia de patch sobre target SOLO de las claves que existen en shape, convirtiendo al tipo de shape
function mergeKnown(shape, target, patch) {
  const out = clone(target);
  if (!isObj(patch)) return out;
  for (const k of Object.keys(shape)) {
    if (!(k in patch)) continue;
    const s = shape[k], v = patch[k];
    if (isObj(s)) out[k] = mergeKnown(s, isObj(out[k]) ? out[k] : clone(s), v);
    else if (Array.isArray(s)) out[k] = (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(x => String(x).trim()).filter(Boolean);
    else if (typeof s === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
    else if (typeof s === 'boolean') out[k] = v === true || v === 'true' || v === 1 || v === 'on';
    else out[k] = String(v ?? '').trim();
  }
  return out;
}

function deepDefaults(defaults, value) {
  if (!isObj(defaults)) return value === undefined ? clone(defaults) : value;
  const v = isObj(value) ? value : {}, out = {};
  for (const k of Object.keys(defaults)) out[k] = deepDefaults(defaults[k], v[k]); // orden estable de las claves
  for (const k of Object.keys(v)) if (!(k in out)) out[k] = v[k];
  return out;
}

// Solo lo que difiere de los valores por defecto
function diff(defaults, obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    const a = obj[k], b = defaults ? defaults[k] : undefined;
    if (isObj(a) && isObj(b)) { const d = diff(b, a); if (Object.keys(d).length) out[k] = d; }
    else if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = clone(a);
  }
  return out;
}

function envOverrides(env = process.env) {
  const out = {}, locked = [];
  for (const [name, [p, type]] of Object.entries(ENV_MAP)) {
    const raw = env[name];
    if (raw == null || raw === '') continue;
    let v = raw;
    if (type === 'int') { v = parseInt(raw, 10); if (!Number.isFinite(v)) continue; }
    else if (type === 'bool') v = /^(1|true|on|yes|si|sí)$/i.test(raw);
    setPath(out, p, v);
    if (!locked.includes(p)) locked.push(p);
  }
  // un archivo extra (administradores): NMT_CONFIG_FILE=/ruta/a/overrides.json
  if (env.NMT_CONFIG_FILE) {
    const extra = readJson(env.NMT_CONFIG_FILE, null);
    if (isObj(extra)) return { out: deepDefaults(extra, out), locked, extra };
  }
  return { out, locked, extra: null };
}

// ---------- migraciones ----------
// 1.x: claves sueltas, "defaults" y el puente de Apps Script (eliminado en 2.0)
function isLegacy(raw) {
  return isObj(raw) && ('gmailBridge' in raw || 'gmailKey' in raw || 'defaults' in raw || 'models' in raw || 'myAddresses' in raw);
}
function migrate(raw) {
  const out = {};
  for (const k of ['port', 'ollamaUrl', 'model', 'heuristics', 'llmPrompt']) if (k in raw) out[k] = raw[k];
  out.cleaning = {};
  if ('protectConversations' in raw) out.cleaning.protectConversations = raw.protectConversations;
  if (Array.isArray(raw.myAddresses)) out.cleaning.myAddresses = raw.myAddresses;
  if (raw.defaults && raw.defaults.bodyMaxChars) out.cleaning.bodyMaxChars = raw.defaults.bodyMaxChars;
  return out;
}
const newAccountId = () => 'a' + crypto.randomBytes(5).toString('hex');

// 2.0: una cuenta en "account" → lista "accounts"; el prompt viejo (con "vos") se reemplaza por el nuevo
function migrate20(raw) {
  const out = clone(raw);
  let legacyAccountId = null;
  if (isObj(out.account)) {
    const a = out.account;
    if (a.type && a.type !== 'none') {
      legacyAccountId = newAccountId();
      out.accounts = [deepDefaults(ACCOUNT_DEFAULT, { ...a, id: legacyAccountId })];
      out.activeAccount = legacyAccountId;
      out.setup = { done: true };
    }
    delete out.account;
  }
  if (typeof out.llmPrompt === 'string' && /^(Sos|Usted es) un asistente que limpia la bandeja/.test(out.llmPrompt)) delete out.llmPrompt; // prompts viejos de puntaje → el de categorías
  if (out.model === '') delete out.model;
  if (RETIRED_MODELS.includes(out.model)) delete out.model; // modelos que ya no se ofrecen → el de fábrica
  return { raw: out, legacyAccountId };
}

// ---------- almacén ----------
class ConfigStore {
  // { file, env, defaults }
  constructor({ file, env = process.env, defaults = loadDefaults() }) {
    this.file = file; this.env = env; this.defaults = clone(defaults);
    this.created = false; this.migratedFrom = null; this.legacyAccountId = null;
    let raw = readJson(file, null);
    if (!isObj(raw)) { raw = {}; this.created = true; }
    if (isLegacy(raw)) {
      this.migratedFrom = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
      fs.copyFileSync(file, this.migratedFrom);
      raw = migrate(raw);
    }
    if ('account' in raw) {
      if (!this.migratedFrom) { this.migratedFrom = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`; try { fs.copyFileSync(file, this.migratedFrom); } catch (_) { this.migratedFrom = null; } }
      const m = migrate20(raw); raw = m.raw; this.legacyAccountId = m.legacyAccountId;
    }
    this.user = diff(this.defaults, raw);
    this._compute();
    if (this.migratedFrom) this._write();
  }

  _compute() {
    const env = envOverrides(this.env);
    this.locked = env.locked;
    const withUser = deepDefaults(this.defaults, this.user);
    const cfg = deepDefaults(withUser, {});
    for (const [k, v] of Object.entries(env.out)) cfg[k] = isObj(v) && isObj(cfg[k]) ? deepDefaults(cfg[k], v) : v;
    // Las protecciones y el prompt vacíos salen de los valores por defecto: nunca se quedan sin protección
    if (!String(cfg.llmPrompt || '').trim()) cfg.llmPrompt = this.defaults.llmPrompt;
    for (const k of ['keepOverride']) if (!String((cfg.heuristics || {})[k] || '').trim()) cfg.heuristics[k] = this.defaults.heuristics[k];
    cfg.accounts = (Array.isArray(cfg.accounts) ? cfg.accounts : []).map(a => deepDefaults(ACCOUNT_DEFAULT, a));
    this.cfg = cfg;
  }

  get() { return this.cfg; }

  // next = configuración efectiva completa (o parcial) a guardar. Lo que viene del entorno no se escribe.
  save(next) {
    const merged = deepDefaults(this.cfg, next);
    for (const p of this.locked) {
      const prev = getPath(deepDefaults(this.defaults, this.user), p);
      setPath(merged, p, clone(prev));
    }
    this.user = diff(this.defaults, merged);
    this._write();
    this._compute();
    return this.cfg;
  }

  patch(dotted, value) { const next = clone(this.cfg); setPath(next, dotted, value); return this.save(next); }
  _write() { writeJsonAtomic(this.file, this.user); }
}

// ---------- validación ----------
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validate(cfg) {
  const e = [];
  const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) e.push(t('val.int', { name, lo, hi })); };
  int(cfg.port, 0, 65535, t('field.port'));
  if (cfg.port > 0 && cfg.port < 1024) e.push(t('val.int', { name: t('field.port'), lo: 1024, hi: 65535 }));
  if (!/^https?:\/\/[^\s]+$/i.test(cfg.ollamaUrl)) e.push(t('val.ollamaUrl'));
  if (!/^https?:\/\/[^\s/]+/i.test(String((cfg.service || {}).url || ''))) e.push(t('val.serviceUrl'));
  if (cfg.language && !['es', 'en'].includes(cfg.language)) e.push(t('val.language'));
  if (cfg.closeAction && !['ask', 'minimize', 'quit'].includes(cfg.closeAction)) e.push(t('val.closeAction'));
  const ap = cfg.appearance || {};
  if (ap.mode && !MODES.includes(ap.mode)) e.push(t('val.mode'));
  if (ap.accent && !ACCENTS.includes(ap.accent)) e.push(t('val.accent'));
  const L = cfg.llm;
  int(L.numCtx, 512, 262144, t('field.numCtx')); int(L.parallel, 1, 8, t('field.parallel'));
  int(L.thinkNumPredict, 64, 32768, t('field.thinkNumPredict')); int(L.thinkNumCtx, 512, 262144, t('field.thinkNumCtx'));
  int(L.doubtLow, 0, 100, t('field.doubtLow')); int(L.doubtHigh, 0, 100, t('field.doubtHigh'));
  if (L.doubtLow >= L.doubtHigh) e.push(t('val.doubtRange'));
  const C = cfg.cleaning;
  int(C.daysBack, 0, 36500, t('field.daysBack')); int(C.windowDays, 1, 3650, t('field.windowDays'));
  int(C.fetchChunk, 10, 1000, t('field.fetchChunk')); int(C.dureza, 0, 100, t('field.dureza'));
  int(C.band, 0, 50, t('field.band')); int(C.bodyMaxChars, 100, 50000, t('field.bodyMaxChars'));
  for (const m of C.myAddresses) if (!EMAIL.test(m)) e.push(t('val.myAddress', { value: m }));
  try { compileRules(cfg.heuristics); } catch (err) { e.push(t('val.rule', { error: err.message })); }
  for (const a of cfg.accounts || []) e.push(...validateAccount(a));
  return e;
}

function validateAccount(a) {
  const e = [];
  const int = (v, lo, hi, name) => { if (!Number.isInteger(v) || v < lo || v > hi) e.push(t('val.int', { name, lo, hi })); };
  if (!ACCOUNT_TYPES.includes(a.type)) e.push(t('val.accountType', { value: a.type }));
  if (!EMAIL.test(a.email || '')) e.push(t('val.accountEmail'));
  if (a.type === 'imap' && !a.imap.host) e.push(t('val.imapHost'));
  int(a.imap.port, 1, 65535, t('field.imapPort'));
  int(a.smtp.port, 1, 65535, t('field.smtpPort'));
  if (!a.inboxFolder) e.push(t('val.inboxFolder'));
  return e;
}

module.exports = {
  ConfigStore, ACCOUNT_TYPES, ACCOUNT_DEFAULT, MODES, ACCENTS, ENV_MAP, SETTINGS_PATHS,
  mergeKnown, deepDefaults, diff, migrate, migrate20, isLegacy, envOverrides, validate, validateAccount,
  pickShape, getPath, setPath, newAccountId, clone,
};
