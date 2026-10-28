'use strict';
// Suscripción (1.7.0): comprobante NMTS1 firmado con la llave de las licencias, puerta del plan, renovación de
// GET /api/plan, cubrir cuentas con POST /api/suscripcion/cubrir y los precios de «Planes».
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Licenses } = require('../lib/licenses');
const { PlanSync } = require('../lib/plan');
const { defaults } = require('../lib/defaults');
const C = require('../lib/config');
const { makeKeys } = require('./helpers/keys');

let keys, dir, cfg;
before(() => {
  keys = makeKeys();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-plan-'));
  cfg = C.deepDefaults(defaults(), { licenses: { publicKeyFile: keys.pubFile }, service: { url: 'https://mt.example.test' } });
});
after(() => { keys.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

const now = () => Math.floor(Date.now() / 1000);
// NMTS1 como lo firma el servicio: payload compacto, firma Ed25519 sobre «NMTS1.<payload>»
function nmts1(p = {}, { prefijo = 'NMTS1', key = keys.privateKey } = {}) {
  const payload = { v: 1, uid: 'u1', cuentas: ['ana@empresa.com'], periodo: 'mensual', iat: now(), exp: now() + 7 * 86400, ...p };
  const head = `${prefijo}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${head}.${crypto.sign(null, Buffer.from(head), key).toString('base64url')}`;
}
const file = (n) => path.join(dir, `${n}-${Math.random().toString(36).slice(2)}.json`);
const lic = (token) => new Licenses({ file: file('lic'), getConfig: () => cfg, fetch: async () => ({ ok: false }), subscriptionToken: () => token });

test('NMTS1 válido: la cuenta cubierta ejecuta Limpiar y Sincronizar; otra cuenta de dominio propio no', () => {
  const L = lic(nmts1({ cuentas: ['Ana@Empresa.com'] }));
  const g = L.gate('ana@empresa.com', 'limpiar');
  assert.equal(g.permitido, true); assert.equal(g.via, 'suscripcion'); assert.ok(g.vence);
  assert.equal(L.gate(['ana@empresa.com', 'b@gmail.com'], 'sincronizar').permitido, true);
  const otra = L.gate('beto@empresa.com', 'limpiar');
  assert.equal(otra.permitido, false); assert.equal(otra.comprar, 'https://mt.nonosky.com/herramienta.html#suscripcion');
  assert.equal(L.gate('yo@gmail.com', 'limpiar').personal, true, 'las personales siguen gratis');
});

test('NMTS1 vencido, con firma de otra llave, con el prefijo de licencia o dañado: no abre la puerta', () => {
  const otra = crypto.generateKeyPairSync('ed25519').privateKey;
  for (const tk of [nmts1({ exp: now() - 10 }), nmts1({}, { key: otra }), nmts1({}, { prefijo: 'NMT1' }), 'NMTS1.xxx.yyy', '', null]) {
    assert.equal(lic(tk).gate('ana@empresa.com', 'limpiar').permitido, false, String(tk).slice(0, 20));
  }
  assert.equal(lic(null).readSubscription(nmts1({ v: 2 })).ok, false, 'versión desconocida');
  assert.equal(lic(null).readSubscription(nmts1({ cuentas: 'ana@empresa.com' })).ok, false, 'cuentas tiene que ser lista');
});

test('una licencia NMT1 vigente sigue valiendo sin suscripción', async () => {
  const L = lic(null);
  assert.equal((await L.add(keys.sign({ cuenta: 'ana@empresa.com', tipo: 'limpiar' }), { online: false })).ok, true);
  const g = L.gate('ana@empresa.com', 'limpiar');
  assert.equal(g.permitido, true); assert.equal(g.via, 'licencia');
  assert.equal(L.gate('ana@empresa.com', 'sincronizar').permitido, false);
});

// Servicio falso para PlanSync: /api/plan y /api/suscripcion/cubrir
function servicio({ cuentas = ['ana@empresa.com'], vigente = true, lugares = 5, status = 200 } = {}) {
  const S = { token: 'tok', cuentas: [...cuentas], llamadas: [], logouts: 0 };
  S.auth = {
    get token() { return S.token; },
    logout() { S.logouts++; S.token = ''; },
    call: async (method, p, body) => {
      S.llamadas.push(`${method} ${p}`);
      if (p === cfg.plan.path) {
        if (status !== 200) return { status, ok: false, body: null };
        return { status: 200, ok: true, body: {
          activa_en_servicio: true, compro_alguna_vez: true, web_permitida: vigente,
          precios: { moneda: 'USD', mensual: [{ desde: 1, hasta: null, precio: '9.00' }], anual: [{ desde: 1, hasta: null, precio: '90.00' }] },
          suscripcion: { estado: 'activa', periodo: 'anual', cantidad: lugares, cuentas: S.cuentas, pagado_hasta: '2027-01-01T00:00:00+00:00', vigente },
          token: vigente ? nmts1({ cuentas: S.cuentas }) : null,
        } };
      }
      if (p === cfg.plan.cubrirPath) {
        if (S.cuentas.length >= lugares) return { status: 402, ok: false, body: { detail: 'sin lugar' } };
        S.cuentas.push(body.cuenta); return { status: 200, ok: true, body: { cobertura: body.cuenta } };
      }
      return { status: 404, ok: false, body: null };
    },
  };
  return S;
}
const planSync = (S, cuentas) => {
  let P = null;
  const L = new Licenses({ file: file('lic'), getConfig: () => cfg, subscriptionToken: () => (P ? P.token() : null) });
  P = new PlanSync({ file: file('plan'), getConfig: () => cfg, auth: S.auth, licenses: L, accounts: () => cuentas });
  return { P, L };
};

test('plan: guarda el comprobante para sin conexión y cubre sola la cuenta de dominio propio que falta', async () => {
  const S = servicio();
  const { P, L } = planSync(S, ['ana@empresa.com', 'beto@empresa.com', 'yo@gmail.com']);
  assert.equal(L.gate('beto@empresa.com', 'limpiar').permitido, false);
  assert.deepEqual(await P.refresh(), { ok: true });
  assert.deepEqual(S.llamadas, ['GET /api/plan', 'POST /api/suscripcion/cubrir', 'GET /api/plan'], 'cubre beto (no la personal) y pide el plan otra vez');
  assert.equal(L.gate('beto@empresa.com', 'limpiar').permitido, true);
  const v = P.view();
  assert.equal(v.incluida, true); assert.equal(v.vigente, true); assert.deepEqual(v.cubiertas.sort(), ['ana@empresa.com', 'beto@empresa.com']);
  assert.equal(v.precios.mensual[0].precio, '9.00', 'los precios del servicio ganan sobre los de la configuración');
  assert.ok(!('token' in v), 'la interfaz no recibe el comprobante');
  // otra instancia (sin red): lee el comprobante guardado
  const L2 = new Licenses({ file: file('lic'), getConfig: () => cfg, subscriptionToken: () => P2.token() });
  const P2 = new PlanSync({ file: P.o.file, getConfig: () => cfg, auth: { token: '', call: async () => { throw new Error('sin red'); } }, licenses: L2, accounts: () => [] });
  assert.equal(L2.gate('beto@empresa.com', 'limpiar').permitido, true);
  assert.equal(P2.view().incluida, false, 'sin sesión no se ofrecen IA ni tareas del servidor');
});

test('plan: sin lugar (402) no se reintenta hasta el próximo refresco; sin suscripción vigente no se cubre nada', async () => {
  const S = servicio({ lugares: 1 });
  const { P } = planSync(S, ['ana@empresa.com', 'beto@empresa.com']);
  await P.refresh();
  assert.deepEqual(S.llamadas, ['GET /api/plan', 'POST /api/suscripcion/cubrir']);
  await P.ensure(['beto@empresa.com']);
  assert.equal(S.llamadas.length, 2, 'ensure no vuelve a pedir lugar para beto');
  const S2 = servicio({ vigente: false });
  const { P: P2, L: L2 } = planSync(S2, ['beto@empresa.com']);
  await P2.refresh();
  assert.deepEqual(S2.llamadas, ['GET /api/plan']);
  assert.equal(L2.gate('ana@empresa.com', 'limpiar').permitido, false);
  assert.equal(P2.view().incluida, false);
});

test('plan: sesión vencida la cierra; sin sesión no llama; precios de la configuración si el servicio no los manda', async () => {
  const S = servicio({ status: 401 });
  const { P } = planSync(S, []);
  assert.deepEqual(await P.refresh(), { error: 'sesion' });
  assert.equal(S.logouts, 1);
  assert.deepEqual(await P.refresh(), { skipped: 'sin-sesion' });
  assert.equal(S.llamadas.length, 1);
  assert.deepEqual(P.view().precios, cfg.plan.precios);
  assert.deepEqual(cfg.plan.precios.mensual.map(x => [x.desde, x.hasta]), [[1, 4], [5, 19], [20, null]]);
});
