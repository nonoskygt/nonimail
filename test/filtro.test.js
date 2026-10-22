'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const F = require('../lib/filtro');

test('califica solo masivos de dominio propio y corrigio compara con el motor', () => {
  assert.equal(F.califica({ email: 'ofertas@tienda.com', lu: '<mailto:x@y>' }), true);
  assert.equal(F.califica({ email: 'noreply@banco.com.gt' }), true);
  assert.equal(F.califica({ email: 'ana@amiga.com' }), false, 'persona sin baja ni patrón');
  assert.equal(F.califica({ email: 'noreply@gmail.com', lu: 'x' }), false, 'dominio público');
  assert.equal(F.califica({ email: 'x@hotmail.es', lu: 'x' }), false);
  assert.equal(F.dominioRegistrable('A@News.Tienda.com.gt'), 'tienda.com.gt');
  assert.equal(F.corrigio('conservar', 70), true);
  assert.equal(F.corrigio('nunca', 69), false);
  assert.equal(F.corrigio('eliminar', 30), true);
  assert.equal(F.corrigio('baja', 31), false);
  assert.equal(F.corrigio('eliminar', null), false);
  const [d] = F.armarDecisiones([{ g: { email: 'noreply@tienda.com', lu: 'x', count: 14, score: 92, reason: 'llm', reglas: ['subject'] }, decision: 'conservar' }]);
  assert.deepEqual(d, { dominio: 'tienda.com', senales: { baja: true, noreply: true, reglas: ['subject'], llm: 92, correos: 14 }, decision: 'conservar', corrigio: true });
});

test('firma de la reputación: válida, alterada y dominio con caracteres no ASCII', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const firmar = (o) => ({ ...o, firma: crypto.sign(null, Buffer.from(F.PREFIJO_FIRMA + F.canonico(o), 'utf8'), privateKey).toString('base64url') });
  const base = { v: 1, generado: '2026-10-22T00:00:00Z', dominios: { 'tiendamoda.com': { eliminar_pct: 94, n: 37 }, 'ñandú.gt': { n: 12, eliminar_pct: 3 } } };
  const doc = firmar(base);
  assert.equal(F.canonico(base), '{"dominios":{"tiendamoda.com":{"eliminar_pct":94,"n":37},"ñandú.gt":{"eliminar_pct":3,"n":12}},"generado":"2026-10-22T00:00:00Z","v":1}');
  assert.equal(F.verificar(doc, publicKey), true);
  const mal = JSON.parse(JSON.stringify(doc)); mal.dominios['tiendamoda.com'].eliminar_pct = 10;
  assert.equal(F.verificar(mal, publicKey), false);
  const otra = crypto.generateKeyPairSync('ed25519').publicKey;
  assert.equal(F.verificar(doc, otra), false);
});
