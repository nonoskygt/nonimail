'use strict';
// Telemetría (contrato v1 de TELEMETRIA.md): consentimiento, cola en disco, lotes, reintentos y limpieza de secretos.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Telemetry, downloadOrigin } = require('../lib/telemetry');
const C = require('../lib/config');
const { defaults } = require('../lib/defaults');
const { startService } = require('./helpers/service');

let service, dir, cfg, tel;
const mk = (extra = {}) => new Telemetry({ dir, getConfig: () => cfg, version: '1.0.0', userEmails: () => ['yo@empresa.com'], origin: 'github', platform: 'linux', arch: 'x64', osVersion: 'Ubuntu 24.04', locale: 'es-GT', ...extra });
const queue = () => JSON.parse(fs.readFileSync(path.join(dir, 'telemetry-queue.json'), 'utf8')).eventos;

before(async () => { service = await startService(); });
after(async () => { await service.close(); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-tel-'));
  cfg = C.deepDefaults(defaults(), { service: { url: service.url }, setup: { done: true }, llm: { enabled: true }, model: 'qwen3.5:2b' });
  service.posts.length = 0; service.status = 200; service.statuses.length = 0;
  tel = mk();
});

test('install_id es un UUID v4 que se conserva entre arranques', () => {
  assert.match(tel.installId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(mk().installId, tel.installId);
});

test('instalación: carga útil del contrato, app desktop y origen de descarga', async () => {
  await tel.sendInstall(true);
  assert.equal(service.installs().length, 1);
  const p = service.installs()[0];
  assert.equal(p.path, '/api/telemetria/v1/instalacion');
  assert.match(p.headers['content-type'], /^application\/json/);
  assert.equal(p.headers['user-agent'], 'NoniMailTools/1.0.0 (linux; x64)');
  assert.deepEqual(Object.keys(p.body).sort(), ['app', 'arch', 'ia_local', 'install_id', 'locale', 'modelo', 'origen_descarga', 'os', 'os_version', 'version', 'zona_horaria'].sort());
  assert.equal(p.body.app, 'desktop'); assert.equal(p.body.os, 'linux'); assert.equal(p.body.origen_descarga, 'github');
  assert.equal(p.body.ia_local, true); assert.equal(p.body.modelo, 'qwen3.5:2b'); assert.equal(p.body.locale, 'es-GT');
  assert.equal(p.body.ip, undefined, 'el cliente no manda su IP');
});

test('instalación: como máximo una vez al día salvo que cambie algo', async () => {
  await tel.sendInstall(true);
  await tel.sendInstall(false);
  assert.equal(service.installs().length, 1);
  cfg.llm.enabled = false;
  await tel.sendInstall(false);
  assert.equal(service.installs().length, 2, 'cambió ia_local');
  assert.equal(service.installs()[1].body.modelo, null);
  tel.state.lastInstallAt = Date.now() - 25 * 3600e3; tel._saveState();
  await tel.sendInstall(false);
  assert.equal(service.installs().length, 3, 'pasaron 24 h');
});

test('origen de la descarga: variable, archivo de la compilación o desconocido', () => {
  const f = path.join(dir, 'build-info.json');
  assert.equal(downloadOrigin({}, f), 'desconocido');
  fs.writeFileSync(f, JSON.stringify({ origen_descarga: 'github' }));
  assert.equal(downloadOrigin({}, f), 'github');
  assert.equal(downloadOrigin({ NMT_ORIGEN_DESCARGA: 'mt' }, f), 'mt');
  assert.equal(downloadOrigin({ NMT_ORIGEN_DESCARGA: 'cualquiera' }, path.join(dir, 'no.json')), 'desconocido');
});

test('eventos: se encolan en disco y salen en un lote con el formato del contrato', async () => {
  tel.track('inicio', {});
  tel.track('cuenta', { cuenta: 'yo@empresa.com', proveedor: 'imap', personal: false });
  tel.track('limpiar', { cuenta: 'yo@empresa.com', fase: 'ejecucion', dry_run: false, revisados: 10, remitentes: 3, movidos: 4, duracion_s: 2, resultado: 'ok', licencia: true, omitido: undefined, vacio: '' });
  assert.equal(queue().length, 3, 'la cola está en disco antes de enviar');
  const r = await tel.flush();
  assert.equal(r.sent, 3);
  const ev = service.posts.filter(p => p.path === '/api/telemetria/v1/eventos');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].path, '/api/telemetria/v1/eventos');
  assert.deepEqual([ev[0].body.install_id, ev[0].body.app, ev[0].body.version], [tel.installId, 'desktop', '1.0.0']);
  assert.deepEqual(ev[0].body.eventos.map(e => e.tipo), ['inicio', 'cuenta', 'limpiar']);
  assert.match(ev[0].body.eventos[0].ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal('omitido' in ev[0].body.eventos[2].datos, false, 'los campos que no aplican se omiten');
  assert.equal('vacio' in ev[0].body.eventos[2].datos, false);
  assert.deepEqual(queue(), [], 'la cola queda vacía tras el 200');
});

test('lotes de máximo 200 eventos y cuerpo de máximo 256 KB', async () => {
  for (let i = 0; i < 450; i++) tel.track('inicio', {});
  assert.equal(queue().length, 450 > 500 ? 500 : 450);
  await tel.flush();
  const posts = service.posts.filter(p => p.path.endsWith('/eventos'));
  assert.deepEqual(posts.map(p => p.body.eventos.length), [200, 200, 50]);
  for (const p of posts) assert.ok(Buffer.byteLength(p.raw) <= 262144);
  // eventos gordos: el lote se parte para no pasar de 256 KB
  service.posts.length = 0;
  const big = 'x'.repeat(100000);
  for (let i = 0; i < 5; i++) tel.track('error', { mensaje: big });
  await tel.flush();
  const posts2 = service.posts.filter(p => p.path.endsWith('/eventos'));
  assert.ok(posts2.length >= 2);
  for (const p of posts2) assert.ok(Buffer.byteLength(p.raw) <= 262144);
  assert.equal(posts2.reduce((a, p) => a + p.body.eventos.length, 0), 5);
});

