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

test('sin IA, un remitente personal sin baja ni señales de ruido no sube del puntaje base', () => {
  const { defaults } = require('../lib/defaults');
  const d = defaults(), rules = c.compileRules(d.heuristics);
  const s = c.heuristicScore(rules, d.heuristicScore, { subjects: ['Re: cena del viernes', 'hola'], from: 'Ana Pérez <ana@amiga.com>', bulk: false, body: 'nos vemos a las 8' });
  assert.ok(s <= 20, `puntaje ${s}`);
  const promo = c.heuristicScore(rules, d.heuristicScore, { subjects: ['50% OFF solo hoy'], from: 'ofertas@tienda.com', bulk: true, body: 'unsubscribe' });
  assert.ok(promo >= 80, `puntaje ${promo}`);
});

test('el escaneo protege la respuesta personal (Re:, In-Reply-To) sin baja, no la de un boletín', () => {
  const { Engine } = require('../lib/engine');
  const { defaults } = require('../lib/defaults');
  const cfg = JSON.parse(JSON.stringify(defaults()));
  const eng = new Engine({ cfg: () => cfg, senderRules: () => ({}) });
  const ctx = { cfg, mine: new Set(), rules: c.compileRules({}), senderRules: {} };
  const score = (meta) => { const g = { email: meta.email }; eng._initialScore(g, ctx, { from: meta.email, ...meta }); return g; };
  assert.deepEqual([score({ email: 'ana@amiga.com', subject: 'Re: cena del viernes' }).score, score({ email: 'ana@amiga.com', subject: 'Re: cena del viernes' }).reason], [0, 'conversación']);
  assert.equal(score({ email: 'b@x.com', subject: 'cena', inReplyTo: '<a@b>' }).score, 0);
  assert.equal(score({ email: 'c@x.com', subject: 'cena', references: '<a@b>' }).score, 0);
  assert.equal(score({ email: 'ofertas@t.com', subject: 'Re: oferta', listUnsubscribe: '<mailto:x@y>' }).score, null, 'con baja es envío masivo');
  assert.equal(score({ email: 'd@x.com', subject: 'hola' }).score, null, 'sin señales de respuesta se puntúa normal');
  cfg.cleaning.protectConversations = false;
  assert.equal(score({ email: 'ana@amiga.com', subject: 'Re: cena' }).score, null, 'si se apaga la protección, no aplica');
});
