'use strict';
// Sincronizar: una corrida a la vez de runSync() entre dos cuentas guardadas, con progreso por SSE
// (eventos t:'sync'). Una cuenta comercial sin licencia de sincronización corre en simulación.
const { runSync } = require('./engine');
const { t } = require('../i18n');

class SyncRunner {
  // o: { cfg(), mailbox(accountId) → Promise<{ email, mb }>, licenses, sse(obj), log, onEnd(state) }
  constructor(o) {
    this.o = o;
    this.st = { running: false, abort: false, lines: [], progress: null, result: null };
  }

  busy() { return this.st.running; }
  stop() { if (this.st.running) this.st.abort = true; }

  view() {
    const s = this.st;
    return { running: s.running, dryRun: s.dryRun, forced: s.forced, origen: s.origen, destino: s.destino, progress: s.progress, result: s.result, gate: s.gate, startedAt: s.startedAt, lines: s.lines.slice(-200) };
  }

  async start({ origen, destino, dryRun = true, folders = [], excludeFolders = [] }) {
    if (this.st.running) throw Object.assign(new Error(t('sync.err.busy')), { code: 409 });
    if (!origen || !destino) throw Object.assign(new Error(t('sync.err.pick')), { code: 400 });
    if (origen === destino) throw Object.assign(new Error(t('sync.err.same')), { code: 400 });
    const src = await this.o.mailbox(origen), dst = await this.o.mailbox(destino);
    const same = (a, b) => a.mb.host.toLowerCase() === b.mb.host.toLowerCase() && Number(a.mb.port) === Number(b.mb.port)
      && String(a.mb.auth.user).toLowerCase() === String(b.mb.auth.user).toLowerCase();
    if (same(src, dst)) throw Object.assign(new Error(t('sync.err.same')), { code: 400 });

    const cfg = this.o.cfg();
    const wantDry = dryRun !== false;
    const gate = this.o.licenses.gate([src.email, dst.email], 'sincronizar');
    const forced = !wantDry && !gate.permitido;
    const dry = wantDry || forced;
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean);

    const st = this.st;
    Object.assign(st, { running: true, abort: false, dryRun: dry, forced, origen: src.email, destino: dst.email, lines: [], progress: null, result: null, gate, startedAt: new Date().toISOString() });
    const max = cfg.sync.maxLogLines;
    const log = (text) => {
      const l = { ts: new Date().toISOString().slice(11, 19), text };
      st.lines.push(l); if (st.lines.length > max) st.lines.splice(0, st.lines.length - max);
      this.o.sse({ t: 'sync', tipo: 'linea', ...l });
    };
    if (forced) log(t('sync.forcedDry', { reason: gate.motivo }));
    this.o.sse({ t: 'sync', tipo: 'inicio', dryRun: dry, forced, origen: st.origen, destino: st.destino, gate });
    const t0 = Date.now();

    runSync({
      origen: src.mb, destino: dst.mb, dryRun: dry, folders: list(folders), excludeFolders: list(excludeFolders),
      maxBytes: cfg.sync.maxBytes,
      options: { fetchBatch: cfg.sync.fetchBatch, progressEvery: cfg.sync.progressEvery, socketTimeoutMs: cfg.sync.socketTimeoutMs, connectionTimeoutMs: cfg.imap.connectionTimeoutMs, greetingTimeoutMs: cfg.imap.greetingTimeoutMs },
      onLog: log,
      onProgress: (p) => { st.progress = { ...(st.progress || {}), ...p }; this.o.sse({ t: 'sync', tipo: 'progreso', progress: st.progress }); },
      shouldCancel: () => st.abort,
    }).then((r) => { st.result = r; })
      .catch((e) => { st.result = { ok: false, error: String(e.message || e), totals: {}, folders: [] }; log(t('sync.log.error', { error: e.message || e })); })
      .finally(() => {
        st.running = false; st.durationMs = Date.now() - t0;
        this.o.sse({ t: 'sync', tipo: 'fin', result: st.result });
        if (this.o.onEnd) { try { this.o.onEnd(st); } catch (_) {} }
      });
    return { ok: true, dryRun: dry, forcedDryRun: forced, gate };
  }
}

module.exports = { SyncRunner };
