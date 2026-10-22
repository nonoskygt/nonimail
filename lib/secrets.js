'use strict';
// Secretos en un archivo aparte (secrets.json en la carpeta de datos). Nunca se mandan a la interfaz.
// - App de escritorio: cada valor va cifrado con safeStorage de Electron (DPAPI en Windows,
//   el llavero del sistema en Linux). El archivo dice "enc": "safeStorage".
// - Sin Electron (npm start) o si el sistema no ofrece llavero: texto plano con permisos 0600,
//   en la carpeta de datos del usuario. "enc": "none".
// Formato 2: { v: 2, enc, global: { googleClientSecret }, accounts: { <id>: { imapPassword, googleRefreshToken } } }
// El formato 1 (2.0) era plano: { imapPassword, googleClientSecret, googleRefreshToken }.
const { readJson, writeJsonAtomic } = require('./jsonfile');

const KEYS = ['imapPassword', 'googleClientSecret', 'googleRefreshToken', 'serviceToken', 'serviceEmail'];
const ACCOUNT_KEYS = ['imapPassword', 'googleRefreshToken'];

// cipher: { available(): bool, encrypt(string) → Buffer, decrypt(Buffer) → string } (safeStorage)
class Secrets {
  constructor(file, { cipher = null, log = null } = {}) {
    this.file = file; this.cipher = cipher; this.log = log;
    this.global = {}; this.accounts = {}; this.legacy = null; this.unreadable = false;
    this._load(readJson(file, {}));
  }

  get encrypted() { return !!(this.cipher && this.cipher.available()); }

  _load(raw) {
    if (!raw || typeof raw !== 'object') return;
    if (raw.v !== 2) { // formato 1: se asigna a la cuenta migrada con adoptLegacy()
      const flat = {}; for (const k of KEYS) if (typeof raw[k] === 'string' && raw[k]) flat[k] = raw[k];
      if (flat.googleClientSecret) this.global.googleClientSecret = flat.googleClientSecret;
      const acc = {}; for (const k of ACCOUNT_KEYS) if (flat[k]) acc[k] = flat[k];
      if (Object.keys(acc).length) this.legacy = acc;
      return;
    }
    const dec = (v) => {
      if (raw.enc !== 'safeStorage') return v;
      if (!this.encrypted) { this.unreadable = true; return ''; }
      try { return this.cipher.decrypt(Buffer.from(v, 'base64')); } catch (_) { this.unreadable = true; return ''; }
    };
    for (const [k, v] of Object.entries(raw.global || {})) if (KEYS.includes(k) && v) { const d = dec(v); if (d) this.global[k] = d; }
    for (const [id, o] of Object.entries(raw.accounts || {})) {
      const acc = {};
      for (const [k, v] of Object.entries(o || {})) if (ACCOUNT_KEYS.includes(k) && v) { const d = dec(v); if (d) acc[k] = d; }
      if (Object.keys(acc).length) this.accounts[id] = acc;
    }
    if (this.unreadable && this.log) this.log.warn('secrets: hay valores cifrados que este proceso no puede leer (¿sin llavero del sistema?)');
  }

  _save() {
    const enc = this.encrypted;
    const put = (v) => (enc ? this.cipher.encrypt(v).toString('base64') : v);
    const out = { v: 2, enc: enc ? 'safeStorage' : 'none', global: {}, accounts: {} };
    for (const [k, v] of Object.entries(this.global)) out.global[k] = put(v);
    for (const [id, o] of Object.entries(this.accounts)) { out.accounts[id] = {}; for (const [k, v] of Object.entries(o)) out.accounts[id][k] = put(v); }
    writeJsonAtomic(this.file, out, { mode: 0o600 });
  }

  // La cuenta que vino de la 2.0 hereda la contraseña y el token del formato plano
  adoptLegacy(accountId) {
    if (!this.legacy || !accountId) return false;
    this.accounts[accountId] = { ...this.legacy, ...(this.accounts[accountId] || {}) };
    this.legacy = null; this._save(); return true;
  }

  // Si la app de escritorio ya tiene llavero y el archivo está en texto plano, se cifra
  upgrade() { if (this.encrypted && readJson(this.file, {}).enc !== 'safeStorage' && (Object.keys(this.global).length || Object.keys(this.accounts).length)) this._save(); }

  // ----- globales (Client Secret de Google) -----
  get(k) { return this.global[k] || ''; }
  // valor vacío = no tocar; null = borrar
  set(patch) {
    let changed = false;
    for (const k of KEYS) {
      if (!patch || !(k in patch)) continue;
      const v = patch[k];
      if (v === null) { if (this.global[k]) { delete this.global[k]; changed = true; } }
      else if (typeof v === 'string' && v.trim()) { this.global[k] = v.trim(); changed = true; }
    }
    if (changed) this._save();
    return changed;
  }
  status() {
    return {
      hasImapPassword: !!this.global.imapPassword,
      hasGoogleClientSecret: !!this.global.googleClientSecret,
      googleConnected: !!this.global.googleRefreshToken,
      serviceSignedIn: !!this.global.serviceToken,
    };
  }

  // ----- por cuenta -----
  setAccount(id, patch) {
    const cur = { ...(this.accounts[id] || {}) }; let changed = false;
    for (const k of ACCOUNT_KEYS) {
      if (!patch || !(k in patch)) continue;
      const v = patch[k];
      if (v === null) { if (cur[k]) { delete cur[k]; changed = true; } }
      else if (typeof v === 'string' && v.trim()) { cur[k] = v.trim(); changed = true; }
    }
    if (changed) { if (Object.keys(cur).length) this.accounts[id] = cur; else delete this.accounts[id]; this._save(); }
    return changed;
  }
  removeAccount(id) { if (this.accounts[id]) { delete this.accounts[id]; this._save(); } }
  // { get(k) } para connectionOptions(): primero la cuenta, después lo global
  scope(id) { const acc = () => this.accounts[id] || {}; return { get: (k) => acc()[k] || this.global[k] || '' }; }
  accountStatus(id) { const a = this.accounts[id] || {}; return { hasPassword: !!a.imapPassword, googleConnected: !!a.googleRefreshToken }; }
}

module.exports = { Secrets, KEYS, ACCOUNT_KEYS };
