'use strict';
// Pestañas que esperan una cuenta, sesión con el servicio SOLO para dominios propios y
// traída automática de licencias (/api/licencias) contra un servicio falso.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../lib/app');
const { pestanasActivas, requiereSesion, algunaRequiereSesion } = require('../lib/service-auth');
const S = require('./helpers/servers');
const { makeKeys } = require('./helpers/keys');
const { client } = require('./helpers/http');

let dir, app, port, keys, svc, imap;
const req = client(() => port);
const calls = [];

// Servicio web falso: /api/auth/* y /api/licencias
function startAuthService() {
  const st = { licencias: [], calls, tokens: new Set(), lastBearer: '' };
  const srv = http.createServer((rq, rs) => {
    let b = ''; rq.on('data', c => b += c); rq.on('end', () => {
      let body = {}; try { body = JSON.parse(b || '{}'); } catch (_) { /* vacío */ }
      calls.push({ method: rq.method, url: rq.url, body, auth: rq.headers.authorization || '' });
      const send = (code, obj) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(obj)); };
      if (rq.url === '/api/auth/acceder') {
        if (body.password === 'mala') return send(401, { detail: 'credenciales' });
        if (/^nuevo@/.test(body.email)) return send(202, { codigo: true });
        st.tokens.add(`tok-${body.email}`); return send(200, { access_token: `tok-${body.email}` });
      }
      if (rq.url === '/api/auth/register-confirm') {
        if (body.code !== '123456') return send(400, { detail: 'Código incorrecto' });
        st.tokens.add(`tok-${body.email}`); return send(200, { access_token: `tok-${body.email}` });
      }
      if (rq.url === '/api/auth/password-reset-request') return send(200, { ok: true });
      if (rq.url === '/api/auth/password-reset-confirm') return send(body.code === '123456' ? 200 : 400, { ok: body.code === '123456' });
      if (rq.url === '/api/licencias') {
        const tok = (rq.headers.authorization || '').replace(/^Bearer /, '');
        st.lastBearer = tok;
        if (!st.tokens.has(tok)) return send(401, { detail: 'no autorizado' });
        return send(200, { licencias: st.licencias });
      }
      send(404, {});
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(Object.assign(st, { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(x => { srv.close(x); if (srv.closeAllConnections) srv.closeAllConnections(); }) }))));
}
// cifrado de mentira para comprobar que el token no queda en claro
const cipher = { available: () => true, encrypt: (s) => Buffer.from(`ENC1:${Buffer.from(s).toString('hex')}`), decrypt: (b) => Buffer.from(String(b).replace(/^ENC1:/, ''), 'hex').toString() };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-auth-'));
  keys = makeKeys();
  svc = await startAuthService();
  imap = await S.startImap({ inbox: [] });
  app = await createApp({ dataDir: dir, port: 0, locale: 'es-GT', cipher, env: { NMT_SERVICE_URL: svc.url, NMT_LICENSE_PUBLIC_KEY: keys.pubFile, NMT_TELEMETRY: '0' } });
  port = app.port;
});
after(async () => { await app.close(); await svc.close(); await imap.close(); keys.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); });

const imapAccount = (email) => ({ account: { type: 'imap', email, username: 'testuser', provider: 'custom', imap: { host: '127.0.0.1', port: imap.port, secure: false }, smtp: { host: '', port: 465, secure: true } }, secrets: { password: 'testpass' } });

test('pestañas: sin cuenta lista, Sincronizar y Limpiar quedan deshabilitadas; Cuentas y Ajustes no', () => {
  assert.deepEqual(pestanasActivas([]), { cuentas: true, sincronizar: false, limpiar: false, ajustes: true });
  assert.equal(pestanasActivas([{ ready: false }]).limpiar, false, 'una cuenta incompleta no cuenta');
  const ok = pestanasActivas([{ ready: false }, { ready: true }]);
  assert.equal(ok.sincronizar, true); assert.equal(ok.limpiar, true);
  assert.equal(pestanasActivas(null).sincronizar, false);
});

