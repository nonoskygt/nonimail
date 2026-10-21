'use strict';
// Dependencias de la IA local para el configurador: detectar Ollama, instalarlo y bajar el modelo.
// - Windows: baja el OllamaSetup.exe oficial (ollama.installer.windows) y lo corre en silencio.
// - Linux: baja el script oficial (ollama.installer.linux) y lo corre con pkexec (pide la contraseña
//   en una ventana del sistema). Sin pkexec o sin escritorio, devuelve el comando exacto para la terminal.
// - El modelo se baja con /api/pull de Ollama, con progreso.
// El progreso sale por sse({ t: 'setup', task: 'install'|'pull', ... }).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const llm = require('./llm');
const { t } = require('./i18n');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '\n');
const expandEnv = (p, env = process.env) => String(p).replace(/%([^%]+)%/g, (m, k) => env[k] ?? m).replace(/\$\{?(\w+)\}?/g, (m, k) => env[k] ?? m);

function which(cmd, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, cmd);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch (_) {}
  }
  return null;
}

class OllamaSetup {
  // o: { cfg(), sse(obj), log, platform?, env?, spawn?, fetch?, tmpDir? }
  constructor(o) {
    this.o = o;
    this.platform = o.platform || process.platform;
    this.env = o.env || process.env;
    this.spawn = o.spawn || nodeSpawn;
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.task = null; this.abort = null; this.last = null;
  }

  get cfg() { return this.o.cfg(); }
  _emit(ev) { this.last = { t: 'setup', ...ev }; this.o.sse(this.last); }

  // Cómo se instala en esta PC: windows | pkexec | manual | unsupported
  method() {
    if (this.platform === 'win32') return 'windows';
    if (this.platform === 'linux') {
      const gui = !!(this.env.DISPLAY || this.env.WAYLAND_DISPLAY);
      return gui && which('pkexec', this.env) ? 'pkexec' : 'manual';
    }
    return 'unsupported';
  }
  manualCommand() { const i = this.cfg.ollama.installer; return String(i.linuxManual).replace('{url}', i.linux); }

  async status() {
    const c = this.cfg;
    const v = await llm.version(c.ollamaUrl, c.ollama.probeTimeoutMs);
    const m = v.ok ? await llm.listModels(c.ollamaUrl, c.ollama.probeTimeoutMs) : { ok: false, models: [] };
    const has = (name) => m.models.some(x => x === name || x === `${name}:latest` || `${x}:latest` === name);
    return {
      url: c.ollamaUrl, running: v.ok, version: v.version || null, models: m.models,
      model: c.model, modelInstalled: !!c.model && has(c.model),
      method: this.method(), manualCommand: this.platform === 'linux' ? this.manualCommand() : null,
      downloadUrl: this.platform === 'win32' ? c.ollama.installer.windows : this.platform === 'linux' ? c.ollama.installer.linux : null,
      task: this.task, last: this.last, aiEnabled: !!c.llm.enabled,
    };
  }

  cancel() { if (this.abort) this.abort.abort(); }

