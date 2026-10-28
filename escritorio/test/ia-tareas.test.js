'use strict';
// IA de Nonosky (cliente por lotes) y tareas permanentes del servidor (cuentas, dureza mínima y errores).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clasificar, recortar } = require('../lib/ia-nonosky');
const { Tareas, cuentaServidor, durezaServidor, buscar } = require('../lib/tareas');
const { defaults } = require('../lib/defaults');

const cfg = defaults();

test('IA de Nonosky: lotes de 50, 5 asuntos de 200 caracteres y nunca el cuerpo', async () => {
  const lotes = [];
  const call = async (method, p, body) => {
    lotes.push(body.items);
    assert.equal(method, 'POST'); assert.equal(p, '/api/ia/v1/clasificar');
    return { status: 200, ok: true, body: { modelo: 'm', resultados: body.items.map((x, i) => ({ id: x.id, categoria: i % 3 === 0 ? 'promocion' : i % 3 === 1 ? null : 'RARA' })) } };
  };
  const items = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}@x.com`, from: 'X <r@x.com>', subjects: Array.from({ length: 9 }, () => 'a'.repeat(500)), bulk: true, body: 'secreto' }));
  const r = await clasificar(items, { call, cfg });
  assert.equal(r.ok, true);
  assert.deepEqual(lotes.map(l => l.length), [50, 50, 20]);
  for (const it of lotes.flat()) {
    assert.equal(it.subjects.length, 5); assert.ok(it.subjects.every(s => s.length === 200));
    assert.ok(!('body' in it), 'el cuerpo nunca sale del equipo');
  }
  assert.equal(r.categorias.get('r0@x.com'), 'PROMOCION');
  assert.equal(r.categorias.get('r1@x.com'), null);
  assert.equal(r.categorias.get('r2@x.com'), null, 'categoría desconocida = sin respuesta');
  assert.deepEqual(recortar({ id: 1, subjects: ['x'] }, cfg.iaNonosky), { id: '1', from: '', subjects: ['x'], bulk: false });
});

test('IA de Nonosky: 402, 429, 503, sesión vencida y red caída devuelven el motivo sin lanzar', async () => {
  const casos = [[402, /sin suscripción/], [429, /tope diario/], [503, /no disponible/], [401, /sesión vencida/]];
  for (const [status, re] of casos) {
    const r = await clasificar([{ id: 'a', subjects: [] }], { call: async () => ({ status, ok: false, body: { codigo: 'x' } }), cfg });
    assert.equal(r.ok, false); assert.match(r.motivo, re, String(status));
  }
  const red = await clasificar([{ id: 'a' }], { call: async () => { throw Object.assign(new Error('sin red'), { code: 502 }); }, cfg });
  assert.equal(red.ok, false); assert.match(red.motivo, /sin conexión/);
  // falla el segundo lote: se devuelve lo que alcanzó
  let n = 0;
  const parcial = await clasificar(Array.from({ length: 60 }, (_, i) => ({ id: `r${i}` })), {
    call: async (m, p, body) => (n++ ? { status: 503, ok: false } : { status: 200, ok: true, body: { resultados: body.items.map(x => ({ id: x.id, categoria: 'OTRO' })) } }), cfg,
  });
  assert.equal(parcial.ok, false); assert.equal(parcial.categorias.size, 50);
});

test('tareas: la cuenta para el servidor sale de la cuenta guardada; Google necesita contraseña de aplicación', () => {
  const imap = { type: 'imap', email: 'ana@empresa.com', username: 'ana', imap: { host: 'mail.empresa.com', port: 993, secure: true } };
  assert.deepEqual(cuentaServidor(imap, 'pw', cfg.presets), { correo: 'ana@empresa.com', host: 'mail.empresa.com', puerto: 993, usuario: 'ana', password: 'pw', tls: true });
  const g = { type: 'gmail-oauth', email: 'yo@gmail.com', imap: {} };
  assert.deepEqual(cuentaServidor(g, 'app-pass', cfg.presets), { correo: 'yo@gmail.com', host: 'imap.gmail.com', puerto: 993, usuario: 'yo@gmail.com', password: 'app-pass', tls: true });
  assert.throws(() => cuentaServidor(g, '', cfg.presets), /contraseña de aplicación/);
});

test('tareas: la limpieza automática nunca baja de la dureza mínima', () => {
  assert.equal(cfg.tareas.durezaMin, 30);
  assert.equal(durezaServidor(10, cfg), 30);
  assert.equal(durezaServidor(55, cfg), 55);
  assert.equal(durezaServidor(150, cfg), 100);
});

test('tareas: crear manda el consentimiento; errores del servicio con mensaje claro', async () => {
  const pedidos = [];
  let respuesta = { status: 201, ok: true, body: { id: 't1' } };
  const T = new Tareas({ getConfig: () => cfg, auth: { call: async (m, p, b) => { pedidos.push([m, p, b]); return respuesta; } } });
  assert.deepEqual(await T.create({ tipo: 'limpiar' }), { id: 't1' });
  assert.deepEqual(pedidos[0], ['POST', '/api/tareas', { tipo: 'limpiar', consentimiento: true }]);
  await T.patch('t 1', { activa: false });
  assert.deepEqual(pedidos[1].slice(0, 2), ['PATCH', '/api/tareas/t%201']);
  const casos = [
    [{ status: 402, ok: false, body: {} }, 402, /no tiene lugar/],
    [{ status: 409, ok: false, body: {} }, 409, /Ya hay una tarea igual/],
    [{ status: 422, ok: false, body: { codigo: 'credenciales' } }, 422, /No se pudo entrar/],
    [{ status: 400, ok: false, body: { detail: 'Llegó al máximo de 20 tareas.' } }, 400, /máximo de 20/],
    [{ status: 400, ok: false, body: {} }, 400, /máximo de tareas/],
    [{ status: 404, ok: false, body: null }, 503, /todavía no tiene/],
  ];
  for (const [r, code, re] of casos) {
    respuesta = r;
    await assert.rejects(T.create({ tipo: 'limpiar' }), (e) => { assert.equal(e.code, code); assert.match(e.message, re); return true; });
  }
  respuesta = { status: 404, ok: false };
  assert.deepEqual(await T.remove('x'), { ok: true }, 'borrar una que ya no existe no es error');
  const lista = [{ tipo: 'limpiar', cuenta: { correo: 'A@x.com' } }, { tipo: 'sincronizar', cuenta: { correo: 'a@x.com' }, destino: { correo: 'b@x.com' } }];
  assert.equal(buscar(lista, { tipo: 'limpiar', cuenta: 'a@x.com' }), lista[0]);
  assert.equal(buscar(lista, { tipo: 'sincronizar', cuenta: 'a@x.com', destino: 'b@x.com' }), lista[1]);
  assert.equal(buscar(lista, { tipo: 'sincronizar', cuenta: 'a@x.com', destino: 'c@x.com' }), null);
});
