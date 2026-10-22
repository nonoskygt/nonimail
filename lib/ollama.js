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
const hardware = require('./hardware');
const validate = require('./validate');
const { t } = require('./i18n');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '\n');
const expandEnv = (p, env = process.env) => String(p).replace(/%([^%]+)%/g, (m, k) => env[k] ?? m).replace(/\$\{?(\w+)\}?/g, (m, k) => env[k] ?? m);

// Como `where`/`which`: recorre el PATH (en Windows con las extensiones de PATHEXT)
function which(cmd, env = process.env, platform = process.platform) {
  const win = platform === 'win32';
  const same = platform === process.platform;
  const sep = same ? path.delimiter : win ? ';' : ':'; // en Windows las rutas traen "C:", así que ':' no sirve de separador
  const pj = same ? path.join : (win ? path.win32.join : path.posix.join);
  const exts = win ? ['', ...String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)] : [''];
  for (const dir of String(env.PATH || env.Path || env.path || '').split(sep)) {
    if (!dir) continue;
    for (const x of exts) {
      const f = pj(dir.replace(/^"|"$/g, ''), cmd + x);
      try { fs.accessSync(f, win ? fs.constants.F_OK : fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch (_) {}
    }
  }
  return null;
}

// OLLAMA_HOST puede ser "host", "host:puerto", "0.0.0.0:11434" o una URL completa
function hostToUrl(h) {
  h = String(h || '').trim();
  if (!h) return null;
  if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
  try {
    const u = new URL(h);
    if (u.hostname === '0.0.0.0' || u.hostname === '::' || u.hostname === '[::]') u.hostname = '127.0.0.1';
    if (!u.port) u.port = '11434';
    return `${u.protocol}//${u.host}`;
  } catch (_) { return null; }
}

// Direcciones a probar, en orden y sin repetir: la configurada, OLLAMA_HOST, y 127.0.0.1 <-> localhost
function candidateUrls(configured, env = process.env) {
  const out = [];
  const add = (u) => { u = String(u || '').replace(/\/+$/, ''); if (u && !out.includes(u)) out.push(u); };
  add(configured); add(hostToUrl(env.OLLAMA_HOST));
  for (const u of [...out]) {
    if (/\/\/127\.0\.0\.1(?=[:/]|$)/.test(u)) add(u.replace('//127.0.0.1', '//localhost'));
    else if (/\/\/localhost(?=[:/]|$)/i.test(u)) add(u.replace(/\/\/localhost/i, '//127.0.0.1'));
  }
  return out;
}

// Lector de la salida en streaming de /api/pull. Suma todas las capas: completed/total.
class PullTracker {
  constructor() { this.layers = new Map(); this.status = ''; }
  // -> { status, total, completed, pct } | null (línea vacía o ilegible); lanza si Ollama manda { error }
  feed(line) {
    if (!String(line).trim()) return null;
    let j; try { j = JSON.parse(line); } catch (_) { return null; }
    if (j.error) throw new Error(j.error);
    if (j.digest && j.total) this.layers.set(j.digest, { total: j.total, completed: j.completed || 0 });
    let total = 0, completed = 0;
    for (const l of this.layers.values()) { total += l.total; completed += l.completed; }
    this.status = j.status || this.status;
    return { status: this.status, total, completed, pct: total ? Math.min(100, Math.round(100 * completed / total)) : null };
  }
}

class OllamaSetup {
  // o: { cfg(), sse(obj), log, platform?, env?, spawn?, fetch?, tmpDir?, validation? (ValidationStore), validateModel?, onFallback?(tag) }
  constructor(o) {
    this.o = o;
    this.platform = o.platform || process.platform;
    this.env = o.env || process.env;
    this.spawn = o.spawn || nodeSpawn;
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.exists = o.exists || ((f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } });
    this.detectHardware = o.detectHardware || (() => hardware.detect({ platform: this.platform, timeoutMs: this.cfg.ollama.hardwareTimeoutMs }));
    this.validation = o.validation || null; this.validateModel = o.validateModel || validate.validateModel;
    this.task = null; this.abort = null; this.last = null; this.child = null; this.hw = null; this.url = null;
  }

  get cfg() { return this.o.cfg(); }
  _emit(ev) { this.last = { t: 'setup', ...ev }; this.o.sse(this.last); }

  // Cómo se instala en esta PC: windows | pkexec | manual | unsupported
  method() {
    if (this.platform === 'win32') return 'windows';
    if (this.platform === 'linux') {
      const gui = !!(this.env.DISPLAY || this.env.WAYLAND_DISPLAY);
      return gui && which('pkexec', this.env, this.platform) ? 'pkexec' : 'manual';
    }
    return 'unsupported';
  }
  manualCommand() { const i = this.cfg.ollama.installer; return String(i.linuxManual).replace('{url}', i.linux); }

  // Dirección que sí contestó (la última detectada) o la configurada
  get apiUrl() { return this.url || this.cfg.ollamaUrl; }

  // Dónde está el programa: rutas conocidas (config) y el PATH. null si no está en ningún lado.
  findExe() {
    const c = this.cfg;
    for (const raw of (c.ollama.exePaths && c.ollama.exePaths[this.platform]) || []) {
      const f = expandEnv(raw, this.env);
      if (!/[%$]/.test(f) && this.exists(f)) return f;
    }
    return which('ollama', this.env, this.platform);
  }

  // 1) ¿contesta la API? (URL configurada, OLLAMA_HOST, 127.0.0.1 y localhost) -> instalado y corriendo
  // 2) si no, ¿está el programa? -> instalado, sin correr. 3) si no -> no instalado.
  async detect() {
    const c = this.cfg;
    for (const u of candidateUrls(c.ollamaUrl, this.env)) {
      const v = await llm.version(u, c.ollama.probeTimeoutMs);
      if (v.ok) {
        this.url = u;
        if (this.o.onUrl && u !== c.ollamaUrl) this.o.onUrl(u);
        return { installed: true, running: true, version: v.version || null, exe: null, url: u };
      }
    }
    const exe = this.findExe();
    return { installed: !!exe, running: false, version: null, exe, url: c.ollamaUrl };
  }

  async status() {
    const c = this.cfg;
    const d = await this.detect();
    const m = d.running ? await llm.listModels(d.url, c.ollama.probeTimeoutMs) : { ok: false, models: [] };
    const has = (name) => m.models.some(x => x === name || x === `${name}:latest` || `${x}:latest` === name);
    if (!this.hw) { try { this.hw = await this.detectHardware(); } catch (_) { this.hw = { ramBytes: os.totalmem(), gpu: null }; } }
    const rec = hardware.recommend(c.ollama.tiers, this.hw);
    const digestOf = (tag) => (m.digests || {})[tag] ?? (m.digests || {})[`${tag}:latest`];
    const verdict = (tag) => { const e = this.validation && has(tag) ? this.validation.get(tag, digestOf(tag)) : null; return e ? !!e.pass : null; };
    const all = c.ollama.tiers;
    const shown = validate.offer(all, rec.id, c.model, verdict, has);
    return {
      url: d.url, installed: d.installed, running: d.running, version: d.version, models: m.models,
      model: c.model, modelInstalled: !!c.model && has(c.model),
      tiers: shown.tiers.map(x => ({ ...x, installed: has(x.tag), validation: verdict(x.tag) === null ? null : verdict(x.tag) ? 'pass' : 'fail' })),
      selected: shown.selected, hidden: all.filter(x => !shown.tiers.includes(x)).map(x => x.tag), nonePassed: all.length > 0 && !shown.tiers.length,
      hardware: { ramBytes: this.hw.ramBytes, gpu: this.hw.gpu }, recommended: rec,
      method: this.method(), manualCommand: this.platform === 'linux' ? this.manualCommand() : null,
      downloadUrl: this.platform === 'win32' ? c.ollama.installer.windows : this.platform === 'linux' ? c.ollama.installer.linux : null,
      task: this.task, last: this.last, aiEnabled: !!c.llm.enabled,
    };
  }

  // Instalado pero sin correr: lo arranca solo (la app de la bandeja en Windows, `ollama serve` en lo demás)
  // y espera a que conteste la API. Resultado por SSE (task 'start').
  start() {
    if (this.task) throw Object.assign(new Error(t('setup.err.busy')), { code: 409 });
    this.task = 'start'; this.abort = new AbortController();
    const c = this.cfg, signal = this.abort.signal;
    (async () => {
      try {
        this._emit({ task: 'start', phase: 'start' });
        let d = await this.detect();
        if (!d.running) {
          if (!d.exe) throw new Error(t('setup.err.notStarted'));
          this._launch(d.exe);
          const v = await this._waitUp(c.ollama.startWaitMs, null, signal);
          if (signal.aborted) throw new Error(t('setup.cancelled'));
          if (!v) throw new Error(t('setup.err.notStarted'));
        }
        this._emit({ task: 'start', phase: 'done', done: true });
      } catch (e) { this._fail('start', e, signal); } finally { this.task = null; this.abort = null; }
    })();
    return { started: true };
  }

  _launch(exe) {
    const c = this.cfg;
    let cmd = exe, args = ['serve'];
    if (this.platform === 'win32') {
      const app = expandEnv(c.ollama.installer.windowsApp, this.env);
      if (this.exists(app)) { cmd = app; args = []; } // la app de la bandeja deja el servidor corriendo
    }
    try { const p = this.spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, env: this.env }); p.on('error', () => {}); p.unref(); } catch (_) {}
  }

  _fail(task, e, signal) {
    const cancelled = !!(signal && signal.aborted);
    const msg = cancelled ? t('setup.cancelled') : e.message;
    this._emit({ task, phase: cancelled ? 'cancelled' : 'error', status: 'error', error: msg, cancelled, done: true });
    if (this.o.log) this.o.log.warn(`ollama: ${task}: ${msg}`);
    if (this.o.onError && !cancelled) this.o.onError(e);
  }

  cancel() { if (this.abort) this.abort.abort(); if (this.child) { try { this.child.kill(); } catch (_) {} } }

  async _download(url, file, signal) {
    if (!/^https:\/\//i.test(url)) throw new Error(t('setup.err.httpsOnly'));
    const r = await this.fetch(url, { signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(t('setup.err.download', { status: r.status }));
    const total = Number(r.headers.get('content-length')) || 0;
    let received = 0, lastEmit = 0;
    const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o700 }); // creación exclusiva: no sigue enlaces ni pisa archivos
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

  // Carpeta privada nueva (0700) y archivo que sea nuestro, sin enlaces y sin permisos de escritura ajenos
  _assertPrivate(...paths) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    for (const p of paths) {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) throw new Error(t('setup.err.unsafeTemp'));
      if (uid !== null && st.uid !== uid) throw new Error(t('setup.err.unsafeTemp'));
      if (process.platform !== 'win32' && (st.mode & 0o022)) throw new Error(t('setup.err.unsafeTemp'));
    }
  }

  _run(cmd, args, timeoutMs, onLine, input) {
    return new Promise((resolve, reject) => {
      let p;
      try { p = this.spawn(cmd, args, { windowsHide: true, stdio: [input != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
      this.child = p;
      if (input != null && p.stdin) { p.stdin.on('error', () => {}); p.stdin.end(input); }
      const to = setTimeout(() => { try { p.kill(); } catch (_) {} reject(new Error(t('setup.err.timeout'))); }, timeoutMs);
      const feed = (buf) => { for (const line of stripAnsi(buf).split('\n')) if (line.trim() && onLine) onLine(line.trim()); };
      if (p.stdout) p.stdout.on('data', feed);
      if (p.stderr) p.stderr.on('data', feed);
      p.on('error', (e) => { clearTimeout(to); this.child = null; reject(e); });
      p.on('close', (code) => { clearTimeout(to); this.child = null; resolve(code); });
    });
  }

  async _waitUp(ms, onTick, signal) {
    const c = this.cfg, end = Date.now() + ms;
    while (Date.now() < end && !(signal && signal.aborted)) {
      for (const u of candidateUrls(c.ollamaUrl, this.env)) {
        const v = await llm.version(u, c.ollama.probeTimeoutMs);
        if (v.ok) { this.url = u; if (this.o.onUrl && u !== c.ollamaUrl) this.o.onUrl(u); return v; }
      }
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
    let tmp = null;
    (async () => {
      try {
        tmp = fs.mkdtempSync(path.join(this.o.tmpDir || os.tmpdir(), 'nonimail-')); // privada: modo 0700
        if (method === 'windows') {
          const exe = await this._download(c.ollama.installer.windows, path.join(tmp, 'OllamaSetup.exe'), signal);
          this._assertPrivate(tmp, exe);
          this._emit({ task: 'install', phase: 'run' });
          const code = await this._run(exe, c.ollama.installer.windowsArgs, c.ollama.installTimeoutMs);
          if (code !== 0) throw new Error(t('setup.err.installer', { code }));
        } else {
          const sh = await this._download(c.ollama.installer.linux, path.join(tmp, 'ollama-install.sh'), signal);
          this._emit({ task: 'install', phase: 'run' });
          this._assertPrivate(tmp, sh);
          // al administrador no se le pasa una ruta: el script entra por la entrada estándar
          const script = fs.readFileSync(sh);
          const code = await this._run(which('pkexec', this.env, this.platform) || 'pkexec', ['/bin/sh', '-s'], c.ollama.installTimeoutMs, (line) => {
            const pct = (line.match(/(\d{1,3}(?:\.\d)?)%/) || [])[1];
            if (/^[#\s.\d%]+$/.test(line)) { if (pct) this._emit({ task: 'install', phase: 'run', pct: Math.round(+pct) }); return; }
            this._emit({ task: 'install', phase: 'run', line: line.slice(0, 200), pct: pct ? Math.round(+pct) : null });
          }, script);
          if (code === 126 || code === 127) throw new Error(t('setup.err.notAuthorized'));
          if (code !== 0) throw new Error(t('setup.err.installer', { code }));
        }
        this._emit({ task: 'install', phase: 'start' });
        let tried = false;
        const v = await this._waitUp(c.ollama.startWaitMs, () => {
          if (tried || this.platform !== 'win32') return;
          tried = true; // el instalador silencioso a veces no deja Ollama abierto
          try { const p = this.spawn(expandEnv(c.ollama.installer.windowsApp, this.env), [], { detached: true, stdio: 'ignore', windowsHide: true }); p.on('error', () => {}); p.unref(); } catch (_) {}
        }, signal);
        if (signal.aborted) throw new Error(t('setup.cancelled'));
        if (!v) throw new Error(t('setup.err.notStarted'));
        this._emit({ task: 'install', phase: 'done', done: true, version: v.version });
        if (this.o.log) this.o.log.info(`ollama instalado (${v.version})`);
      } catch (e) { this._fail('install', e, signal);
      } finally {
        if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
        this.task = null; this.abort = null;
      }
    })();
    return { started: true, method };
  }

  // Baja el modelo (/api/pull con progreso completed/total) y lo deja listo: verifica que esté en
  // /api/tags y hace una generación de 1 token para confirmar que corre.
  pull(model) {
    if (this.task) throw Object.assign(new Error(t('setup.err.busy')), { code: 409 });
    model = String(model || this.cfg.model || '').trim();
    if (!model) throw Object.assign(new Error(t('setup.err.noModel')), { code: 400 });
    this.task = 'pull'; this.abort = new AbortController();
    const c = this.cfg, signal = this.abort.signal, base = String(this.apiUrl).replace(/\/+$/, '');
    (async () => {
      try {
        const r = await this.fetch(`${base}/api/pull`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, name: model, stream: true }),
          signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(c.ollama.pullTimeoutMs)]) : signal,
        });
        if (!r.ok || !r.body) throw new Error(t('setup.err.pull', { status: r.status }));
        const tracker = new PullTracker();
        let buf = '', lastEmit = 0;
        const handle = (line) => {
          const p = tracker.feed(line);
          if (p && (Date.now() - lastEmit > 250 || p.status === 'success')) { lastEmit = Date.now(); this._emit({ task: 'pull', phase: 'pull', model, ...p }); }
        };
        const dec = new TextDecoder();
        for await (const chunk of r.body) {
          buf += dec.decode(chunk, { stream: true });
          let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        handle(buf);
        if (tracker.status !== 'success') throw new Error(t('setup.err.pullIncomplete'));
        await this._configure(model, base, signal);
        // recién bajado: se valida en la misma barra; si no pasa, se borra de Ollama sin preguntar
        const res = await this._validate(model, base, signal, 'pull');
        if (!res.pass) {
          await this.fetch(`${base}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, name: model }) }).catch(() => {});
          this._emit({ task: 'pull', phase: 'done', model, status: 'rejected', rejected: true, reasons: res.reasons, done: true });
          if (this.o.log) this.o.log.warn(`ollama: ${model} no pasó la validación (${res.reasons.join(' · ')}); se eliminó`);
          await this._fallback(model);
          return;
        }
        this._emit({ task: 'pull', phase: 'done', model, status: 'success', pct: 100, done: true });
        if (this.o.log) this.o.log.info(`ollama: modelo ${model} listo`);
        if (this.o.onPulled) this.o.onPulled(model);
      } catch (e) { this._fail('pull', e, signal); } finally { this.task = null; this.abort = null; }
    })();
    return { started: true, model };
  }

  // Corre la prueba del modelo, la guarda (modelo + digest) y reporta «Validando modelo… i/n» en la barra de `task`.
  async _validate(model, base, signal, task) {
    const c = this.cfg;
    const cfg = { ...c, ollamaUrl: base, model, llm: { ...c.llm } };
    const res = await this.validateModel(cfg, { signal, onProgress: ({ i, n }) => this._emit({ task, phase: 'validate', model, i, n, pct: Math.round(100 * i / n) }) });
    const tags = await (await this.fetch(`${base}/api/tags`, { signal })).json().catch(() => ({}));
    const hit = (tags.models || []).find(x => x.name === model || x.name === `${model}:latest`);
    if (this.validation) this.validation.set(model, hit ? hit.digest : '', res);
    return res;
  }

  // Si el modelo en uso quedó fuera, pasa al mejor tier instalado que sí pasa (si no hay, el motor corre solo con heurística)
  async _fallback(model) {
    if (!this.o.onFallback || this.cfg.model !== model) return;
    const st = await this.status();
    const verdict = (tag) => { const x = st.tiers.find(y => y.tag === tag); return x.validation === 'pass' ? true : x.validation === 'fail' ? false : null; };
    const inst = validate.offer(st.tiers.filter(x => x.installed), st.recommended.id, null, verdict);
    if (inst.selected && inst.selected !== model) this.o.onFallback(inst.selected);
  }

  // «Probar modelo» y la validación al mostrar un tier ya instalado. Arranca en segundo plano (task 'validate').
  // Sin `force` y con resultado guardado para esta versión del modelo: no hace nada ({ cached:true }).
  async validate(model, { force = false, url } = {}) {
    if (this.task) throw Object.assign(new Error(t('setup.err.busy')), { code: 409 });
    model = String(model || this.cfg.model || '').trim();
    if (!model) throw Object.assign(new Error(t('setup.err.noModel')), { code: 400 });
    const base = String(url || this.apiUrl).replace(/\/+$/, '');
    if (!force && this.validation) {
      const m = await llm.listModels(base, this.cfg.ollama.probeTimeoutMs);
      const d = (m.digests || {})[model] ?? (m.digests || {})[`${model}:latest`];
      if (d !== undefined && this.validation.get(model, d)) return { cached: true, model };
    }
    if (this.task) throw Object.assign(new Error(t('setup.err.busy')), { code: 409 });
    this.task = 'validate'; this.abort = new AbortController();
    const signal = this.abort.signal;
    (async () => {
      try {
        const res = await this._validate(model, base, signal, 'validate');
        this._emit({ task: 'validate', phase: 'done', model, pass: res.pass, reasons: res.reasons, avgMs: res.avgMs, think: res.think, done: true });
        if (this.o.log) this.o.log.info(`ollama: validación de ${model}: ${res.pass ? 'pasó' : 'falló'} (${res.avgMs} ms)`);
        if (!res.pass) await this._fallback(model);
      } catch (e) { this._fail('validate', e, signal); } finally { this.task = null; this.abort = null; }
    })();
    return { started: true, model };
  }

  async _configure(model, base, signal) {
    const c = this.cfg;
    this._emit({ task: 'pull', phase: 'configure', model, pct: 100 });
    const tags = await (await this.fetch(`${base}/api/tags`, { signal })).json();
    if (!(tags.models || []).some(m => m.name === model || m.model === model || m.name === `${model}:latest`)) throw new Error(t('setup.err.verify', { model }));
    const g = await this.fetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any ? AbortSignal.any([signal, AbortSignal.timeout(c.ollama.warmupTimeoutMs)]) : signal,
      body: JSON.stringify({ model, prompt: 'Hola', stream: false, think: false, options: { num_predict: 1 } }),
    });
    if (!g.ok) throw new Error(t('setup.err.warmup', { status: g.status }));
  }
}

module.exports = { OllamaSetup, PullTracker, which, expandEnv, stripAnsi, hostToUrl, candidateUrls };
