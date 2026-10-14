'use strict';
// Secretos en un archivo aparte (secrets.json, fuera de git). Nunca se mandan al navegador.
const { readJson, writeJsonAtomic } = require('./jsonfile');

const KEYS = ['imapPassword', 'googleClientSecret', 'googleRefreshToken'];

class Secrets {
  constructor(file) { this.file = file; this.data = readJson(file, {}); }
  get(k) { return this.data[k] || ''; }
  // valor vacío = no tocar; null = borrar
  set(patch) {
    let changed = false;
    for (const k of KEYS) {
      if (!patch || !(k in patch)) continue;
      const v = patch[k];
      if (v === null) { if (this.data[k]) { delete this.data[k]; changed = true; } }
      else if (typeof v === 'string' && v.trim()) { this.data[k] = v.trim(); changed = true; }
    }
    if (changed) writeJsonAtomic(this.file, this.data, { mode: 0o600 });
    return changed;
  }
  status() {
    return {
      hasImapPassword: !!this.data.imapPassword,
      hasGoogleClientSecret: !!this.data.googleClientSecret,
      googleConnected: !!this.data.googleRefreshToken,
    };
  }
}

module.exports = { Secrets, KEYS };