test('la cola guarda como máximo 500 eventos y descarta los más viejos', () => {
  for (let i = 0; i < 520; i++) tel.track('limpiar', { n: i });
  const q = queue();
  assert.equal(q.length, 500);
  assert.equal(q[0].datos.n, 20); assert.equal(q[499].datos.n, 519);
});

test('4xx: el lote se descarta y no se reintenta', async () => {
  tel.track('inicio', {}); tel.track('inicio', {});
  service.status = 400;
  await tel.flush();
  assert.equal(service.posts.filter(p => p.path.endsWith('/eventos')).length, 1);
  assert.deepEqual(queue(), []);
  service.status = 200;
  await tel.flush();
  assert.equal(service.posts.filter(p => p.path.endsWith('/eventos')).length, 1, 'no hay nada que reintentar');
});

test('5xx o sin red: el lote se conserva y se reintenta después', async () => {
  tel.track('inicio', {});
  service.status = 503;
  const r1 = await tel.flush();
  assert.equal(r1.retry, true);
  assert.equal(queue().length, 1, 'sigue en la cola');
  service.status = 200;
  const r2 = await tel.flush();
  assert.equal(r2.sent, 1); assert.deepEqual(queue(), []);
  // sin red
  const sinRed = mk({ fetch: async () => { throw new Error('ECONNREFUSED'); } });
  sinRed.track('inicio', {});
  const r3 = await sinRed.flush();
  assert.equal(r3.retry, true);
  assert.equal(sinRed.queue.length, 1);
  assert.equal(queue().length, 1, 'persistida en disco para el próximo arranque');
  const next = mk();
  assert.equal(next.queue.length, 1, 'otro arranque la recupera');
  await next.flush();
  assert.deepEqual(queue(), []);
});

test('consentimiento apagado: no se encola ni se envía nada, ni la instalación', async () => {
  cfg.telemetry.enabled = false;
  assert.equal(tel.track('inicio', {}), false);
  tel.error(new Error('boom'), 'app');
  assert.equal(await tel.sendInstall(true), null);
  await tel.flush();
  assert.equal(service.posts.length, 0);
  assert.equal(fs.existsSync(path.join(dir, 'telemetry-queue.json')), false);
});

test('apagar la telemetría vacía lo que estaba por enviar', async () => {
  tel.track('inicio', {}); tel.track('inicio', {});
  cfg.telemetry.enabled = false; tel.setConsent(false);
  assert.deepEqual(queue(), []);
  await tel.flush();
  assert.equal(service.posts.length, 0);
});

test('sin terminar el configurador no se envía nada (se conserva la cola)', async () => {
  cfg.setup.done = false;
  tel.track('inicio', {});
  await tel.flush();
  assert.equal(service.posts.length, 0);
  assert.equal(queue().length, 1);
  cfg.setup.done = true;
  await tel.flush();
  assert.equal(service.posts.filter(p => p.path.endsWith('/eventos')).length, 1);
});

test('errores: se tachan contraseñas, tokens, claves de licencia y correos ajenos; la pila se recorta', async () => {
  const e = new Error('IMAP falló para ana@ajena.com con password=Sup3rSecreta y yo@empresa.com; Bearer abc.def.ghi; clave NMT1.eyJ2IjoxfQ.firmaFirmaFirma; token ya29.A0ARrdaMsecretoSecreto');
  e.stack = `Error: ${e.message}\n    at ${os.homedir()}/proyecto/lib/x.js:1:1\n` + '    at algo (lib/y.js:2:2)\n'.repeat(500);
  tel.error(e, 'limpiar', 'yo@empresa.com');
  const ev = queue()[0];
  assert.equal(ev.tipo, 'error');
  assert.equal(ev.datos.contexto, 'limpiar'); assert.equal(ev.datos.cuenta, 'yo@empresa.com');
  const txt = JSON.stringify(ev);
  for (const secreto of ['ana@ajena.com', 'Sup3rSecreta', 'abc.def.ghi', 'eyJ2IjoxfQ', 'firmaFirma', 'ya29.A0ARrdaM', `${os.homedir()}/proyecto`]) assert.equal(txt.includes(secreto), false, secreto);
  assert.ok(ev.datos.mensaje.includes('yo@empresa.com'), 'las cuentas del propio usuario se conservan');
  assert.ok(ev.datos.pila.length <= 4000);
  assert.ok(ev.datos.mensaje.length <= 1000);
});

test('shutdown: un último envío con tiempo máximo', async () => {
  tel.track('cuenta', { cuenta: 'a@b.com' });
  await tel.shutdown(2000);
  assert.equal(service.events().length, 1);
  const lento = mk({ fetch: () => new Promise(() => {}) });
  lento.track('inicio', {});
  const t0 = Date.now(); await lento.shutdown(150);
  assert.ok(Date.now() - t0 < 1500, 'no se cuelga al cerrar');
});

test('un temporizador reenvía cada intervalo configurado', async () => {
  cfg.telemetry.flushIntervalMs = 60;
  const t = mk(); t.start();
  t.track('inicio', {});
  for (let i = 0; i < 40 && queue().length; i++) await new Promise(r => setTimeout(r, 25));
  await t.shutdown();
  assert.ok(service.events().some(e => e.tipo === 'inicio'));
});