test('pestañas por la API: se activan al guardar una cuenta probada y vuelven a apagarse al quitarla', async () => {
  let c = (await req('GET', '/api/config')).body;
  assert.equal(c.tabs.sincronizar, false); assert.equal(c.tabs.limpiar, false); assert.equal(c.tabs.cuentas, true);
  const bad = await req('POST', '/api/accounts/test', { ...imapAccount('ana@gmail.com'), secrets: { password: 'incorrecta' } });
  assert.equal(bad.body.mail.ok, false);
  assert.equal((await req('GET', '/api/config')).body.tabs.limpiar, false, 'probar sin guardar no abre nada');
  const saved = await req('POST', '/api/accounts/save', imapAccount('ana@gmail.com'));
  assert.equal(saved.status, 200, saved.text);
  c = (await req('GET', '/api/config')).body;
  assert.equal(c.tabs.sincronizar, true); assert.equal(c.tabs.limpiar, true);
  await req('POST', '/api/accounts/delete', { id: saved.body.account.id });
  assert.equal((await req('GET', '/api/config')).body.tabs.limpiar, false);
});

test('la sesión con el servicio solo la piden las cuentas de dominio propio', async () => {
  for (const e of ['ana@gmail.com', 'a@hotmail.es', 'a@outlook.com.mx', 'a@icloud.com', 'a@yahoo.com.ar']) assert.equal(requiereSesion(e), false, e);
  for (const e of ['ana@empresa.com', 'info@lablpq.com']) assert.equal(requiereSesion(e), true, e);
  assert.equal(requiereSesion('no-es-correo'), false);
  assert.equal(algunaRequiereSesion([{ email: 'a@gmail.com' }, { email: 'b@hotmail.com' }]), false);
  assert.equal(algunaRequiereSesion([{ email: 'a@gmail.com' }, { email: 'b@empresa.com' }]), true);
  // por la API: la interfaz decide con /accounts/classify y con config.auth.required
  assert.equal((await req('GET', '/api/accounts/classify?email=ana@gmail.com')).body.personal, true);
  assert.equal((await req('GET', '/api/accounts/classify?email=ana@empresa.com')).body.personal, false);
  const pers = await req('POST', '/api/accounts/save', imapAccount('ana@gmail.com'));
  assert.equal((await req('GET', '/api/config')).body.auth.required, false, 'una cuenta personal no pide sesión');
  const priv = await req('POST', '/api/accounts/save', imapAccount('ana@empresa.com'));
  assert.equal((await req('GET', '/api/config')).body.auth.required, true);
  assert.equal(priv.body.account.personal, false);
  await req('POST', '/api/accounts/delete', { id: priv.body.account.id });
  assert.equal((await req('GET', '/api/config')).body.auth.required, false);
  await req('POST', '/api/accounts/delete', { id: pers.body.account.id });
});

test('no hay pestaña Licencias y «Iniciar sesión» solo existe con una cuenta comercial', async () => {
  const html = (await req('GET', '/')).text;
  assert.doesNotMatch(html, /data-tab="licencias"|tab-licencias|ui\.tab\.licenses/);
  assert.ok(!('licencias' in (await req('GET', '/api/config')).body.tabs));
  // la interfaz arma el botón solo para cuentas con dominio propio (a.personal === false) y sin sesión
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'), /a\.personal \? null : \(S\.config\.auth && S\.config\.auth\.signedIn/);
  const pers = await req('POST', '/api/accounts/save', imapAccount('yo@gmail.com'));
  let cfg = (await req('GET', '/api/config')).body;
  assert.equal(cfg.accounts.some(a => !a.personal), false, 'solo personal: no hay a quién pedirle sesión');
  const priv = await req('POST', '/api/accounts/save', imapAccount('ana@empresa.com'));
  cfg = (await req('GET', '/api/config')).body;
  assert.equal(cfg.accounts.some(a => !a.personal), true); assert.equal(cfg.auth.signedIn, false);
  assert.equal(new URL(cfg.gate.comprar || (await req('POST', '/api/licenses/gate', { cuenta: 'ana@empresa.com', tipo: 'limpiar' })).body.comprar).searchParams.get('canal'), 'app');
  await req('POST', '/api/accounts/delete', { id: priv.body.account.id }); await req('POST', '/api/accounts/delete', { id: pers.body.account.id });
});

