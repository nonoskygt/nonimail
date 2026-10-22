'use strict';
// «Iniciar sesión con Google»: cliente propio de la app (defaults.json / NMT_GOOGLE_CLIENT_*), PKCE + redirect
// loopback; al volver se guarda y se prueba la cuenta sola. Sin cliente, la interfaz cae a la contraseña de aplicación.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../lib/app');
const S = require('./helpers/servers');
const { startService } = require('./helpers/service');
const { client } = require('./helpers/http');
const { defaults } = require('../lib/defaults');

const SECRET = 'GOCSPX-secreto-de-prueba-123';
let dirs = [], withClient, noClient, google, googleBad, imap, service, rq1, rq2;

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-gsi-')); dirs.push(d); return d; };
const cipher = { available: () => true, encrypt: (s) => Buffer.from(`ENC1:${Buffer.from(s).toString('hex')}`), decrypt: (b) => Buffer.from(String(b).replace(/^ENC1:/, ''), 'hex').toString() };

before(async () => {
  service = await startService();
  imap = await S.startImap({ inbox: [] });
  imap.server.users['testuser@gmail.com'] = { password: 'x', xoauth2: { accessToken: 'testtoken' } };
  google = await S.startFakeGoogle({ email: 'testuser@gmail.com' });
  googleBad = await S.startFakeGoogle({ email: 'sinbuzon@gmail.com' }); // el IMAP no la conoce: la prueba falla
  const d1 = tmp();
  const cfgFile = path.join(d1, 'overrides.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ presets: { gmail: { label: 'Gmail', imap: { host: '127.0.0.1', port: imap.port, secure: false }, smtp: { host: '', port: 465, secure: true } } } }));
  withClient = await createApp({ dataDir: d1, port: 0, locale: 'es-GT', cipher, env: {
    NMT_GOOGLE_CLIENT_ID: 'cid-123.apps.googleusercontent.com', NMT_GOOGLE_CLIENT_SECRET: SECRET, NMT_GOOGLE_TOKEN_URL: google.tokenUrl, NMT_GOOGLE_REVOKE_URL: google.revokeUrl,
    NMT_CONFIG_FILE: cfgFile, NMT_SERVICE_URL: service.url,
  } });
  noClient = await createApp({ dataDir: tmp(), port: 0, locale: 'es-GT', env: { NMT_SERVICE_URL: service.url, NMT_GOOGLE_TOKEN_URL: google.tokenUrl } });
  rq1 = client(() => withClient.port); rq2 = client(() => noClient.port);
});
after(async () => {
  await withClient.close(); await noClient.close(); await imap.close(); await google.close(); await googleBad.close(); await service.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test('defaults.json trae google.clientId y google.clientSecret vacíos (los pone la compilación de la versión)', () => {
  assert.equal(defaults().google.clientId, ''); assert.equal(defaults().google.clientSecret, '');
});

test('un clic: URL de consentimiento con PKCE, solo el permiso de correo y sin el secreto', async () => {
  const st = await rq1('POST', '/api/oauth/google/start', { email: 'testuser@gmail.com' });
  assert.equal(st.status, 200, st.text);
  const u = new URL(st.body.authUrl), q = u.searchParams;
  assert.equal(q.get('client_id'), 'cid-123.apps.googleusercontent.com');
  assert.equal(q.get('scope'), 'https://mail.google.com/ openid email');
  assert.equal(q.get('access_type'), 'offline'); assert.equal(q.get('prompt'), 'consent');
  assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('code_challenge_method'), 'S256'); assert.ok(q.get('code_challenge').length >= 43);
  assert.equal(q.get('login_hint'), 'testuser@gmail.com');
  assert.equal(q.get('redirect_uri'), `http://127.0.0.1:${withClient.port}/oauth/google/callback`);
  assert.equal(st.body.authUrl.includes(SECRET), false, 'el secreto nunca viaja en la URL del navegador');
  assert.equal(JSON.stringify(st.body).includes(SECRET), false);
});

test('al volver de Google la cuenta se guarda y se prueba sola, con el email del token y sin más campos', async () => {
  const st = await rq1('POST', '/api/oauth/google/start', {}); // sin login_hint
  assert.equal(new URL(st.body.authUrl).searchParams.has('login_hint'), false);
  const state = new URL(st.body.authUrl).searchParams.get('state');
  const cb = await rq1('GET', `/oauth/google/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 200, cb.text); assert.match(cb.text, /testuser@gmail\.com/);
  const tokenCall = google.calls.find(c => c.params.grant_type === 'authorization_code');
  assert.equal(tokenCall.params.client_id, 'cid-123.apps.googleusercontent.com');
  assert.equal(tokenCall.params.client_secret, SECRET);
  assert.ok(tokenCall.params.code_verifier.length >= 43);
  const accts = (await rq1('GET', '/api/accounts')).body.accounts;
  const g = accts.find(a => a.email === 'testuser@gmail.com');
  assert.equal(g.type, 'gmail-oauth'); assert.equal(g.ready, true); assert.equal(g.googleConnected, true);
  const c = (await rq1('GET', '/api/config')).body;
  assert.equal(c.tabs.limpiar, true, 'con la cuenta lista se abren Sincronizar y Limpiar');
  // la prueba de conexión salió bien: se puede leer la bandeja con el token
  const t = await rq1('POST', '/api/accounts/test', { account: { id: g.id } });
  assert.equal(t.body.mail.ok, true, JSON.stringify(t.body));
});

test('si la prueba de conexión falla, la cuenta nueva no queda a medias', async () => {
  const dir = tmp();
  const cfgFile = path.join(dir, 'o.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ presets: { gmail: { label: 'Gmail', imap: { host: '127.0.0.1', port: imap.port, secure: false }, smtp: { host: '', port: 465, secure: true } } } }));
  const app = await createApp({ dataDir: dir, port: 0, locale: 'es-GT', env: { NMT_GOOGLE_CLIENT_ID: 'c', NMT_GOOGLE_CLIENT_SECRET: 's', NMT_GOOGLE_TOKEN_URL: googleBad.tokenUrl, NMT_CONFIG_FILE: cfgFile } });
  try {
    const rq = client(() => app.port);
    const st = await rq('POST', '/api/oauth/google/start', {});
    const cb = await rq('GET', `/oauth/google/callback?code=abc&state=${new URL(st.body.authUrl).searchParams.get('state')}`);
    assert.equal(cb.status, 400);
    assert.equal((await rq('GET', '/api/accounts')).body.accounts.length, 0);
    assert.equal((await rq('GET', '/api/config')).body.tabs.limpiar, false);
  } finally { await app.close(); }
});

test('sin cliente de Google en esta versión: una línea y la contraseña de aplicación', async () => {
  const r = await rq2('POST', '/api/oauth/google/start', { email: 'ana@gmail.com' });
  assert.equal(r.status, 400); assert.equal(r.body.unavailable, true);
  assert.equal(r.body.error, 'Inicio con Google no disponible en esta versión; use contraseña de aplicación.');
  // la alternativa sigue ahí: contraseña de aplicación de Gmail
  const pw = await rq2('POST', '/api/accounts/save', { account: { type: 'gmail-password', email: 'ana@gmail.com', provider: 'gmail', imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } }, secrets: { password: 'abcd efgh ijkl mnop' } });
  assert.equal(pw.status, 200, pw.text);
});

test('el cliente propio del usuario (Ajustes → Avanzado) manda sobre el de la app, y el secreto va cifrado', async () => {
  const dir = tmp();
  const app = await createApp({ dataDir: dir, port: 0, locale: 'es-GT', cipher, env: { NMT_GOOGLE_CLIENT_ID: 'de-la-app', NMT_GOOGLE_CLIENT_SECRET: 'sec-de-la-app' } });
  try {
    const rq = client(() => app.port);
    await rq('POST', '/api/settings', { settings: { google: { clientId: 'propio.apps.googleusercontent.com' } }, secrets: { googleClientSecret: 'GOCSPX-propio' } });
    const st = await rq('POST', '/api/oauth/google/start', {});
    assert.equal(st.status, 200);
    assert.equal(new URL(st.body.authUrl).searchParams.get('client_id'), 'de-la-app', 'las variables NMT_GOOGLE_* mandan sobre la configuración');
    const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
    assert.equal(raw.includes('GOCSPX-propio'), false);
    assert.equal(JSON.parse(raw).enc, 'safeStorage');
  } finally { await app.close(); }
});

test('los secretos (cliente y token de renovación) no aparecen en registros, telemetría, vistas ni archivos en claro', async () => {
  await withClient.telemetry.flush().catch(() => {});
  const hay = [];
  const scan = (name, text) => { for (const s of [SECRET, 'refresh-1', 'testtoken']) if (String(text).includes(s)) hay.push(`${name}:${s}`); };
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else scan(p, fs.readFileSync(p, 'utf8')); } };
  walk(withClient.dataDir); // incluye config.json, secrets.json (cifrado) y los registros
  for (const p of service.posts) scan(`telemetria ${p.path}`, p.raw);
  for (const r of ['/api/config', '/api/accounts', '/api/settings']) scan(r, (await rq1('GET', r)).text);
  assert.deepEqual(hay, []);
});
