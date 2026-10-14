'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/classify');

test('parseFrom separa nombre y correo', () => {
  assert.deepEqual(c.parseFrom('"Tienda X" <Promo@Tienda.com>'), { email: 'promo@tienda.com', name: 'Tienda X' });
  assert.deepEqual(c.parseFrom('solo@correo.com'), { email: 'solo@correo.com', name: 'solo@correo.com' });
  assert.equal(c.parseFrom('').email, '(desconocido)');
});

test('un patrón vacío nunca coincide (no borra toda la bandeja)', () => {
  const r = c.compileRules({ keepOverride: '', subject: '   ', from: '', body: '' });
  assert.equal(r.subject, null);
  assert.equal(c.isProtected(r, {}, 'a@b.com', 'cualquier cosa', 'a@b.com'), false);
});

test('compileRules rechaza regex inválidos', () => {
  assert.throws(() => c.compileRules({ subject: '(abierto' }));
});

test('isProtected: regla delete desprotege, protect protege, keepOverride protege', () => {
  const r = c.compileRules({ keepOverride: 'estado de cuenta|factura' });
  assert.equal(c.isProtected(r, {}, 'banco@x.com', 'Tu estado de cuenta', ''), true);
  assert.equal(c.isProtected(r, { 'banco@x.com': 'delete' }, 'banco@x.com', 'Tu estado de cuenta', ''), false);
  assert.equal(c.isProtected(r, { 'amigo@x.com': 'protect' }, 'amigo@x.com', 'hola', ''), true);
  assert.equal(c.isProtected(r, {}, 'promo@x.com', '50% off', ''), false);
});

test('looksLikeReply detecta respuestas por cabeceras y asunto', () => {
  assert.equal(c.looksLikeReply({ subject: 'Re: cotización' }), true);
  assert.equal(c.looksLikeReply({ subject: 'RV: reenvío' }), true);
  assert.equal(c.looksLikeReply({ subject: 'Fwd[2]: x' }), true);
  assert.equal(c.looksLikeReply({ subject: 'Oferta', inReplyTo: '<a@b>' }), true);
  assert.equal(c.looksLikeReply({ subject: 'Oferta', references: '<a@b>' }), true);
  assert.equal(c.looksLikeReply({ subject: 'Reebok: nueva colección' }), false);
});

test('isConversation: mi dirección o 2+ remitentes', () => {
  const mine = new Set(['yo@x.com']);
  assert.equal(c.isConversation(['tienda@t.com', 'YO@x.com'], mine), true);
  assert.equal(c.isConversation(['ana@c.com', 'luis@c.com'], mine), true);
  assert.equal(c.isConversation(['news@n.com', 'news@n.com'], mine), false);
});

test('decide aplica dureza y banda de duda', () => {
  assert.equal(c.decide(90, 50, 12), 'delete');
  assert.equal(c.decide(10, 50, 12), 'keep');
  assert.equal(c.decide(55, 50, 12), 'duda');
  assert.equal(c.decide(null, 50, 12), null);
  assert.equal(c.decide(55, 90, 12), 'delete'); // más dureza, umbral más bajo
});

test('htmlToText quita etiquetas, estilos y entidades', () => {
  const t = c.htmlToText('<html><head><style>p{}</style></head><body><h1>Hola</h1><p>Lee &amp; compra&nbsp;ya &#233;&#x41;</p><script>x()</script></body></html>');
  assert.equal(t, 'Hola\nLee & compra ya éA');
});
