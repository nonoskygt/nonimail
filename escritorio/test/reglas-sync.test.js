'use strict';
// Reglas por remitente: Conservar/Eliminar se guardan, se fusionan por fecha con el perfil en línea y
// sobreviven a reiniciar la app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ReglasSync, fusionar } = require('../lib/reglas-sync');

const nuevo = (auth) => {
  const senders = { rules: {}, unsub: {} };
  let saves = 0;
  return { senders, rs: new ReglasSync({ auth, senders, save: () => { saves++; }, delayMs: 0 }), saves: () => saves };
};
const authFalsa = (remoto, { token = 'tok', status = 200 } = {}) => {
  const a = { token, puts: [], gets: 0, remoto };
  a.reglasRemitentes = async (method, body) => {
    if (method === 'GET') { a.gets++; return { status, ok: status < 300, body: { reglas: a.remoto } }; }
    a.puts.push(body.reglas); a.remoto = body.reglas; return { status: 200, ok: true, body: {} };
  };
  return a;
};

test('fusionar: gana la regla más reciente y quitar una regla también viaja', () => {
  const r = fusionar(
    { 'a@x.com': { regla: 'protect', ts: 10 }, 'b@x.com': { regla: 'delete', ts: 50 }, 'c@x.com': { regla: 'none', ts: 30 } },
    { 'a@x.com': { regla: 'delete', ts: 20 }, 'b@x.com': { regla: 'none', ts: 40 }, 'd@x.com': { regla: 'protect', ts: 5 } });
  assert.deepEqual(r.out['a@x.com'], { regla: 'delete', ts: 20 });
  assert.deepEqual(r.out['b@x.com'], { regla: 'delete', ts: 50 });
  assert.deepEqual(r.cambiaLocal.sort(), ['a@x.com', 'd@x.com']);
  assert.deepEqual(r.cambiaRemoto.sort(), ['b@x.com', 'c@x.com']);
  assert.deepEqual(fusionar({ 'a@x.com': { regla: 'basura', ts: 1 } }, {}).out, {}, 'una regla inválida se ignora');
});

test('sync: 404 requiere_compra (nunca compró) deja las reglas en el equipo y lo dice el estado', async () => {
  const a = authFalsa({});
  a.reglasRemitentes = async () => ({ status: 404, ok: false, body: { detail: 'Compre el servicio', codigo: 'requiere_compra' } });
  const { senders, rs } = nuevo(a);
  senders.rules['x@y.com'] = 'protect';
  assert.deepEqual(await rs.sync(), { skipped: 'requiere-compra' });
  assert.equal(rs.state.error, 'requiere-compra');
  assert.equal(senders.rules['x@y.com'], 'protect');
  rs.stop();
});

test('set guarda la regla con fecha y la quita con none', () => {
  const { senders, rs, saves } = nuevo(authFalsa({}, { token: '' }));
  rs.set('a@x.com', 'protect');
  assert.equal(senders.rules['a@x.com'], 'protect'); assert.ok(senders.rulesAt['a@x.com'] > 0); assert.equal(saves(), 1);
  rs.set('a@x.com', 'none');
  assert.equal(senders.rules['a@x.com'], undefined); assert.ok(senders.rulesAt['a@x.com'] > 0, 'queda la fecha para que el borrado viaje');
  rs.stop();
});

test('sync: trae las del perfil, envía las locales y las dos máquinas terminan iguales', async () => {
  const a = authFalsa({ 'web@x.com': { regla: 'delete', ts: 100 } });
  const { senders, rs } = nuevo(a);
  senders.rules['pc@x.com'] = 'protect'; senders.rulesAt = { 'pc@x.com': 200 };
  const r = await rs.sync();
  assert.deepEqual(r, { traidas: 1, enviadas: 1 });
  assert.equal(senders.rules['web@x.com'], 'delete');
  assert.equal(a.remoto['pc@x.com'].regla, 'protect');
  assert.equal(rs.state.ok, true);
  // segundo equipo vacío: recibe todo y no manda nada
  const b = nuevo(a);
  assert.deepEqual(await b.rs.sync(), { traidas: 2, enviadas: 0 });
  assert.deepEqual(b.senders.rules, { 'web@x.com': 'delete', 'pc@x.com': 'protect' });
});

