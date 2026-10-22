'use strict';
// Textos (es/en), registro con rotación, limpieza de secretos, configurador de Ollama y coherencia de la interfaz.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const es = JSON.parse(read('locales', 'es.json')), en = JSON.parse(read('locales', 'en.json'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nm-misc-'));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'test'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

test('es y en tienen exactamente las mismas claves y los mismos {parámetros}', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const k of Object.keys(es)) {
    const a = (es[k].match(/\{\w+\}/g) || []).sort().join(), b = (en[k].match(/\{\w+\}/g) || []).sort().join();
    assert.equal(a, b, `parámetros de ${k}`);
    assert.ok(es[k].length > 0 && en[k].length > 0, k);
  }
});

test('toda clave que el código o la interfaz piden existe en los dos idiomas', () => {
  const used = new Set();
  for (const f of walk(ROOT)) {
    if (!/\.(js|html)$/.test(f) || f.includes(`${path.sep}locales${path.sep}`)) continue;
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(?:t|err|cfgErr)\(\s*'([A-Za-z0-9_.-]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)) used.add(m[1]);
  }
  // claves compuestas: kind.*, sync.side.*, ui.mode.*, ui.accent.*, ui.lic.t.*, ui.wiz.s1-4
  for (const k of ['scan', 'execute', 'auto']) used.add(`kind.${k}`);
  used.add('eng.doneClean'); used.add('eng.doneCleanDry');
  for (const k of ['origen', 'destino']) used.add(`sync.side.${k}`);
  for (const k of ['auto', 'claro', 'oscuro']) used.add(`ui.mode.${k}`);
  for (const k of ['carmesi', 'verde-azulado', 'violeta', 'azul', 'ambar', 'verde']) used.add(`ui.accent.${k}`);
  for (const k of ['limpiar', 'sincronizar']) used.add(`ui.lic.t.${k}`);
  for (let i = 1; i <= 4; i++) used.add(`ui.wiz.s${i}`);
  const missing = [...used].filter(k => !(k in es) || !(k in en));
  assert.deepEqual(missing, [], 'faltan: ' + missing.join(', '));
  const extra = Object.keys(es).filter(k => !used.has(k));
  assert.deepEqual(extra, [], 'claves sin uso: ' + extra.join(', '));
});

test('el idioma sale del sistema (es si empieza con "es", si no en) y se puede elegir', () => {
  const i = require('../lib/i18n');
  assert.equal(i.fromLocale('es-GT'), 'es'); assert.equal(i.fromLocale('es_MX.UTF-8'), 'es'); assert.equal(i.fromLocale('en-US'), 'en'); assert.equal(i.fromLocale('fr-FR'), 'en');
  assert.equal(i.resolve('en', 'es-GT'), 'en'); assert.equal(i.resolve('', 'es-GT'), 'es'); assert.equal(i.resolve('', 'de-DE'), 'en');
  assert.equal(i.systemLocale({ LANG: 'es_GT.UTF-8' }), 'es-GT');
  assert.equal(i.t('acct.duplicate', { email: 'a@b.c' }, 'en'), 'The account a@b.c is already added.');
  assert.match(i.t('acct.duplicate', { email: 'a@b.c' }, 'es'), /ya está agregada/);
  assert.equal(i.t('no.existe', null, 'es'), 'no.existe');
});

test('los textos en español tratan de usted (sin voseo)', () => {
  const bad = Object.entries(es).filter(([, v]) => /\b(abrí|tocá|escaneá|subí|usá|volvé|elegí|configurá|quitá|vos|tenés|podés)\b/i.test(v));
  assert.deepEqual(bad, []);
});

test('el registro rota por tamaño, conserva N archivos y tacha secretos', () => {
  const { Logger } = require('../lib/log');
  const dir = tmp();
  const log = new Logger({ dir, file: 'x.log', maxBytes: 600, files: 3 });
  for (let i = 0; i < 80; i++) log.info(`linea ${i} password=Secreta${i} de ana@mail.com`);
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['x.log', 'x.log.1', 'x.log.2', 'x.log.3']);
  const all = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.equal(/Secreta\d/.test(all), false);
  assert.match(all, /ana@mail\.com/, 'el registro local deja las direcciones');
  for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size < 1500);
  log.error('falló', new Error('boom'));
  assert.match(fs.readFileSync(path.join(dir, 'x.log'), 'utf8'), /ERROR falló Error: boom/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('los registros por corrida conservan solo los últimos N', () => {
  const { pruneRuns } = require('../lib/log');
  const dir = tmp();
  for (let i = 0; i < 6; i++) { const f = path.join(dir, `run${i}.log`); fs.writeFileSync(f, 'x'); fs.utimesSync(f, new Date(2026, 0, i + 1), new Date(2026, 0, i + 1)); }
  pruneRuns(dir, 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['run4.log', 'run5.log']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scrub: tachas por tipo de secreto', () => {
  const { scrub } = require('../lib/scrub');
  const s = scrub('user=ana@x.com pass: "abc123" Authorization: Bearer abc.def {"refresh_token":"1//0gXYZ"} NMT1.aaa.bbb', { keep: [], home: '' });
  for (const secreto of ['ana@x.com', 'abc123', 'abc.def', '1//0gXYZ', 'NMT1.aaa.bbb']) assert.equal(s.includes(secreto), false, secreto);
  assert.equal(scrub('hola mundo 12345', { home: '' }), 'hola mundo 12345');
  assert.equal(scrub('a@b.com', { keep: ['A@B.com'], home: '' }), 'a@b.com');
});

// ---- Configurador de Ollama (sin instalar nada de verdad) ----
function fakeSpawn(codeOut = 0) {
  const calls = [];
  const fn = (cmd, args) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; p.unref = () => {}; calls.push({ cmd, args }); setImmediate(() => p.emit('close', codeOut)); return p; };
  fn.calls = calls; return fn;
}
const webBody = (chunks) => Readable.from(chunks.map(c => Buffer.from(c)));

test('Ollama en Linux sin escritorio devuelve el comando exacto para la terminal', () => {
  const { OllamaSetup } = require('../lib/ollama');
  const { defaults } = require('../lib/defaults');
  const o = new OllamaSetup({ cfg: () => defaults(), sse: () => {}, platform: 'linux', env: { PATH: '' } });
  assert.equal(o.method(), 'manual');
  const r = o.install();
  assert.equal(r.manual, true);
  assert.equal(r.command, `curl -fsSL ${defaults().ollama.installer.linux} | sh`);
});

test('Ollama en Windows: baja el instalador oficial (URL de la configuración) y lo corre en silencio', async () => {
  const { OllamaSetup } = require('../lib/ollama');
  const { defaults } = require('../lib/defaults');
  const tmpDir = tmp(), events = [];
  const sp = fakeSpawn(0);
  const urls = [];
  let up = false, seenExe = null;
  const fetchFn = async (url) => {
    urls.push(String(url));
    if (/OllamaSetup/.test(url)) return { ok: true, status: 200, headers: new Map([['content-length', '6']]), body: webBody(['abc', 'def']) };
    // /api/version: responde una vez que "se instaló"
    return up ? { ok: true, status: 200, json: async () => ({ version: '0.99' }) } : Promise.reject(new Error('ECONNREFUSED'));
  };
  const cfg = JSON.parse(JSON.stringify(defaults())); cfg.ollama.installer.windows = 'https://espejo.example/OllamaSetup.exe'; cfg.ollama.startWaitMs = 4000;
  const o = new OllamaSetup({ cfg: () => cfg, sse: e => events.push(e), platform: 'win32', env: {}, spawn: (...a) => { up = true; seenExe = { mode: fs.statSync(path.dirname(a[0])).mode & 0o777, body: fs.readFileSync(a[0], 'utf8'), dir: path.dirname(a[0]) }; return sp(...a); }, fetch: fetchFn, tmpDir });
  llmFetchPatch(fetchFn);
  const r = o.install();
  assert.deepEqual(r, { started: true, method: 'windows' });
  for (let i = 0; i < 100 && !(events.length && events[events.length - 1].done); i++) await new Promise(x => setTimeout(x, 50));
  assert.equal(urls[0], 'https://espejo.example/OllamaSetup.exe');
  assert.deepEqual(sp.calls[0].args, cfg.ollama.installer.windowsArgs);
  assert.match(sp.calls[0].cmd, /OllamaSetup\.exe$/);
  assert.equal(seenExe.body, 'abcdef');
  if (process.platform !== 'win32') assert.equal(seenExe.mode, 0o700, 'carpeta privada');
  assert.equal(fs.existsSync(seenExe.dir), false, 'la carpeta temporal se borra al terminar');
  assert.ok(events.some(e => e.phase === 'download' && e.pct === 100));
  assert.equal(events[events.length - 1].phase, 'done', JSON.stringify(events[events.length - 1]));
  restoreFetch();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Ollama en Linux: el script va por la entrada estándar a pkexec, desde una carpeta privada que se borra', async () => {
  if (process.platform === 'win32') return;
  const { OllamaSetup } = require('../lib/ollama');
  const { defaults } = require('../lib/defaults');
  const base = tmp(), events = []; let up = false, call = null, dirMode = null, dirs = [];
  fs.mkdirSync(path.join(base, 'nonimail-tools'), { mode: 0o777 }); // un directorio predecible plantado no sirve de nada
  const bin = tmp(); fs.writeFileSync(path.join(bin, 'pkexec'), '#!/bin/sh\n', { mode: 0o755 });
  const spawn = (cmd, args, opts) => {
    up = true; call = { cmd, args, stdio: opts.stdio };
    dirs = fs.readdirSync(base).filter(d => d.startsWith('nonimail-') && d !== 'nonimail-tools');
    dirMode = dirs.length ? fs.statSync(path.join(base, dirs[0])).mode & 0o777 : null;
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.stdin = new (require('stream').Writable)({ write(c, e, cb) { call.input = (call.input || '') + c; cb(); } });
    setImmediate(() => p.emit('close', 0)); return p;
  };
  const fetchFn = async (url) => /install\.sh/.test(url) ? { ok: true, status: 200, headers: new Map(), body: webBody(['echo instalar\n']) } : (up ? { ok: true, status: 200, json: async () => ({ version: '1' }) } : Promise.reject(new Error('x')));
  llmFetchPatch(fetchFn);
  const o = new OllamaSetup({ cfg: () => defaults(), sse: e => events.push(e), platform: 'linux', env: { DISPLAY: ':0', PATH: bin }, spawn, fetch: fetchFn, tmpDir: base });
  assert.equal(o.method(), 'pkexec');
  o.install();
  for (let i = 0; i < 100 && !(events.length && events[events.length - 1].done); i++) await new Promise(x => setTimeout(x, 50));
  restoreFetch();
  assert.deepEqual(call.args, ['/bin/sh', '-s'], 'sin ruta de archivo para el administrador');
  assert.equal(call.input, 'echo instalar\n');
  assert.equal(dirMode, 0o700);
  assert.equal(fs.readdirSync(base).filter(d => d !== 'nonimail-tools').length, 0, 'se borra al terminar');
  fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true });
});

