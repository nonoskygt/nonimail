'use strict';
// Licencias por cuenta. Una cuenta personal (Gmail, Hotmail…) es gratis. Una cuenta de dominio propio
// es uso comercial: Limpiar y Sincronizar se pueden SIMULAR siempre, pero ejecutar de verdad pide una
// licencia de esa cuenta para esa función (30 días), comprada en el servicio web.
//
// La clave va firmada con Ed25519 por el servicio y se valida aquí SIN conexión con la clave pública
// que trae la app (clave-publica.pem, o la de licenses.publicKeyFile en la configuración):
//   NMT1.<payload base64url>.<firma base64url>
//   payload = { v: 1, lid, cuenta, tipo: 'limpiar'|'sincronizar', canal: 'app'|'web', iat, exp }
// Las licencias del servicio web (canal "web") también valen en la app.
// Se guardan en <datos>/licenses.json.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('../jsonfile');
const { esPersonal, dominioDe } = require('./domains');
const { t } = require('../i18n');

const TIPOS = ['limpiar', 'sincronizar'];
const BUNDLED_KEY = path.join(__dirname, 'clave-publica.pem');
const b64 = (s) => Buffer.from(s, 'base64url');

class Licenses {
  // o: { file, getConfig(), fetch?, log? }
  constructor(o) {
    this.o = o; this.file = o.file;
    this.fetch = o.fetch || ((...a) => fetch(...a));
    const d = readJson(o.file, { keys: [] });
    this.keys = Array.isArray(d.keys) ? d.keys : [];
    this._pub = { file: null, key: null };
  }

  get cfg() { return this.o.getConfig(); }
  _save() { writeJsonAtomic(this.file, { keys: this.keys }, { mode: 0o600 }); }

  publicKey() {
    const file = this.cfg.licenses.publicKeyFile || BUNDLED_KEY;
    if (this._pub.file === file) return this._pub.key;
    let key = null;
    try { key = crypto.createPublicKey(fs.readFileSync(file)); }
    catch (e) { if (this.o.log) this.o.log.warn(`licencias: sin clave pública (${file}): ${e.message}`); }
    this._pub = { file, key };
    return key;
  }

  // Valida firma y forma; NO mira el vencimiento (eso lo decide quien pregunta)
  read(clave) {
    const partes = String(clave || '').trim().split('.');
    if (partes.length !== 3 || partes[0] !== 'NMT1') return { ok: false, error: t('lic.badFormat') };
    const pub = this.publicKey();
    if (!pub) return { ok: false, error: t('lic.noPublicKey') };
    let firmaOk = false;
    try { firmaOk = crypto.verify(null, Buffer.from(`${partes[0]}.${partes[1]}`), pub, b64(partes[2])); } catch (_) { firmaOk = false; }
    if (!firmaOk) return { ok: false, error: t('lic.badSignature') };
    let p;
    try { p = JSON.parse(b64(partes[1]).toString('utf8')); } catch (_) { return { ok: false, error: t('lic.damaged') }; }
    if (!p || p.v !== 1 || !p.cuenta || !TIPOS.includes(p.tipo) || !Number.isFinite(p.exp)) return { ok: false, error: t('lic.incomplete') };
    return { ok: true, payload: { ...p, cuenta: String(p.cuenta).trim().toLowerCase(), canal: p.canal === 'web' ? 'web' : 'app' } };
  }

