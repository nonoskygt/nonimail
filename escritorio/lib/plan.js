'use strict';
// Plan de la cuenta de la web (mt.nonosky.com): suscripción, precios y el comprobante NMTS1 que abre la
// puerta de las cuentas de dominio propio sin conexión (lo verifica lib/licenses).
//   GET  /api/plan               → { activa_en_servicio, precios, suscripcion, compro_alguna_vez, web_permitida, token }
//   POST /api/suscripcion/cubrir → la cuenta ocupa un lugar libre de la suscripción (402 si no hay)
// Se renueva al abrir y cada plan.refreshMs (12 h) con sesión iniciada, y se guarda en <datos>/plan.json
// para trabajar sin conexión (el comprobante dura como mucho 7 días).
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { esPersonal, esCorreo } = require('./licenses/domains');

class PlanSync {
  // o: { file, getConfig(), auth (ServiceAuth), licenses (Licenses), accounts() → [correo], log?, onChange?() }
  constructor(o) {
    this.o = o;
    const d = readJson(o.file, {});
    this.data = { token: d.token || null, plan: d.plan || null, at: d.at || 0 };
    this.sinLugar = new Set(); // cuentas que recibieron 402 al cubrirlas: no se reintenta hasta el próximo refresco
    this.timer = null; this.running = null;
  }

  get cfg() { return this.o.getConfig(); }
  token() { return this.data.token; }
  _save() { writeJsonAtomic(this.o.file, this.data, { mode: 0o600 }); }
  _changed() { if (this.o.onChange) { try { this.o.onChange(); } catch (_) {} } }

  // Trae el plan. Sin sesión no hace nada (se conserva lo guardado hasta que venza).
  refresh() {
    if (!this.running) this.running = this._refresh().finally(() => { this.running = null; });
    return this.running;
  }

  async _fetch() {
    const r = await this.o.auth.call('GET', this.cfg.plan.path);
    if (r.status === 401 || r.status === 403) { this.o.auth.logout(); return { error: 'sesion' }; }
    if (!r.ok || !r.body) return { error: r.status === 404 || r.status === 501 ? 'sin-servicio' : `servicio ${r.status}` };
    const { token, ...plan } = r.body;
    this.data = { token: typeof token === 'string' && token ? token : null, plan, at: Date.now() };
    this._save();
    return { ok: true };
  }

  async _refresh() {
    if (!this.o.auth.token) return { skipped: 'sin-sesion' };
    this.sinLugar.clear();
    try {
      const r = await this._fetch();
      if (r.error) return r;
      await this._cubrir(this.o.accounts());
      return { ok: true };
    } catch (e) {
      if (this.o.log) this.o.log.warn(`plan: no se pudo actualizar (${e.message})`);
      return { error: e.message };
    } finally { this._changed(); }
  }

  // ¿Esta cuenta de dominio propio necesita que la suscripción la cubra?
  _falta(cuenta) {
    if (!esCorreo(cuenta) || esPersonal(cuenta) || this.sinLugar.has(cuenta)) return false;
    const L = this.o.licenses;
    if (L.vigente(cuenta, 'limpiar') || L.vigente(cuenta, 'sincronizar')) return false;
    const sub = L.subscription();
    return !(sub && sub.cuentas.includes(cuenta));
  }

  // Con sesión y suscripción vigente, las cuentas de dominio propio que no están en el comprobante ocupan un lugar.
  async _cubrir(cuentas) {
    const s = this.data.plan && this.data.plan.suscripcion;
    if (!this.o.auth.token || !s || !s.vigente) return 0;
    const faltan = [...new Set((cuentas || []).map(c => String(c || '').trim().toLowerCase()))].filter(c => this._falta(c));
    let n = 0;
    for (const cuenta of faltan) {
      const r = await this.o.auth.call('POST', this.cfg.plan.cubrirPath, { cuenta });
      if (r.ok) { n++; if (this.o.log) this.o.log.info(`plan: ${cuenta} cubierta por la suscripción`); }
      else this.sinLugar.add(cuenta);
    }
    if (n) await this._fetch();
    return n;
  }

  // Antes de ejecutar: si alguna cuenta todavía no está cubierta y se puede cubrir, se cubre y se renueva el comprobante.
  async ensure(cuentas) {
    try { if (await this._cubrir(cuentas)) this._changed(); } catch (e) { if (this.o.log) this.o.log.warn(`plan: no se pudo cubrir (${e.message})`); }
  }

  start() {
    this.stop();
    this.refresh().catch(() => {});
    this.timer = setInterval(() => this.refresh().catch(() => {}), this.cfg.plan.refreshMs);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  // Precios: los del servicio si llegaron y tienen forma, si no los de la configuración
  precios() {
    const p = this.data.plan && this.data.plan.precios;
    const ok = (l) => Array.isArray(l) && l.length && l.every(x => x && Number.isFinite(Number(x.desde)) && x.precio != null);
    return p && ok(p.mensual) && ok(p.anual) ? { moneda: p.moneda || this.cfg.plan.precios.moneda, mensual: p.mensual, anual: p.anual } : this.cfg.plan.precios;
  }

  // Lo que ve la interfaz (sin el comprobante)
  view() {
    const plan = this.data.plan || {};
    const sub = this.o.licenses.subscription();
    const s = plan.suscripcion || null;
    return {
      signedIn: !!this.o.auth.token, at: this.data.at || 0,
      // la IA de Nonosky y las tareas del servidor: con sesión y suscripción vigente
      incluida: !!(this.o.auth.token && s && s.vigente),
      suscripcion: s ? { estado: s.estado, periodo: s.periodo, cantidad: s.cantidad, cuentas: s.cuentas || [], pagadoHasta: s.pagado_hasta, vigente: !!s.vigente } : null,
      vigente: !!sub, cubiertas: sub ? sub.cuentas : [], vence: sub ? new Date(sub.exp * 1000).toISOString() : null,
      comproAlgunaVez: !!plan.compro_alguna_vez,
      precios: this.precios(), subscribeUrl: this.cfg.plan.subscribeUrl,
    };
  }
}

module.exports = { PlanSync };
