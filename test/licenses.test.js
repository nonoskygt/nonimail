'use strict';
// Puerta de licencias: cuentas personales gratis, comerciales solo simulan hasta tener clave NMT1 firmada (Ed25519).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Licenses, BUNDLED_KEY } = require('../lib/licenses');
const { esPersonal, esCorreo, dominioDe, DOMINIOS_PUBLICOS } = require('../lib/licenses/domains');
const { defaults } = require('../lib/defaults');
const C = require('../lib/config');
const { makeKeys } = require('./helpers/keys');

let keys, dir, cfg, lic, posts, verifyReply;
const mk = (opts = {}) => new Licenses({ file: path.join(dir, `lic-${Math.random().toString(36).slice(2)}.json`), getConfig: () => cfg, fetch: opts.fetch || fakeFetch, ...opts });
const fakeFetch = async (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); if (verifyReply === 'down') throw new Error('sin red'); return { ok: true, json: async () => verifyReply }; };

before(() => {
  keys = makeKeys();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-lic-'));
  cfg = C.deepDefaults(defaults(), { licenses: { publicKeyFile: keys.pubFile }, service: { url: 'https://mt.example.test' } });
  posts = []; verifyReply = { valida: true };
});
after(() => { keys.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

test('la lista de dominios públicos es la del servicio web (mt.nonosky.com)', () => {
  // si dominios.py cambia en el servicio, esta huella cambia aquí a propósito
  const h = crypto.createHash('sha256').update([...DOMINIOS_PUBLICOS].sort().join('\n')).digest('hex');
  assert.equal(DOMINIOS_PUBLICOS.size, 104);
  assert.equal(h, '7560b76fde6ea8472af51427cf5cd2814a9769eed74d4badca1e410104cad446');
});

test('personal o comercial según el dominio', () => {
  for (const e of ['ana@gmail.com', 'ANA@Gmail.com', 'a@hotmail.es', 'a@outlook.com.mx', 'a@yahoo.com.ar', 'a@icloud.com', 'a@proton.me', 'a@live.cl']) assert.equal(esPersonal(e), true, e);
  for (const e of ['ana@empresa.com', 'info@lablpq.com', 'a@mail.gmail.com.evil.io', 'a@hotmail.evil.com.br.x']) assert.equal(esPersonal(e), false, e);
  assert.equal(esPersonal('no-es-correo'), false);
  assert.equal(esCorreo('no-es-correo'), false);
  assert.equal(dominioDe(' Ana@Empresa.COM. '), 'empresa.com');
});

test('la clave pública que se empaqueta existe y es Ed25519', () => {
  const k = crypto.createPublicKey(fs.readFileSync(BUNDLED_KEY));
  assert.equal(k.asymmetricKeyType, 'ed25519');
});

test('cuenta personal: siempre permitido y sin licencia', () => {
  const g = mk().gate('ana@gmail.com', 'limpiar');
  assert.equal(g.permitido, true); assert.equal(g.personal, true);
  assert.equal(mk().gate(['a@gmail.com', 'b@hotmail.com'], 'sincronizar').permitido, true);
});

test('cuenta comercial sin clave: no permitido, con precio y enlace de compra', () => {
  const g = mk().gate('ana@empresa.com', 'sincronizar');
  assert.equal(g.permitido, false); assert.equal(g.personal, false);
  assert.equal(g.precio, '2'); assert.equal(g.moneda, 'USD'); assert.equal(g.dias, 30);
  const u = new URL(g.comprar);
  assert.equal(u.origin, 'https://mt.example.test'); assert.equal(u.pathname, '/licencias.html');
  assert.equal(u.searchParams.get('cuenta'), 'ana@empresa.com'); assert.equal(u.searchParams.get('tipo'), 'sincronizar'); assert.equal(u.searchParams.get('canal'), 'app');
  assert.equal(mk().gate('ana@empresa.com', 'limpiar').precio, '1');
  assert.match(g.motivo, /empresa\.com/);
});

test('con clave válida de esa cuenta y función se abre; otra función u otra cuenta, no', async () => {
  const L = mk();
  const r = await L.add(keys.sign({ cuenta: 'Ana@Empresa.com', tipo: 'limpiar' }));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.licencia.cuenta, 'ana@empresa.com');
  assert.equal(L.gate('ana@empresa.com', 'limpiar').permitido, true);
  assert.equal(L.gate('ana@empresa.com', 'sincronizar').permitido, false, 'una clave por función');
  assert.equal(L.gate('otra@empresa.com', 'limpiar').permitido, false, 'una clave por cuenta');
  assert.equal(L.gate(['ana@empresa.com', 'x@gmail.com'], 'limpiar').permitido, true);
  assert.equal(L.gate(['x@gmail.com', 'ana@empresa.com'], 'limpiar').personal, false, 'si hay una comercial licenciada, se informa como tal');
  assert.equal(L.list().length, 1);
  assert.equal(L.list()[0].vigente, true);
  // persiste en disco y se relee
  const again = new Licenses({ file: L.file, getConfig: () => cfg });
  assert.equal(again.gate('ana@empresa.com', 'limpiar').permitido, true);
});

test('una licencia del servicio web (canal web) también vale', async () => {
  const L = mk();
  assert.equal((await L.add(keys.sign({ cuenta: 'web@empresa.com', tipo: 'sincronizar', canal: 'web' }))).ok, true);
  const g = L.gate('web@empresa.com', 'sincronizar');
  assert.equal(g.permitido, true); assert.equal(g.canal, 'web');
});

test('claves rechazadas: formato, firma ajena, manipulada, vencida, incompleta', async () => {
  const L = mk();
  assert.equal((await L.add('')).ok, false);
  assert.equal((await L.add('ABC.def.ghi')).ok, false);
  const otra = makeKeys();
  assert.match((await L.add(otra.sign())).error, /firma/i);
  otra.cleanup();
  const ok = keys.sign({ cuenta: 'x@empresa.com' });
  const [h, p, s] = ok.split('.');
  const forged = JSON.parse(Buffer.from(p, 'base64url')); forged.cuenta = 'otro@empresa.com';
  assert.match((await L.add(`${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`)).error, /firma/i, 'cambiar la cuenta rompe la firma');
  const now = Math.floor(Date.now() / 1000);
  assert.match((await L.add(keys.sign({ cuenta: 'v@empresa.com', exp: now - 10 }))).error, /venci/i);
  assert.match((await L.add(keys.sign({ tipo: 'otra-cosa' }))).error, /incompleta/i);
  assert.equal(L.list().length, 0);
});

test('una licencia vencida deja de abrir la puerta', async () => {
  const L = mk();
  await L.add(keys.sign({ cuenta: 'v@empresa.com' }));
  assert.equal(L.gate('v@empresa.com', 'limpiar').permitido, true);
  L.keys[0].exp = Math.floor(Date.now() / 1000) - 5;
  assert.equal(L.gate('v@empresa.com', 'limpiar').permitido, false);
  assert.equal(L.list()[0].vigente, false);
});

test('editar licenses.json a mano no abre la puerta (se vuelve a validar la firma)', async () => {
  const L = mk();
  await L.add(keys.sign({ cuenta: 'real@empresa.com' }));
  const row = { ...L.keys[0], cuenta: 'falsa@empresa.com' };
  L.keys.push(row);
  assert.equal(L.gate('falsa@empresa.com', 'limpiar').permitido, false);
  assert.equal(L.gate('real@empresa.com', 'limpiar').permitido, true);
});

test('con red se consulta si la licencia fue anulada; sin red basta la firma', async () => {
  posts.length = 0; verifyReply = { valida: false, motivo: 'anulada' };
  assert.match((await mk().add(keys.sign({ cuenta: 'a@empresa.com' }))).error, /anulada/);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://mt.example.test/api/licencias/verificar');
  verifyReply = 'down';
  assert.equal((await mk().add(keys.sign({ cuenta: 'b@empresa.com' }))).ok, true, 'sin internet se acepta por la firma');
  verifyReply = { valida: true };
  posts.length = 0;
  assert.equal((await mk().add(keys.sign({ cuenta: 'c@empresa.com' }), { online: false })).ok, true);
  assert.equal(posts.length, 0);
});

test('quitar una licencia', async () => {
  const L = mk();
  const r = await L.add(keys.sign({ cuenta: 'q@empresa.com' }));
  assert.equal(L.remove(r.licencia.id), true);
  assert.equal(L.gate('q@empresa.com', 'limpiar').permitido, false);
  assert.equal(L.remove('no-existe'), false);
});

test('el archivo de licencias queda con permisos 0600', async () => {
  if (process.platform === 'win32') return;
  const L = mk(); await L.add(keys.sign({ cuenta: 'm@empresa.com' }));
  assert.equal(fs.statSync(L.file).mode & 0o777, 0o600);
});
