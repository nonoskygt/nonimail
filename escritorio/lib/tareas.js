'use strict';
// Tareas permanentes en el servidor (suscripción): la limpieza que se repite cada N días y la sincronización
// continua, aunque este equipo esté apagado. Contrato en SERVICIO.md («Tareas permanentes»).
//   GET /api/tareas · POST /api/tareas · PATCH /api/tareas/{id} · DELETE /api/tareas/{id}
// Guardar las credenciales en el servidor necesita el consentimiento explícito de la persona (consentimiento: true).
// Gmail con «Iniciar sesión con Google» no sirve en el servidor: para la tarea se pide una contraseña de aplicación.
const { t } = require('./i18n');

const httpErr = (code, message) => Object.assign(new Error(message), { code });

// Cuenta guardada → lo que el servidor necesita para entrar por IMAP. pass: contraseña (la guardada o la nueva).
function cuentaServidor(a, pass, presets) {
  if (!pass) throw httpErr(400, a.type === 'imap' ? t('acct.missingPassword') : t('tareas.needAppPassword'));
  const imap = a.type === 'imap' ? a.imap : presets.gmail.imap;
  return { correo: a.email, host: imap.host, puerto: imap.port, usuario: a.type === 'imap' ? (a.username || a.email) : a.email, password: pass, tls: !!imap.secure };
}

// La dureza de la limpieza automática nunca baja del mínimo (el servidor tampoco lo acepta)
const durezaServidor = (d, cfg) => Math.max(cfg.tareas.durezaMin, Math.min(100, Math.round(Number(d))));

// Una tarea se reconoce por tipo + cuenta (+ destino en sincronizar)
function buscar(tareas, { tipo, cuenta, destino }) {
  const low = (x) => String(x || '').toLowerCase();
  return (tareas || []).find(x => x && x.tipo === tipo && low(x.cuenta && x.cuenta.correo) === low(cuenta)
    && (tipo !== 'sincronizar' || !destino || low(x.destino && x.destino.correo) === low(destino))) || null;
}

class Tareas {
  // o: { getConfig(), auth (ServiceAuth) }
  constructor(o) { this.o = o; }
  get cfg() { return this.o.getConfig(); }
  get path() { return this.cfg.tareas.path; }

  _fail(r) {
    const b = r.body || {};
    const d = typeof b.detail === 'string' ? b.detail : (b.detail && b.detail.detail) || b.error || '';
    const codigo = b.codigo || (b.detail && b.detail.codigo);
    if (r.status === 401 || r.status === 403) return httpErr(401, t('auth.expiredSession'));
    if (r.status === 402) return httpErr(402, t('tareas.err.402'));
    if (r.status === 409) return httpErr(409, t('tareas.err.409'));
    if (r.status === 422 || codigo === 'credenciales') return httpErr(422, t('tareas.err.422'));
    if (r.status === 404 || r.status === 501) return httpErr(503, t('tareas.err.noService'));
    if (r.status === 400) return httpErr(400, d || t('tareas.err.400'));
    return httpErr(502, d || t('auth.serviceError', { status: r.status }));
  }

  async list() {
    const r = await this.o.auth.call('GET', this.path);
    if (!r.ok) throw this._fail(r);
    return Array.isArray(r.body && r.body.tareas) ? r.body.tareas : [];
  }

  async create(body) {
    const r = await this.o.auth.call('POST', this.path, { ...body, consentimiento: true });
    if (!r.ok) throw this._fail(r);
    return r.body;
  }

  async patch(id, cambios) {
    const r = await this.o.auth.call('PATCH', `${this.path}/${encodeURIComponent(id)}`, cambios);
    if (!r.ok) throw this._fail(r);
    return r.body;
  }

  async remove(id) {
    const r = await this.o.auth.call('DELETE', `${this.path}/${encodeURIComponent(id)}`);
    if (!r.ok && r.status !== 404) throw this._fail(r);
    return { ok: true };
  }
}

module.exports = { Tareas, cuentaServidor, durezaServidor, buscar };