  // Con internet se pregunta al servicio si la licencia fue anulada; sin internet basta la firma
  async checkOnline(clave) {
    const c = this.cfg;
    try {
      const r = await this.fetch(new URL(c.licenses.verifyPath, c.service.url), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave }), signal: AbortSignal.timeout(c.service.timeoutMs),
      });
      if (!r.ok) return null;
      const v = await r.json();
      return v && v.valida === false && v.motivo === 'anulada' ? 'anulada' : 'ok';
    } catch (_) { return null; }
  }

  async add(clave, { online = true } = {}) {
    clave = String(clave || '').trim();
    const r = this.read(clave);
    if (!r.ok) return r;
    const p = r.payload;
    if (p.exp * 1000 <= Date.now()) return { ok: false, error: t('lic.expired', { cuenta: p.cuenta }) };
    if (online && (await this.checkOnline(clave)) === 'anulada') return { ok: false, error: t('lic.revoked') };
    const lid = String(p.lid || crypto.createHash('sha256').update(clave).digest('hex').slice(0, 24));
    const row = { id: crypto.createHash('sha256').update(lid).digest('hex').slice(0, 12), lid, cuenta: p.cuenta, tipo: p.tipo, canal: p.canal, exp: p.exp, clave, addedAt: new Date().toISOString() };
    const i = this.keys.findIndex(k => k.lid === lid);
    if (i >= 0) this.keys[i] = row; else this.keys.push(row);
    this._save();
    return { ok: true, licencia: { id: row.id, cuenta: p.cuenta, tipo: p.tipo, canal: p.canal, vence: new Date(p.exp * 1000).toISOString() } };
  }

  list() {
    const now = Math.floor(Date.now() / 1000);
    return this.keys.slice().sort((a, b) => b.exp - a.exp)
      .map(k => ({ id: k.id, cuenta: k.cuenta, tipo: k.tipo, canal: k.canal, vence: new Date(k.exp * 1000).toISOString(), vigente: k.exp > now }));
  }

  remove(id) { const n = this.keys.length; this.keys = this.keys.filter(k => k.id !== id); if (this.keys.length !== n) this._save(); return n !== this.keys.length; }

  vigente(cuenta, tipo) {
    const now = Math.floor(Date.now() / 1000);
    // se vuelve a validar la firma: un licenses.json editado a mano no abre la puerta
    // y se compara con lo que dice la clave firmada, no con lo que dice la fila
    const ok = (k) => { const r = this.read(k.clave); return r.ok && r.payload.cuenta === cuenta && r.payload.tipo === tipo && r.payload.exp > now; };
    return this.keys.filter(k => k.cuenta === cuenta && k.tipo === tipo && k.exp > now && ok(k))
      .sort((a, b) => b.exp - a.exp)[0] || null;
  }

  // La puerta: ¿se puede ejecutar de verdad esta función con estas cuentas?
  //   { permitido, personal, cuenta, tipo, vence?, motivo?, comprar?, precio?, moneda? }
  gate(cuentas, tipo) {
    const lista = (Array.isArray(cuentas) ? cuentas : [cuentas]).map(c => String(c || '').trim().toLowerCase()).filter(Boolean);
    const comerciales = lista.filter(c => !esPersonal(c));
    if (!comerciales.length) return { permitido: true, personal: true, cuenta: lista[0] || '', tipo };
    for (const c of comerciales) {
      const k = this.vigente(c, tipo);
      if (k) return { permitido: true, personal: false, cuenta: c, tipo, vence: new Date(k.exp * 1000).toISOString(), canal: k.canal };
    }
    const cuenta = comerciales[0];
    const pr = this.cfg.licenses.prices;
    return {
      permitido: false, personal: false, cuenta, tipo, dominio: dominioDe(cuenta),
      motivo: t('lic.gateReason', { cuenta, dominio: dominioDe(cuenta) }),
      comprar: this.buyUrl(cuenta, tipo), precio: pr[tipo], moneda: pr.currency, dias: pr.days,
    };
  }

  buyUrl(cuenta, tipo) {
    const c = this.cfg;
    const u = new URL(c.licenses.buyPath, c.service.url);
    u.searchParams.set('cuenta', cuenta);
    u.searchParams.set('tipo', tipo);
    u.searchParams.set('canal', 'app');
    return u.toString();
  }
}

module.exports = { Licenses, TIPOS, BUNDLED_KEY };