test('sync: sin sesión no llama, y sin el servicio (404) las reglas locales siguen intactas', async () => {
  const sin = authFalsa({}, { token: '' });
  const n = nuevo(sin); n.senders.rules['a@x.com'] = 'delete';
  assert.deepEqual(await n.rs.sync(), { skipped: 'sin-sesion' }); assert.equal(sin.gets, 0);
  const caido = authFalsa({}, { status: 404 });
  const m = nuevo(caido); m.senders.rules['a@x.com'] = 'delete';
  assert.deepEqual(await m.rs.sync(), { skipped: 'sin-servicio' });
  assert.equal(m.senders.rules['a@x.com'], 'delete'); assert.equal(caido.puts.length, 0);
});

test('API: Conservar y Eliminar quedan en senders.json, salen en la lista y se quitan con «none»', async () => {
  const { createApp } = require('../lib/app');
  const { client } = require('./helpers/http');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-reglas-'));
  const mk = () => createApp({ dataDir: dir, port: 0, locale: 'es-GT', env: { NMT_TELEMETRY: '0' } });
  let app = await mk(), req = client(() => app.port);
  try {
    assert.equal((await req('POST', '/api/sender-rule', { email: 'Ana@X.com', rule: 'protect' })).body.rule, 'protect');
    assert.equal((await req('POST', '/api/sender-rule', { email: 'spam@x.com', rule: 'delete' })).body.rule, 'delete');
    assert.equal((await req('POST', '/api/sender-rule', { email: 'a@x.com', rule: 'otra' })).status, 400);
    await app.close();
    app = await mk(); req = client(() => app.port);   // reiniciar la app: no se pierden
    const list = (await req('GET', '/api/sender-rules')).body.list;
    assert.deepEqual(list, [{ email: 'ana@x.com', rule: 'protect' }, { email: 'spam@x.com', rule: 'delete' }]);
    await req('POST', '/api/sender-rule', { email: 'ana@x.com', rule: 'none' });
    assert.deepEqual((await req('GET', '/api/sender-rules')).body.list.map(r => r.email), ['spam@x.com']);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('dominio: agrupa por empresa.com y por empresa.com.gt; la regla del remitente manda sobre la del dominio', () => {
  const C = require('../lib/classify');
  assert.equal(C.dominio('a@mail.tienda.com'), 'tienda.com');
  assert.equal(C.dominio('A@Promo.Banco.com.gt'), 'banco.com.gt');
  assert.equal(C.dominio('x@bbc.co.uk'), 'bbc.co.uk');
  assert.equal(C.dominio('sin-arroba'), '');
  const reglas = { '@tienda.com': 'delete', 'amiga@tienda.com': 'protect' };
  assert.equal(C.reglaDe(reglas, 'ofertas@tienda.com'), 'delete', 'hereda del dominio');
  assert.equal(C.reglaDe(reglas, 'amiga@tienda.com'), 'protect', 'la excepción gana');
  assert.equal(C.reglaDe(reglas, 'otro@otra.com'), undefined);
  // «Siempre eliminar» del dominio desprotege lo que el regex financiero protegería; la excepción protect lo vuelve a proteger
  const R = C.compileRules({ keepOverride: 'factura' });
  assert.equal(C.isProtected(R, reglas, 'ofertas@tienda.com', 'Tu factura', ''), false);
  assert.equal(C.isProtected(R, reglas, 'amiga@tienda.com', 'hola', ''), true);
});

test('API: regla de dominio con reset borra las excepciones; sin reset las respeta', async () => {
  const { createApp } = require('../lib/app');
  const { client } = require('./helpers/http');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-dom-'));
  const app = await createApp({ dataDir: dir, port: 0, locale: 'es-GT', env: { NMT_TELEMETRY: '0' } });
  const req = client(() => app.port);
  try {
    await req('POST', '/api/sender-rule', { email: 'amiga@tienda.com', rule: 'protect' });
    await req('POST', '/api/sender-rule', { email: 'otro@banco.com', rule: 'protect' });
    let r = (await req('POST', '/api/domain-rule', { domain: '@Tienda.com', rule: 'delete' })).body;
    assert.deepEqual(r.rules, { 'amiga@tienda.com': 'protect', 'otro@banco.com': 'protect', '@tienda.com': 'delete' }, 'sin reset la excepción sigue');
    r = (await req('POST', '/api/domain-rule', { domain: 'tienda.com', rule: 'delete', reset: true })).body;
    assert.deepEqual(r.rules, { 'otro@banco.com': 'protect', '@tienda.com': 'delete' }, 'con reset solo manda el dominio y no toca otros');
    r = (await req('POST', '/api/domain-rule', { domain: 'tienda.com', rule: 'none' })).body;
    assert.equal(r.rule, null);
    assert.equal((await req('POST', '/api/domain-rule', { domain: '', rule: 'delete' })).status, 400);
    assert.equal((await req('POST', '/api/domain-rule', { domain: 'x.com', rule: 'otra' })).status, 400);
  } finally { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Google en Configuración: pide solo openid+email, abre la sesión y las reglas viajan al perfil', async () => {
  const http = require('http');
  const { createApp } = require('../lib/app');
  const { client } = require('./helpers/http');
  const S = require('./helpers/servers');
  const google = await S.startFakeGoogle({ email: 'ana@gmail.com' });
  const perfil = { reglas: {}, idTokens: [], bearer: '' };
  const svc = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', c => b += c); rq.on('end', () => {
      const send = (code, o) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
      const body = b ? JSON.parse(b) : {};
      if (rq.url === '/api/auth/google') { perfil.idTokens.push(body.id_token); return send(200, { access_token: 'tok-ana', email: 'ana@gmail.com' }); }
      if (rq.url === '/api/licencias') return send(200, { licencias: [] });
      if (rq.url === '/api/reglas-remitentes') {
        perfil.bearer = rq.headers.authorization;
        if (rq.method === 'PUT') perfil.reglas = body.reglas;
        return send(200, { reglas: perfil.reglas });
      }
      send(404, {});
    });
  });
  await new Promise(r => svc.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-goo-'));
  const env = { NMT_GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', NMT_GOOGLE_CLIENT_SECRET: 'GOCSPX-x', NMT_GOOGLE_TOKEN_URL: google.tokenUrl, NMT_SERVICE_URL: `http://127.0.0.1:${svc.address().port}`, NMT_TELEMETRY: '0' };
  const app = await createApp({ dataDir: dir, port: 0, locale: 'es-GT', env });
  const sinCliente = await createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nm-goo2-')), port: 0, locale: 'es-GT', env: { NMT_TELEMETRY: '0' } });
  const req = client(() => app.port);
  try {
    assert.equal((await client(() => sinCliente.port)('POST', '/api/auth/google/start', {})).status, 400, 'sin cliente de Google no hay botón que funcione');
    const st = await req('POST', '/api/auth/google/start', {});
    const q = new URL(st.body.authUrl).searchParams;
    assert.equal(q.get('scope'), 'openid email'); assert.equal(q.get('prompt'), 'select_account'); assert.equal(q.has('access_type'), false);
    const cb = await req('GET', `/oauth/google/callback?code=abc&state=${q.get('state')}`);
    assert.equal(cb.status, 200, cb.text);
    assert.equal(perfil.idTokens.length, 1);
    const cfg = (await req('GET', '/api/config')).body;
    assert.equal(cfg.auth.signedIn, true); assert.equal(cfg.auth.email, 'ana@gmail.com');
    assert.equal((await req('GET', '/api/accounts')).body.accounts.length, 0, 'no se agrega ninguna cuenta de correo, solo la sesión');
    await req('POST', '/api/domain-rule', { domain: 'tienda.com', rule: 'delete' });
    for (let i = 0; i < 40 && !perfil.reglas['@tienda.com']; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(perfil.reglas['@tienda.com'].regla, 'delete', 'la regla llegó al perfil');
    assert.equal(perfil.bearer, 'Bearer tok-ana');
  } finally {
    await app.close(); await sinCliente.close(); await google.close(); await new Promise(r => svc.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
