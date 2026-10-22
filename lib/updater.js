'use strict';
// Controlador de la actualización automática: une lib/updates.js con electron-updater (o con la consulta
// a GitHub para el portable y el .deb). Un fallo al comprobar se registra y se manda como telemetría
// (contexto «actualizacion»), pero nunca abre avisos: el usuario solo ve el resultado si pulsó «Buscar».
const { installKind, decide, checkLatestRelease } = require('./updates');

class Updater {
  // o: { kind, current, apiUrl, getConfig(), autoUpdater (electron-updater o null), quitAndInstall(), busy(),
  //      fetch, log, report(err, contexto), emit(estado) }
  constructor(o) {
    this.o = o;
    this.kind = o.kind || installKind({ packaged: false });
    this.phase = 'idle'; this.version = null; this.url = null; this.percent = 0; this.checkedAt = null;
    this.checking = false; this.timers = []; this.lastReported = '';
    const au = o.autoUpdater;
    if (au) {
      au.autoDownload = true; au.autoInstallOnAppQuit = true; au.allowPrerelease = false; au.allowDowngrade = false;
      const line = (m) => o.log.info(`[actualizacion] ${m}`);
      au.logger = { info: line, warn: line, error: line, debug: () => {} };
      au.on('update-available', (i) => { this.version = i.version; this.phase = 'downloading'; this.percent = 0; this._log(`versión ${i.version} disponible, descargando`); this._emit(); });
      au.on('update-not-available', () => { this.phase = 'uptodate'; this._emit(); });
      au.on('download-progress', (p) => { this.percent = Math.round(p.percent || 0); this.phase = 'downloading'; this._emit(); });
      au.on('update-downloaded', (i) => { this.version = i.version; this.phase = 'downloaded'; this._log(`versión ${i.version} descargada; se instala al cerrar`); this._emit(); });
      au.on('error', (e) => this._fail(e));
    }
  }

  get auto() { const u = this.o.getConfig().updates; return !u || u.auto !== false; }
  _log(m) { this.o.log.info(`[actualizacion] ${m}`); }
  _emit() { if (this.o.emit) { try { this.o.emit(this.state()); } catch (_) {} } }
  _fail(e) {
    const err = e instanceof Error ? e : new Error(String(e));
    this.phase = 'error';
    if (err.message !== this.lastReported) { this.lastReported = err.message; this.o.report(err, 'actualizacion'); }
    this._emit();
  }
  _decision() { return decide({ kind: this.kind, auto: this.auto, phase: this.phase, busy: !!this.o.busy() }); }

  state() {
    const d = this._decision();
    return {
      kind: this.kind, auto: this.auto, current: this.o.current, phase: this.phase, version: this.version, url: this.url,
      percent: this.percent, checkedAt: this.checkedAt, supported: d.check !== 'none',
      banner: d.banner, canRestart: d.canRestart,
    };
  }

  // manual = el usuario pulsó «Buscar actualizaciones» (siempre comprueba); lo automático respeta el interruptor
  async check(manual = false) {
    const d = this._decision();
    if (d.check === 'none' || this.checking || this.phase === 'downloaded' || this.phase === 'downloading') return this.state();
    if (!manual && !d.periodic) return this.state();
    this.checking = true; this.lastReported = '';
    if (manual) { this.phase = 'checking'; this._emit(); }
    try {
      if (d.check === 'updater') {
        this.phase = 'checking';
        await this.o.autoUpdater.checkForUpdates(); // los eventos de arriba fijan la fase
        if (this.phase === 'checking') this.phase = 'uptodate';
      } else {
        const r = await checkLatestRelease({ apiUrl: this.o.apiUrl, current: this.o.current, kind: this.kind, fetchFn: this.o.fetch });
        this.version = r.version; this.url = r.url;
        this.phase = r.newer ? 'available' : 'uptodate';
        if (r.newer) this._log(`versión ${r.version} disponible en GitHub (${this.kind})`);
      }
    } catch (e) { this._fail(e); }
    this.checking = false; this.checkedAt = Date.now(); this._emit();
    return this.state();
  }

  // «Reiniciar ahora»: solo con la versión ya descargada y sin operaciones en curso
  restart() {
    const d = this._decision();
    if (d.banner !== 'ready') return { ok: false, reason: 'none' };
    if (!d.canRestart) return { ok: false, reason: 'busy' };
    this._log(`reiniciando para instalar ${this.version}`);
    this.o.quitAndInstall();
    return { ok: true };
  }

  // Primera comprobación a los ~10 s y luego cada 4 h, también con la ventana oculta en la bandeja
  start(delayMs, everyMs) {
    if (this.kind === 'dev') return;
    this.timers.push(setTimeout(() => this.check(false), delayMs), setInterval(() => this.check(false), everyMs));
  }
  stop() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
}

module.exports = { Updater };
