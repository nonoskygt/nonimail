'use strict';
// Dependencias de la IA: orden de detección, recomendación por equipo, progreso de /api/pull, cancelar y cerrar ventana.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { defaults } = require('../lib/defaults');
const { OllamaSetup, PullTracker } = require('../lib/ollama');
const { recommend } = require('../lib/hardware');
const { resolveClose, trayUsable } = require('../lib/closeaction');

const GB = 1024 ** 3;
const cfgOf = () => JSON.parse(JSON.stringify(defaults()));
const realFetch = globalThis.fetch;
const apiAt = (upUrls, state) => async (url) => {
  const u = String(url);
  if (upUrls().some(b => u.startsWith(b))) return { ok: true, status: 200, json: async () => (u.endsWith('/api/tags') ? { models: [] } : { version: '0.9' }) };
  throw new Error('ECONNREFUSED');
};
const setup = (o) => new OllamaSetup({ cfg: cfgOf, sse: () => {}, detectHardware: async () => ({ ramBytes: 16 * GB, gpu: null }), ...o });

test('detección: API arriba, ejecutable sin correr (se arranca solo) y nada instalado', async () => {
  const cfg = cfgOf(); cfg.ollama.startWaitMs = 4000;
  let up = [];
  globalThis.fetch = apiAt(() => up);
  try {
    // 1) la API contesta en localhost aunque la config diga 127.0.0.1 (y OLLAMA_HOST apunte a otro lado): corriendo
    up = ['http://localhost:11434'];
    let o = setup({ cfg: () => cfg, platform: 'win32', env: { OLLAMA_HOST: '0.0.0.0:11500' }, exists: () => false });
    let d = await o.detect();
    assert.deepEqual([d.installed, d.running, d.url], [true, true, 'http://localhost:11434']);
    // OLLAMA_HOST sirve de candidata
    up = ['http://127.0.0.1:11500'];
    d = await o.detect(); assert.equal(d.url, 'http://127.0.0.1:11500');

    // 2) API caída, pero el ejecutable está en la ruta de %LOCALAPPDATA%: instalado, sin correr; start() lo levanta
    up = [];
    const exe = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Ollama\\ollama.exe';
    const launched = [];
    o = setup({
      cfg: () => cfg, platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, exists: (f) => f === exe,
      spawn: (cmd, args) => { launched.push({ cmd, args }); up = ['http://127.0.0.1:11434']; return { on() {}, unref() {} }; },
    });
    d = await o.detect();
    assert.deepEqual([d.installed, d.running, d.exe], [true, false, exe], 'instalado y sin correr, nunca "no instalado"');
    o.start();
    for (let i = 0; i < 100 && o.task; i++) await new Promise(r => setTimeout(r, 50));
    assert.equal(launched.length, 1); assert.deepEqual(launched[0].args, ['serve']);
    assert.equal(o.last.phase, 'done');
    assert.equal((await o.status()).running, true);

    // 3) ejecutable solo en el PATH (Linux)
    up = [];
    const fs = require('fs'), os = require('os'), path = require('path');
    // en Windows el ejecutable falso es un .cmd (con PATHEXT); en Linux, un script
    const win = process.platform === 'win32', name = win ? 'ollama.cmd' : 'ollama';
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fakebin-')); fs.writeFileSync(path.join(bin, name), win ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o755 });
    d = await setup({ cfg: () => cfg, platform: process.platform, env: { PATH: bin, PATHEXT: '.EXE;.CMD' }, exists: () => false }).detect();
    assert.deepEqual([d.installed, d.running], [true, false]); assert.equal(d.exe.toLowerCase(), path.join(bin, name).toLowerCase());
    fs.rmSync(bin, { recursive: true, force: true });

    // 4) nada por ningún lado: ahora sí, no instalado
    d = await setup({ cfg: () => cfg, platform: process.platform, env: { PATH: '' }, exists: () => false }).detect();
    assert.deepEqual([d.installed, d.running], [false, false]);
  } finally { globalThis.fetch = realFetch; }
});

test('recomendación del modelo según el equipo', () => {
  const tiers = defaults().ollama.tiers;
  const r = (ramGb, vramGb) => recommend(tiers, { ramBytes: ramGb * GB, gpu: vramGb ? { vramBytes: vramGb * GB } : null });
  assert.deepEqual(r(16, 6), { id: 'basic', mode: 'gpu', warn: false });    // NVIDIA 6 GB
  assert.deepEqual(r(16, 0), { id: 'basic', mode: 'cpu', warn: false });    // 16 GB sin GPU
  assert.deepEqual(r(8, 0), { id: 'basic', mode: 'low', warn: true });      // no cabe nada: básico y aviso
});

test('progreso de /api/pull: suma las capas y calcula completed/total', () => {
  const p = new PullTracker();
  assert.equal(p.feed('{"status":"pulling manifest"}').pct, null);
  p.feed('{"status":"pulling a","digest":"a","total":1000,"completed":100}');
  let x = p.feed('{"status":"pulling b","digest":"b","total":3000,"completed":900}');
  assert.deepEqual([x.total, x.completed, x.pct], [4000, 1000, 25]);
  x = p.feed('{"status":"pulling a","digest":"a","total":1000,"completed":1000}');
  assert.equal(x.completed, 1900);
  assert.equal(p.feed('basura'), null);
  assert.throws(() => p.feed('{"error":"pull model manifest: file does not exist"}'), /file does not exist/);
  assert.equal(p.feed('{"status":"success"}').status, 'success');
});

test('cancelar una descarga aborta la petición y deja el estado limpio', async () => {
  let aborted = false;
  const events = [];
  const fetchFn = async (url, opts) => ({
    ok: true, status: 200,
    body: (async function* () {
      yield Buffer.from('{"status":"pulling a","digest":"a","total":100,"completed":10}\n');
      await new Promise((_, rej) => opts.signal.addEventListener('abort', () => { aborted = true; rej(Object.assign(new Error('abortado'), { name: 'AbortError' })); }));
    })(),
  });
  const o = setup({ sse: e => events.push(e), fetch: fetchFn, platform: 'linux', env: {} });
  o.pull('qwen3.5:2b');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(o.task, 'pull');
  o.cancel();
  for (let i = 0; i < 50 && o.task; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(aborted, true);
  assert.equal(o.task, null); assert.equal(o.abort, null);
  const last = events[events.length - 1];
  assert.deepEqual([last.cancelled, last.done], [true, true]);
  assert.doesNotThrow(() => o.pull('qwen3.5:2b')); // se puede reintentar
  o.cancel();
});

test('botón de cerrar: preguntar, recordar, bandeja y sin bandeja', () => {
  assert.deepEqual(resolveClose('ask', true), { act: 'ask' });
  assert.deepEqual(resolveClose('ask', true, { quit: false, remember: true }), { act: 'hide', remember: 'minimize' });
  assert.deepEqual(resolveClose('ask', true, { quit: true, remember: false }), { act: 'quit', remember: undefined });
  assert.deepEqual(resolveClose('minimize', true), { act: 'hide', remember: undefined });
  assert.deepEqual(resolveClose('quit', true), { act: 'quit', remember: undefined });
  assert.equal(resolveClose('minimize', false).act, 'minimize', 'sin bandeja: minimizar normal');
  assert.equal(resolveClose('raro', true).act, 'ask');
  assert.equal(trayUsable('linux', { DISPLAY: ':0', XDG_CURRENT_DESKTOP: 'GNOME' }, true), false);
  assert.equal(trayUsable('linux', { DISPLAY: ':0', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, true), true);
  assert.equal(trayUsable('win32', {}, true), true);
});