test('sin sesión una cuenta propia se agrega y se simula, pero sus licencias no se traen', async () => {
  const priv = await req('POST', '/api/accounts/save', imapAccount('ana@empresa.com'));
  assert.equal(priv.status, 200);
  const g = await req('POST', '/api/licenses/gate', { cuenta: 'ana@empresa.com', tipo: 'limpiar' });
  assert.equal(g.body.permitido, false);
  const r = await req('POST', '/api/licenses/sync', {});
  assert.equal(r.status, 401);
  assert.equal(calls.filter(c => c.url === '/api/licencias').length, 0, 'sin token no se llama al servicio');
  await req('POST', '/api/accounts/delete', { id: priv.body.account.id });
});

test('acceder: contraseña mala = 401 y sin sesión; 200 = sesión + licencias importadas por la verificación sin conexión', async () => {
  const bad = await req('POST', '/api/auth/login', { email: 'ana@empresa.com', password: 'mala' });
  assert.equal(bad.status, 401); assert.match(bad.body.error, /incorrectos/);
  assert.equal((await req('GET', '/api/auth')).body.signedIn, false);

  svc.licencias = [
    { cuenta: 'ana@empresa.com', tipo: 'limpiar', canal: 'web', estado: 'activa', clave: keys.sign({ cuenta: 'ana@empresa.com', tipo: 'limpiar', canal: 'web' }) },
    { cuenta: 'ana@empresa.com', tipo: 'sincronizar', canal: 'web', estado: 'activa', clave: keys.sign({ cuenta: 'ana@empresa.com', tipo: 'sincronizar', canal: 'web' }) },
    { cuenta: 'x@empresa.com', tipo: 'limpiar', canal: 'web', estado: 'anulada', clave: keys.sign({ cuenta: 'x@empresa.com' }) },
    { cuenta: 'y@empresa.com', tipo: 'limpiar', canal: 'web', estado: 'activa', clave: 'NMT1.falsa.firma' },
    { cuenta: 'z@empresa.com', tipo: 'limpiar', canal: 'web', estado: 'activa' },
  ];
  const ok = await req('POST', '/api/auth/login', { email: 'Ana@Empresa.com', password: 'buena' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.signedIn, true); assert.equal(ok.body.email, 'ana@empresa.com');
  assert.deepEqual({ found: ok.body.licencias.found, imported: ok.body.licencias.imported, skipped: ok.body.licencias.skipped, invalid: ok.body.licencias.invalid }, { found: 5, imported: 2, skipped: 2, invalid: 1 });
  assert.equal(svc.lastBearer, 'tok-ana@empresa.com');
  assert.equal(JSON.stringify(ok.body).includes('tok-ana'), false, 'el token nunca llega a la interfaz');
  const lic = (await req('GET', '/api/licenses')).body.list;
  assert.deepEqual(lic.map(l => l.tipo).sort(), ['limpiar', 'sincronizar']);
  assert.equal((await req('POST', '/api/licenses/gate', { cuenta: 'ana@empresa.com', tipo: 'limpiar' })).body.permitido, true);
  assert.equal((await req('POST', '/api/licenses/gate', { cuenta: 'otra@empresa.com', tipo: 'limpiar' })).body.permitido, false, 'solo vale la clave de ESA cuenta');
  const cfg = (await req('GET', '/api/config')).body;
  assert.equal(cfg.auth.signedIn, true); assert.equal(cfg.auth.email, 'ana@empresa.com');
});

test('el token se guarda cifrado como los demás secretos y Cerrar sesión lo borra', async () => {
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.equal(JSON.parse(raw).enc, 'safeStorage');
  assert.equal(raw.includes('tok-ana'), false, 'ni el token ni el correo van en claro');
  assert.ok(JSON.parse(raw).global.serviceToken);
  const out = await req('POST', '/api/auth/logout', {});
  assert.equal(out.body.signedIn, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).global.serviceToken, undefined);
  assert.equal((await req('GET', '/api/auth')).body.signedIn, false);
  assert.equal((await req('GET', '/api/licenses')).body.list.length, 2, 'las claves ya importadas siguen valiendo sin sesión (puerta sin conexión)');
});

