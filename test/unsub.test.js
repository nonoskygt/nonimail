'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const u = require('../lib/unsub');
const S = require('./helpers/servers');

test('parseListUnsubscribe separa https y mailto (ignora http)', () => {
  assert.deepEqual(u.parseListUnsubscribe('<http://a.com/x>, <https://b.com/u?1>, <mailto:baja@b.com>'), { https: 'https://b.com/u?1', mailto: 'mailto:baja@b.com' });
  assert.deepEqual(u.parseListUnsubscribe(''), { https: null, mailto: null });
});

test('nunca abre enlaces hacia la red local', () => {
  for (const url of ['https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.1/admin', 'https://10.0.0.5/', 'https://172.20.1.1/', 'https://[::1]/', 'https://router.local/', 'https://intranet/', 'http://ok.com/x'])
    assert.equal(u.safeHttps(url), false, url);
  assert.equal(u.safeHttps('https://lists.example.com/unsub?id=1'), true);
});

test('resolvesPublic valida las IPs a las que resuelve el nombre, no solo el nombre', async () => {
  assert.equal(await u.resolvesPublic('127.0.0.1'), false);
  assert.equal(await u.resolvesPublic('[::1]'), false);
  assert.equal(await u.resolvesPublic('8.8.8.8'), true);
  assert.equal(await u.resolvesPublic('localhost'), false, 'resuelve a 127.0.0.1');
  assert.equal(await u.resolvesPublic('no-existe.invalid'), false, 'si no resuelve, no se abre');
});

test('si el one-click falla, prueba la baja por correo', async () => {
  const s = await S.startSmtp();
  const smtpOptions = { host: '127.0.0.1', port: s.port, secure: false, requireTLS: false, auth: { user: 'smtpuser', pass: 'smtppass' } };
  const r = await u.unsubscribe({ lu: '<https://baja.tienda.invalid/x>, <mailto:baja@tienda.example?subject=baja>', luPost: 'List-Unsubscribe=One-Click', smtpOptions, from: 'yo@test.local' });
  assert.deepEqual(r, { ok: true, method: 'correo a baja@tienda.example' });
  assert.deepEqual(s.messages[0].to, ['baja@tienda.example']);
  await s.close();
});

test('sin ningún método disponible explica cada intento', async () => {
  const r = await u.unsubscribe({ lu: '<https://192.168.0.1/x>, <mailto:baja@x.com>', luPost: '', smtpOptions: null, from: 'a@b.com' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no seguro/); assert.match(r.error, /no hay SMTP/);
});
