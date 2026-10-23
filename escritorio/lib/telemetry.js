'use strict';
// Cliente de telemetría (contrato v1, compartido con el servicio web y la app Android).
// - Solo envía con el consentimiento encendido Y el configurador terminado. Apagado: nada, ni la instalación,
//   y la cola se vacía.
// - Los eventos se encolan en disco (máx. maxQueue, se descartan los más viejos) y salen en lotes de maxBatch
//   y maxBodyBytes: cada flushIntervalMs, al terminar una operación y al cerrar la app.
// - 2xx: enviado. 4xx: el lote se descarta. 5xx o sin red: queda en la cola para el próximo intento.
// - Nunca contraseñas, tokens, claves de licencia, asuntos, cuerpos ni remitentes; los errores pasan por scrub().
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { scrub } = require('./scrub');
const { systemLocale } = require('./i18n');
const { ROOT } = require('./defaults');
const path = require('path');

const APP = 'desktop';
const ORIGINS = ['github', 'mt', 'desconocido'];

function osName(p = process.platform) { return p === 'win32' ? 'windows' : p === 'darwin' ? 'macos' : p === 'linux' ? 'linux' : p; }
function osVersion(p = process.platform) {
  if (p === 'linux') {
    try {
      const txt = fs.readFileSync('/etc/os-release', 'utf8');
      const v = (k) => ((txt.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm')) || [])[1] || '');
      const s = `${v('NAME')} ${v('VERSION_ID')}`.trim();
      if (s) return s;
    } catch (_) {}
  }
  return os.release();
}

// El build de GitHub Releases escribe config/build-info.json con { "origen_descarga": "github" }
function downloadOrigin(env = process.env, file = path.join(ROOT, 'config', 'build-info.json')) {
  const fromEnv = String(env.NMT_ORIGEN_DESCARGA || '').trim();
  if (ORIGINS.includes(fromEnv)) return fromEnv;
  const info = readJson(file, null);
  return info && ORIGINS.includes(info.origen_descarga) ? info.origen_descarga : 'desconocido';
}

class Telemetry {
  // o: { dir, getConfig(), version, userEmails() → [cuentas del usuario], log, fetch, locale, origin, platform, arch }
  constructor(o) {
    this.o = o;
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.stateFile = path.join(o.dir, 'telemetry.json');
    this.queueFile = path.join(o.dir, 'telemetry-queue.json');
    this.state = readJson(this.stateFile, {});
    if (!this.state.install_id) { this.state.install_id = crypto.randomUUID(); this._saveState(); }
    const q = readJson(this.queueFile, { eventos: [] });
    this.queue = Array.isArray(q.eventos) ? q.eventos : [];
    this.filtroFile = path.join(o.dir, 'filtro-queue.json');
    const f = readJson(this.filtroFile, { decisiones: [] });
    this.filtroQueue = Array.isArray(f.decisiones) ? f.decisiones : [];
    this.timer = null; this.flushing = null;
  }

  get cfg() { return this.o.getConfig().telemetry; }
  get installId() { return this.state.install_id; }
  get consent() { return !!this.cfg.enabled; }
  get canSend() { const c = this.o.getConfig(); return !!(c.telemetry.enabled && c.setup && c.setup.done && /^https?:\/\//i.test(String(c.service.url || ''))); }

  // Filtro colectivo: su propio interruptor (Ajustes → Sistema), independiente del de telemetría
  get compartir() { const c = this.o.getConfig(); return !!(c.filtro && c.filtro.compartir); }
  get canSendFiltro() { const c = this.o.getConfig(); return !!(this.compartir && c.setup && c.setup.done && /^https?:\/\//i.test(String(c.service.url || ''))); }
  _saveFiltro() { try { writeJsonAtomic(this.filtroFile, { decisiones: this.filtroQueue }); } catch (_) {} }

  _saveState() { try { writeJsonAtomic(this.stateFile, this.state); } catch (_) {} }
  _saveQueue() { try { writeJsonAtomic(this.queueFile, { eventos: this.queue }); } catch (_) {} }
  _base() { return String(this.o.getConfig().service.url).replace(/\/+$/, ''); }
  userAgent() { return `NoniMailTools/${this.o.version} (${osName(this.o.platform)}; ${this.o.arch || process.arch})`; }

  // Apagar la telemetría vacía la cola: lo no enviado no sale nunca
  setConsent(on) { if (!on) { this.queue = []; this._saveQueue(); } }

  setCompartir(on) { if (!on) { this.filtroQueue = []; this._saveFiltro(); } }

  // Decisiones del filtro colectivo (ya armadas por lib/filtro.js): cola en disco, mismos lotes y reintentos
  trackDecisiones(lista) {
    if (!this.compartir || !lista || !lista.length) return false;
    this.filtroQueue.push(...lista);
    const max = this.o.getConfig().filtro.maxQueue;
    if (this.filtroQueue.length > max) this.filtroQueue.splice(0, this.filtroQueue.length - max);
    this._saveFiltro();
    return true;
  }

  track(tipo, datos = {}) {
    if (!this.consent) return false;
    const clean = {};
    for (const [k, v] of Object.entries(datos || {})) if (v !== undefined && v !== null && v !== '') clean[k] = v;
    this.queue.push({ ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), tipo, datos: clean });
    const max = this.cfg.maxQueue;
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
    this._saveQueue();
    return true;
  }

  error(e, contexto = 'app', cuenta) {
    const keep = (this.o.userEmails ? this.o.userEmails() : []).concat(cuenta ? [cuenta] : []);
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error && e.stack ? e.stack : '';
    return this.track('error', {
      mensaje: scrub(msg, { keep }).slice(0, 1000),
      pila: stack ? scrub(stack, { keep }).slice(0, this.cfg.maxStack) : undefined,
      contexto, cuenta,
    });
  }

  installPayload() {
    const c = this.o.getConfig();
    return {
      install_id: this.installId, app: APP, version: this.o.version,
      os: osName(this.o.platform), os_version: this.o.osVersion || osVersion(this.o.platform), arch: this.o.arch || process.arch,
      locale: this.o.locale || systemLocale(),
      zona_horaria: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } })(),
      origen_descarga: this.o.origin || downloadOrigin(),
      ia_local: !!c.llm.enabled,
      modelo: c.llm.enabled && c.model ? c.model : null,
    };
  }

  async _post(p, body) {
    const r = await this.fetch(`${this._base()}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': this.userAgent() },
      body, signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });
    try { await r.text(); } catch (_) {}
    return r.status;
  }

  // Al terminar el configurador (force) y luego como máximo una vez al día, si cambió algo o pasaron 24 h
  async sendInstall(force = false) {
    if (!this.canSend) return null;
    const payload = this.installPayload();
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const due = force || hash !== this.state.lastInstallHash || Date.now() - (this.state.lastInstallAt || 0) >= this.cfg.installIntervalMs;
    if (!due) return null;
    let status;
    try { status = await this._post(this.cfg.installPath, JSON.stringify(payload)); }
    catch (e) { this._warn('instalación', e); return 'network'; }
    if (status >= 200 && status < 300 || status >= 400 && status < 500) {
      // 4xx: no se reintenta (el servidor la rechazó); se vuelve a intentar con el próximo cambio o en 24 h
      this.state.lastInstallAt = Date.now(); this.state.lastInstallHash = hash; this._saveState();
    }
    return status;
  }

  // Arma un lote que respete maxBatch y maxBodyBytes
  _batch(list = this.queue, key = 'eventos', maxBatch = this.cfg.maxBatch) {
    const base = { install_id: this.installId, app: APP, version: this.o.version };
    let n = Math.min(maxBatch, list.length);
    for (;;) {
      const body = JSON.stringify({ ...base, [key]: list.slice(0, n) });
      if (Buffer.byteLength(body) <= this.cfg.maxBodyBytes) return { n, body };
      if (n === 1) return { n: 1, body: null }; // un solo evento demasiado grande: se descarta
      n = Math.max(1, Math.floor(n / 2));
    }
  }

  async _flushEvents() { return this._flushList('eventos', this.cfg.eventsPath, () => this.queue, () => this._saveQueue(), this.cfg.maxBatch); }
  async _flushFiltro() {
    const f = this.o.getConfig().filtro;
    return this._flushList('decisiones', f.decisionesPath, () => this.filtroQueue, () => this._saveFiltro(), f.maxBatch);
  }

  async _flushList(key, route, list, save, maxBatch) {
    let sent = 0;
    while (list().length) {
      const { n, body } = this._batch(list(), key, maxBatch);
      if (!body) { list().splice(0, n); save(); continue; }
      let status;
      try { status = await this._post(route, body); }
      catch (e) { this._warn(key, e); return { sent, retry: true }; }
      if (status >= 500) return { sent, retry: true, status };
      // 2xx enviado, 4xx descartado: en los dos casos el lote sale de la cola
      list().splice(0, n); save();
      if (status >= 200 && status < 300) sent += n;
    }
    return { sent, retry: false };
  }

  flush() {
    if (!this.canSend && !this.canSendFiltro) return Promise.resolve({ sent: 0, skipped: true });
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        let r = { sent: 0, retry: false };
        if (this.canSend) { await this.sendInstall(false); r = await this._flushEvents(); }
        if (this.canSendFiltro) await this._flushFiltro();
        return r;
      } finally { this.flushing = null; }
    })();
    return this.flushing;
  }

  _warn(what, e) { if (this.o.log) this.o.log.warn(`telemetría: no se pudo enviar ${what} (${e.cause?.code || e.name || e.message})`); }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.flush().catch(() => {}); }, this.cfg.flushIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  // Al cerrar: un último intento, con tiempo máximo
  async shutdown(timeoutMs = this.cfg.quitTimeoutMs) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    let to;
    await Promise.race([this.flush().catch(() => {}), new Promise(r => { to = setTimeout(r, timeoutMs); })]);
    clearTimeout(to);
  }
}

module.exports = { Telemetry, osName, osVersion, downloadOrigin, APP };