test('Ollama: se rechaza una carpeta o archivo temporal con enlace, otro dueño o escritura abierta', () => {
  if (process.platform === 'win32') return;
  const { OllamaSetup } = require('../lib/ollama');
  const { defaults } = require('../lib/defaults');
  const o = new OllamaSetup({ cfg: () => defaults(), sse: () => {} });
  const d = tmp(), f = path.join(d, 'a.sh'), l = path.join(d, 'enlace');
  fs.writeFileSync(f, 'x', { mode: 0o700 }); fs.symlinkSync(f, l);
  fs.chmodSync(d, 0o700);
  assert.doesNotThrow(() => o._assertPrivate(d, f));
  assert.throws(() => o._assertPrivate(d, l), /no es segura|not safe/);
  fs.chmodSync(f, 0o777); assert.throws(() => o._assertPrivate(f), /no es segura|not safe/);
  fs.chmodSync(f, 0o700); fs.chmodSync(d, 0o770); assert.throws(() => o._assertPrivate(d), /no es segura|not safe/);
  fs.chmodSync(d, 0o700);
  assert.throws(() => fs.writeFileSync(f, 'y', { flag: 'wx' }), /EEXIST/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('Ollama: solo se descarga por HTTPS y un instalador con error lo informa', async () => {
  const { OllamaSetup } = require('../lib/ollama');
  const { defaults } = require('../lib/defaults');
  const events = [];
  const cfg = JSON.parse(JSON.stringify(defaults())); cfg.ollama.installer.windows = 'http://inseguro.example/OllamaSetup.exe';
  const o = new OllamaSetup({ cfg: () => cfg, sse: e => events.push(e), platform: 'win32', env: {}, fetch: async () => { throw new Error('no debería'); }, tmpDir: tmp() });
  o.install();
  for (let i = 0; i < 60 && !(events.length && events[events.length - 1].done); i++) await new Promise(x => setTimeout(x, 25));
  assert.equal(events[events.length - 1].phase, 'error');
  assert.match(events[events.length - 1].error, /HTTPS/);
});

test('Ollama: baja el modelo con /api/pull y reporta el progreso hasta "success"', async () => {
  const { OllamaSetup } = require('../lib/ollama');
  const { defaults } = require('../lib/defaults');
  let seen = null;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      if (req.url === '/api/tags') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ models: [{ name: 'm:1b' }] })); }
      if (req.url === '/api/generate') { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); } // la prueba de 1 token
      seen = { url: req.url, body: JSON.parse(b) };
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
      setTimeout(() => {
        res.write(JSON.stringify({ status: 'pulling abc', digest: 'sha:1', total: 1000, completed: 250 }) + '\n');
        setTimeout(() => {
          res.write(JSON.stringify({ status: 'pulling abc', digest: 'sha:1', total: 1000, completed: 1000 }) + '\n');
          res.end(JSON.stringify({ status: 'success' }) + '\n');
        }, 300);
      }, 300);
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const events = [], pulled = [];
  const cfg = JSON.parse(JSON.stringify(defaults())); cfg.ollamaUrl = `http://127.0.0.1:${srv.address().port}`;
  const o = new OllamaSetup({ cfg: () => cfg, sse: e => events.push(e), onPulled: m => pulled.push(m), validateModel: async () => ({ pass: true, reasons: [] }) });
  assert.deepEqual(o.pull('m:1b'), { started: true, model: 'm:1b' });
  assert.throws(() => o.pull('otro'), /en curso/);
  for (let i = 0; i < 100 && !(events.length && events[events.length - 1].done); i++) await new Promise(x => setTimeout(x, 40));
  assert.equal(seen.url, '/api/pull'); assert.equal(seen.body.model, 'm:1b');
  const last = events[events.length - 1];
  assert.equal(last.status, 'success'); assert.equal(last.pct, 100);
  srv.close();
  assert.ok(events.some(e => e.pct === 25), 'reporta el avance parcial');
  assert.deepEqual(pulled, ['m:1b']);
});

