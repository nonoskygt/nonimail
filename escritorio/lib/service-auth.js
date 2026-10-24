'use strict';
// Sesión con el servicio web de NoniMail Tools (mt.nonosky.com). SOLO la piden las cuentas de dominio
// propio (comerciales): las personales no necesitan sesión. La sesión sirve para traer las licencias
// compradas; la puerta real sigue siendo la clave firmada que se valida sin conexión (lib/licenses).
// El token se guarda cifrado igual que los demás secretos (lib/secrets.js) y nunca llega a la interfaz.
const { esPersonal, esCorreo } = require('./licenses/domains');
const { t } = require('./i18n');

const PATHS = {
  login: '/api/auth/acceder',
  confirm: '/api/auth/register-confirm',
  resetRequest: '/api/auth/password-reset-request',
  resetConfirm: '/api/auth/password-reset-confirm',
  licenses: '/api/licencias',
  reglas: '/api/reglas-remitentes',
  google: '/api/auth/google',
};

const httpErr = (code, message) => Object.assign(new Error(message), { code });

// ¿Esta cuenta necesita sesión con el servicio? Solo las de dominio propio.
const requiereSesion = (email) => esCorreo(email) && !esPersonal(email);
// ¿Alguna de las cuentas la necesita?
const algunaRequiereSesion = (cuentas) => (cuentas || []).some(a => requiereSesion(a && a.email));

// Qué pestañas se pueden usar. Sincronizar y Limpiar esperan a una cuenta guardada y probada.
function pestanasActivas(cuentas) {
  const lista = Array.isArray(cuentas) ? cuentas : [];
  const hay = lista.some(a => a && a.ready);
  return { cuentas: true, sincronizar: hay, limpiar: hay, ajustes: true };
}

class ServiceAuth {
  // o: { getConfig(), secrets, licenses, log?, fetch? }
  constructor(o) {
    this.o = o;
    this.fetch = o.fetch || ((...a) => fetch(...a));
  }

  get cfg() { return this.o.getConfig(); }
  get token() { return this.o.secrets.get('serviceToken'); }
  status() { return { signedIn: !!this.token, email: this.o.secrets.get('serviceEmail') }; }

  async _call(method, path, { body, token } = {}) {
    const c = this.cfg;
    let r;
    try {
      r = await this.fetch(new URL(path, c.service.url), {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(c.service.timeoutMs),
      });
    } catch (_) { throw httpErr(502, t('auth.unreachable')); }
    let j = null;
    try { j = await r.json(); } catch (_) { /* sin cuerpo */ }
    return { status: r.status, ok: r.ok, body: j };
  }

  _fail(r) {
    if (r.status === 401 || r.status === 403) return httpErr(401, t('auth.badCredentials'));
    if (r.status === 429) return httpErr(429, t('auth.tooMany'));
    const d = r.body && (r.body.detail || r.body.error || r.body.message);
    return httpErr(r.status >= 400 && r.status < 500 ? 400 : 502, typeof d === 'string' && d ? d : t('auth.serviceError', { status: r.status }));
  }

  _need(email, password) {
    email = String(email || '').trim().toLowerCase();
    if (!esCorreo(email)) throw httpErr(400, t('auth.badEmail'));
    if (!String(password || '')) throw httpErr(400, t('auth.needPassword'));
    return email;
  }

  _store(email, token) {
    this.o.secrets.set({ serviceToken: token, serviceEmail: email });
  }

  // 200 → sesión abierta; 202 → el servicio mandó un código de 6 dígitos al correo (correo nuevo)
  async login(email, password) {
    email = this._need(email, password);
    const r = await this._call('POST', PATHS.login, { body: { email, password } });
    if (r.status === 202 || (r.ok && r.body && r.body.codigo)) return { codigo: true };
    if (!r.ok || !r.body || !r.body.access_token) throw this._fail(r);
    return this._open(email, r.body.access_token);
  }

  // Con Google: el servicio verifica el id_token y abre (o crea) la cuenta de ese correo, sin contraseña
  async loginGoogle(idToken, email) {
    const r = await this._call('POST', PATHS.google, { body: { id_token: idToken } });
    if (r.status === 404) throw httpErr(502, t('auth.googleUnavailable'));
    if (!r.ok || !r.body || !r.body.access_token) throw this._fail(r);
    return this._open(String((r.body.email || email) || '').toLowerCase(), r.body.access_token);
  }

  async confirm(email, code, password) {
    email = this._need(email, password);
    code = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw httpErr(400, t('auth.badCode'));
    const r = await this._call('POST', PATHS.confirm, { body: { email, code, password } });
    if (!r.ok || !r.body || !r.body.access_token) throw this._fail(r);
    return this._open(email, r.body.access_token);
  }

  async resetRequest(email) {
    email = String(email || '').trim().toLowerCase();
    if (!esCorreo(email)) throw httpErr(400, t('auth.badEmail'));
    const r = await this._call('POST', PATHS.resetRequest, { body: { email } });
    if (!r.ok) throw this._fail(r);
    return { ok: true };
  }

  async resetConfirm(email, code, password) {
    email = this._need(email, password);
    code = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) throw httpErr(400, t('auth.badCode'));
    const r = await this._call('POST', PATHS.resetConfirm, { body: { email, code, password } });
    if (!r.ok) throw this._fail(r);
    if (r.body && r.body.access_token) return this._open(email, r.body.access_token);
    return { ok: true };
  }

  async _open(email, token) {
    this._store(email, token);
    if (this.o.log) this.o.log.info(`servicio: sesión abierta (${email})`);
    let licencias = null;
    try { licencias = await this.syncLicenses(); } catch (e) { licencias = { error: e.message }; }
    return { signedIn: true, email, licencias };
  }

  logout() {
    this.o.secrets.set({ serviceToken: null, serviceEmail: null });
    if (this.o.log) this.o.log.info('servicio: sesión cerrada');
    return { signedIn: false, email: '' };
  }

  // Reglas por remitente del perfil en línea (lib/reglas-sync.js). Devuelve la respuesta cruda para que quien llama decida.
  async reglasRemitentes(method, body) {
    const token = this.token;
    if (!token) throw httpErr(401, t('auth.signedOut'));
    return this._call(method, PATHS.reglas, { token, body });
  }

  // Trae las licencias del usuario y las pasa por la verificación sin conexión de lib/licenses.
  // Una clave que no valida (firma, cuenta, vencida) no entra; nada se acepta solo porque el servicio lo diga.
  async syncLicenses() {
    const token = this.token;
    if (!token) throw httpErr(401, t('auth.signedOut'));
    const r = await this._call('GET', PATHS.licenses, { token });
    if (r.status === 401 || r.status === 403) { this.logout(); throw httpErr(401, t('auth.expiredSession')); }
    if (!r.ok) throw this._fail(r);
    const rows = r.body && Array.isArray(r.body.licencias) ? r.body.licencias : [];
    const out = { found: rows.length, imported: 0, skipped: 0, invalid: 0, errors: [] };
    for (const row of rows) {
      const clave = row && typeof row.clave === 'string' ? row.clave.trim() : '';
      const estado = String((row && row.estado) || '').toLowerCase();
      if (!clave || /anulad|revocad|cancelad/.test(estado)) { out.skipped++; continue; }
      const a = await this.o.licenses.add(clave, { online: false });
      if (a.ok) out.imported++; else { out.invalid++; out.errors.push(a.error); }
    }
    return out;
  }
}

module.exports = { ServiceAuth, requiereSesion, algunaRequiereSesion, pestanasActivas, PATHS };