  async _download(url, file, signal) {
    if (!/^https:\/\//i.test(url)) throw new Error(t('setup.err.httpsOnly'));
    const r = await this.fetch(url, { signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(t('setup.err.download', { status: r.status }));
    const total = Number(r.headers.get('content-length')) || 0;
    let received = 0, lastEmit = 0;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(file, { mode: 0o700 });
    try {
      for await (const chunk of r.body) {
        received += chunk.length;
        if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
        if (Date.now() - lastEmit > 300) { lastEmit = Date.now(); this._emit({ task: 'install', phase: 'download', received, total, pct: total ? Math.round(100 * received / total) : null }); }
      }
    } finally { await new Promise(res => out.end(res)); }
    this._emit({ task: 'install', phase: 'download', received, total, pct: 100 });
    return file;
  }

  _run(cmd, args, timeoutMs, onLine) {
    return new Promise((resolve, reject) => {
      let p;
      try { p = this.spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
      const to = setTimeout(() => { try { p.kill(); } catch (_) {} reject(new Error(t('setup.err.timeout'))); }, timeoutMs);
      const feed = (buf) => { for (const line of stripAnsi(buf).split('\n')) if (line.trim() && onLine) onLine(line.trim()); };
      if (p.stdout) p.stdout.on('data', feed);
      if (p.stderr) p.stderr.on('data', feed);
      p.on('error', (e) => { clearTimeout(to); reject(e); });
      p.on('close', (code) => { clearTimeout(to); resolve(code); });
    });
  }

  async _waitUp(ms, onTick) {
    const c = this.cfg, end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await llm.version(c.ollamaUrl, c.ollama.probeTimeoutMs);
      if (v.ok) return v;
      if (onTick) onTick();
      await sleep(1500);
    }
    return null;
  }

  // Arranca en segundo plano; el resultado llega por SSE. Devuelve { started } o { manual, command }.
  install() {
    if (this.task) throw Object.assign(new Error(t('setup.err.busy')), { code: 409 });
    const method = this.method();
    if (method === 'manual') return { manual: true, command: this.manualCommand() };
    if (method === 'unsupported') return { manual: true, command: null, url: 'https://ollama.com/download' };
    this.task = 'install'; this.abort = new AbortController();
    const c = this.cfg, signal = this.abort.signal;
    const tmp = this.o.tmpDir || path.join(os.tmpdir(), 'nonimail-tools');
    (async () => {
      try {
        if (method === 'windows') {
          const exe = await this._download(c.ollama.installer.windows, path.join(tmp, 'OllamaSetup.exe'), signal);
          this._emit({ task: 'install', phase: 'run' });
          const code = await this._run(exe, c.ollama.installer.windowsArgs, c.ollama.installTimeoutMs);
          if (code !== 0) throw new Error(t('setup.err.installer', { code }));
        } else {
          const sh = await this._download(c.ollama.installer.linux, path.join(tmp, 'ollama-install.sh'), signal);
          this._emit({ task: 'install', phase: 'run' });
          const code = await this._run(which('pkexec', this.env) || 'pkexec', ['/bin/sh', sh], c.ollama.installTimeoutMs, (line) => {
            const pct = (line.match(/(\d{1,3}(?:\.\d)?)%/) || [])[1];
            if (/^[#\s.\d%]+$/.test(line)) { if (pct) this._emit({ task: 'install', phase: 'run', pct: Math.round(+pct) }); return; }
            this._emit({ task: 'install', phase: 'run', line: line.slice(0, 200), pct: pct ? Math.round(+pct) : null });
          });
          if (code === 126 || code === 127) throw new Error(t('setup.err.notAuthorized'));
          if (code !== 0) throw new Error(t('setup.err.installer', { code }));
        }
        this._emit({ task: 'install', phase: 'start' });
        let tried = false;
        const v = await this._waitUp(c.ollama.startWaitMs, () => {
          if (tried || this.platform !== 'win32') return;
          tried = true; // el instalador silencioso a veces no deja Ollama abierto
          try { const p = this.spawn(expandEnv(c.ollama.installer.windowsApp, this.env), [], { detached: true, stdio: 'ignore', windowsHide: true }); p.on('error', () => {}); p.unref(); } catch (_) {}
        });
        if (!v) throw new Error(t('setup.err.notStarted'));
        this._emit({ task: 'install', phase: 'done', done: true, version: v.version });
        if (this.o.log) this.o.log.info(`ollama instalado (${v.version})`);
      } catch (e) {
        const msg = signal.aborted ? t('setup.cancelled') : e.message;
        this._emit({ task: 'install', phase: 'error', error: msg, done: true });
        if (this.o.log) this.o.log.warn(`ollama: instalación fallida: ${msg}`);
        if (this.o.onError && !signal.aborted) this.o.onError(e);
      } finally { this.task = null; this.abort = null; }
    })();
    return { started: true, method };
  }

  pull(model) {
    if (this.task) throw Object.assign(new Error(t('setup.err.busy')), { code: 409 });
    model = String(model || this.cfg.model || '').trim();
    if (!model) throw Object.assign(new Error(t('setup.err.noModel')), { code: 400 });
    this.task = 'pull'; this.abort = new AbortController();
    const c = this.cfg, signal = this.abort.signal;
    (async () => {
      const layers = new Map();
      try {
        const r = await this.fetch(`${String(c.ollamaUrl).replace(/\/+$/, '')}/api/pull`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, name: model, stream: true }),
          signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(c.ollama.pullTimeoutMs)]) : signal,
        });
        if (!r.ok || !r.body) throw new Error(t('setup.err.pull', { status: r.status }));
        let buf = '', lastEmit = 0, final = null;
        const handle = (line) => {
          if (!line.trim()) return;
          let j; try { j = JSON.parse(line); } catch (_) { return; }
          if (j.error) throw new Error(j.error);
          if (j.digest && j.total) layers.set(j.digest, { total: j.total, completed: j.completed || 0 });
          let total = 0, completed = 0; for (const l of layers.values()) { total += l.total; completed += l.completed; }
          final = j.status;
          if (Date.now() - lastEmit > 250 || j.status === 'success') {
            lastEmit = Date.now();
            this._emit({ task: 'pull', model, status: j.status, total, completed, pct: total ? Math.min(100, Math.round(100 * completed / total)) : null });
          }
        };
        const dec = new TextDecoder();
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        handle(buf);
        if (final !== 'success') throw new Error(t('setup.err.pullIncomplete'));
        this._emit({ task: 'pull', model, status: 'success', pct: 100, done: true });
        if (this.o.log) this.o.log.info(`ollama: modelo ${model} listo`);
        if (this.o.onPulled) this.o.onPulled(model);
      } catch (e) {
        const msg = signal.aborted ? t('setup.cancelled') : e.message;
        this._emit({ task: 'pull', model, status: 'error', error: msg, done: true });
        if (this.o.log) this.o.log.warn(`ollama: no se bajó ${model}: ${msg}`);
        if (this.o.onError && !signal.aborted) this.o.onError(e);
      } finally { this.task = null; this.abort = null; }
    })();
    return { started: true, model };
  }
}

module.exports = { OllamaSetup, which, expandEnv, stripAnsi };