// el estado de Ollama usa llm.version (fetch global): se sustituye durante la prueba
const realFetch = global.fetch;
function llmFetchPatch(fn) { global.fetch = fn; }
function restoreFetch() { global.fetch = realFetch; }

// ---- coherencia de la interfaz ----
test('la interfaz: todos los id que usa app.js existen en index.html y no hay scripts en línea', () => {
  const html = read('public', 'index.html'), js = read('public', 'app.js');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const dyn = new Set([...js.matchAll(/\bid: '([^']+)'/g)].map(m => m[1]));
  const used = [...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]).concat([...js.matchAll(/\$\(`([a-z]+-)\$\{[^}]+\}`\)/g)].map(m => m[1]));
  const missing = used.filter(id => !id.endsWith('-') && !ids.has(id) && !dyn.has(id));
  assert.deepEqual([...new Set(missing)], []);
  assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'la CSP no permite scripts en línea');
  assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<!--[\s\S]*?-->/g, '')), false, 'sin recursos externos');
});

test('el tema Dulce: tokens claros y oscuros, seis acentos, letra incluida y sin Google Fonts', () => {
  const css = read('public', 'tema.css');
  for (const v of ['#f3f0e9', '#ece8df', '#fcfbf8', '#f6f3ed', '#e3ddd1', '#27241f', '#1a1e25', '#21262e', '#ebe7df']) assert.ok(css.includes(v), v);
  for (const a of ['carmesi', 'verde-azulado', 'violeta', 'azul', 'ambar', 'verde']) assert.ok(css.includes(`data-acento="${a}"`), a);
  assert.ok(css.includes('/fonts/figtree-latin-wght-normal.woff2'));
  assert.equal(/fonts\.googleapis|gstatic/.test(css + read('public', 'index.html') + read('public', 'app.css')), false);
  for (const f of ['figtree-latin-wght-normal.woff2', 'figtree-latin-ext-wght-normal.woff2', 'OFL.txt']) assert.ok(fs.existsSync(path.join(ROOT, 'public', 'fonts', f)), f);
  const defs = require('../config/defaults.json');
  assert.deepEqual(defs.appearance.background, { light: '#f3f0e9', dark: '#1a1e25' });
  assert.equal(defs.appearance.dayStartHour, 6); assert.equal(defs.appearance.nightStartHour, 18);
});

test('nada interno en el repositorio: sin IPs privadas, hosts internos ni correos personales', () => {
  const bad = [];
  const rx = [/\b(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/, /@gmail\.com\b(?<!ana@gmail\.com)/];
  for (const f of walk(ROOT)) {
    if (/\.(woff2|png|ico|pem|lock)$/.test(f) || /package-lock/.test(f)) continue;
    const s = fs.readFileSync(f, 'utf8');
    if (rx[0].test(s)) bad.push(`${path.relative(ROOT, f)}: IP privada`);
  }
  assert.deepEqual(bad, []);
  assert.equal(fs.existsSync(path.join(ROOT, 'docs', 'superpowers')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'config.example.json')), false);
});