test('correo nuevo: 202 pide el código; con el código correcto entra, con otro no', async () => {
  const r = await req('POST', '/api/auth/login', { email: 'nuevo@empresa.com', password: 'clave-larga-1' });
  assert.equal(r.status, 200); assert.equal(r.body.codigo, true); assert.equal(r.body.signedIn, undefined);
  assert.equal((await req('GET', '/api/auth')).body.signedIn, false, 'aún sin sesión');
  const wrong = await req('POST', '/api/auth/confirm', { email: 'nuevo@empresa.com', code: '000000', password: 'clave-larga-1' });
  assert.equal(wrong.status, 400);
  assert.equal((await req('POST', '/api/auth/confirm', { email: 'nuevo@empresa.com', code: '12', password: 'x' })).status, 400, 'el código son 6 dígitos');
  svc.licencias = [];
  const ok = await req('POST', '/api/auth/confirm', { email: 'nuevo@empresa.com', code: '123 456', password: 'clave-larga-1' });
  assert.equal(ok.status, 200, ok.text); assert.equal(ok.body.signedIn, true);
  assert.deepEqual(calls.filter(c => c.url === '/api/auth/register-confirm').pop().body, { email: 'nuevo@empresa.com', code: '123456', password: 'clave-larga-1' });
  await req('POST', '/api/auth/logout', {});
});

test('contraseña olvidada: pide el código y lo confirma', async () => {
  assert.equal((await req('POST', '/api/auth/reset-request', { email: 'ana@empresa.com' })).status, 200);
  assert.equal((await req('POST', '/api/auth/reset-confirm', { email: 'ana@empresa.com', code: '999999', password: 'nueva-clave' })).status, 400);
  const ok = await req('POST', '/api/auth/reset-confirm', { email: 'ana@empresa.com', code: '123456', password: 'nueva-clave' });
  assert.equal(ok.status, 200);
  await req('POST', '/api/auth/logout', {});
});

test('una sesión vencida (401 en /api/licencias) se cierra sola y avisa', async () => {
  svc.licencias = [];
  await req('POST', '/api/auth/login', { email: 'ana@empresa.com', password: 'buena' });
  svc.tokens.clear();
  const r = await req('POST', '/api/licenses/sync', {});
  assert.equal(r.status, 401); assert.match(r.body.error, /venció/);
  assert.equal((await req('GET', '/api/auth')).body.signedIn, false);
});

test('servicio caído: error claro, sin sesión y sin romper la app', async () => {
  const dead = await createApp({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nm-auth2-')), port: 0, locale: 'es-GT', env: { NMT_SERVICE_URL: 'http://127.0.0.1:9', NMT_SERVICE_TIMEOUT_MS: '500', NMT_TELEMETRY: '0' } });
  try {
    const rq = client(() => dead.port);
    const r = await rq('POST', '/api/auth/login', { email: 'ana@empresa.com', password: 'buena' });
    assert.equal(r.status, 502); assert.match(r.body.error, /No se pudo conectar/);
    assert.equal((await rq('POST', '/api/auth/login', { email: 'no-es-correo', password: 'x' })).status, 400);
  } finally { await dead.close(); fs.rmSync(dead.dataDir, { recursive: true, force: true }); }
});
