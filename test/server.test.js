'use strict';
// Prueba de punta a punta del servidor: se levanta server.js con una carpeta de datos temporal.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const S = require('./helpers/servers');

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let dir, port, proc, imap, smtpSrv, google, ollama, out = '';

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, body: j, text: b }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const waitIdle = async () => { for (let i = 0; i < 300; i++) { const j = await req('GET', '/api/jobs'); if (!j.body.current.running) return j.body; await new Promise(r => setTimeout(r, 50)); } throw new Error('el trabajo no terminó'); };

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-srv-'));
  port = await freePort();
  imap = await S.startImap({ inbox: [
    S.msg({ from: 'Tienda <ofertas@tienda.com>', subject: 'Gran OFERTA', day: new Date().toISOString().slice(0, 10) }),
    S.msg({ from: 'Ana <ana@amiga.com>', subject: 'hola', day: new Date().toISOString().slice(0, 10) }),
  ] });
  smtpSrv = await S.startSmtp();
  google = await S.startFakeGoogle({ email: 'testuser@gmail.com' });
  ollama = await new Promise(r => { const s = http.createServer((q, s2) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s2.writeHead(200, { 'Content-Type': 'application/json' });
    if (q.url === '/api/version') return s2.end('{"version":"9.9.9"}');
    if (q.url === '/api/tags') return s2.end('{"models":[{"name":"m:1b"}]}');
    s2.end(JSON.stringify({ response: /ofertas@/.test(JSON.parse(b).prompt) ? '95' : '2' }));
  }); }).listen(0, '127.0.0.1', () => r({ srv: s, url: `http://127.0.0.1:${s.address().port}` })); });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port, ollamaUrl: ollama.url, model: 'm:1b' }));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, NONIMAIL_DATA_DIR: dir, NONIMAIL_GOOGLE_TOKEN_URL: google.tokenUrl, NONIMAIL_GOOGLE_REVOKE_URL: google.revokeUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);
  for (let i = 0; i < 100 && !out.includes('NoniMail Limpieza en'); i++) await new Promise(r => setTimeout(r, 50));
  assert.match(out, /NoniMail Limpieza en/);
});

after(async () => {
  proc.kill(); await imap.close(); await smtpSrv.close(); await google.close(); ollama.srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('la configuración se completa con valores por defecto y la UI se sirve', async () => {
  const s = await req('GET', '/api/settings');
  assert.equal(s.status, 200);
  assert.equal(s.body.settings.host, '127.0.0.1');
  assert.equal(s.body.settings.account.type, 'none');
  assert.ok(s.body.presets.gmail);
  const page = await req('GET', '/');
  assert.match(page.text, /<title>NoniMail/);
});

test('seguridad: rechaza POST sin JSON, de otro origen o con Host ajeno', async () => {
  assert.equal((await req('POST', '/api/stop', 'x', { 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await req('POST', '/api/stop', {}, { Origin: 'https://malo.example' })).status, 403);
  assert.equal((await req('GET', '/api/settings', undefined, { Host: 'malo.example:80' })).status, 403);
  assert.equal((await req('POST', '/api/stop', {}, { Origin: `http://localhost:${port}` })).status, 200);
});

test('Guardar valida y nunca devuelve secretos; Probar conexión revisa IMAP, SMTP y Ollama', async () => {
  const bad = await req('POST', '/api/settings', { settings: { account: { type: 'imap', email: 'no-es-correo' } } });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Correo de la cuenta/);

  const settings = { account: { type: 'imap', email: 'yo@test.local', username: 'testuser', imap: { host: '127.0.0.1', port: imap.port, secure: false }, smtp: { host: '', port: 465, secure: true } } };
  const t = await req('POST', '/api/settings/test', { settings, secrets: { imapPassword: 'testpass' } });
  assert.equal(t.body.mail.ok, true, JSON.stringify(t.body.mail)); assert.equal(t.body.mail.trash, 'Papelera'); assert.equal(t.body.mail.inboxCount, 2);
  assert.equal(t.body.smtp.ok, false); assert.match(t.body.smtp.error, /sin servidor SMTP/);
  assert.equal(t.body.llm.ok, true); assert.equal(t.body.llm.version, '9.9.9');
  const wrong = await req('POST', '/api/settings/test', { settings, secrets: { imapPassword: 'mala' } });
  assert.equal(wrong.body.mail.ok, false);

  const ok = await req('POST', '/api/settings', { settings, secrets: { imapPassword: 'testpass' } });
  assert.equal(ok.status, 200);
  const g = await req('GET', '/api/settings');
  assert.equal(g.text.includes('testpass'), false, 'la API no devuelve la contraseña');
  assert.equal(g.body.secrets.hasImapPassword, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).imapPassword, 'testpass');
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('testpass'), false, 'la contraseña no va en config.json');
});

test('Limpiar TODO en dry-run por la API: corre por lotes y no borra', async () => {
  const r = await req('POST', '/api/autorun', { daysBack: 30, dureza: 50, dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const busy = await req('POST', '/api/scan', { daysBack: 30 });
  assert.ok([200, 409].includes(busy.status));
  const j = await waitIdle();
  assert.equal(j.pending.length, 0);
  const t = await req('POST', '/api/settings/test', {});
  assert.equal(t.body.mail.inboxCount, 2, 'dry-run no movió nada');
});

test('Conectar con Google: URL con redirect local, callback guarda el token y Desconectar lo borra', async () => {
  const st = await req('POST', '/api/oauth/google/start', { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' });
  assert.equal(st.status, 200);
  const url = new URL(st.body.authUrl);
  assert.equal(url.searchParams.get('redirect_uri'), `http://127.0.0.1:${port}/oauth/google/callback`);
  const state = url.searchParams.get('state');
  const forged = await req('GET', '/oauth/google/callback?code=x&state=otro');
  assert.equal(forged.status, 400, 'state desconocido se rechaza');
  const cb = await req('GET', `/oauth/google/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 200, cb.text); assert.match(cb.text, /Conectado como testuser@gmail\.com/);
  const s = await req('GET', '/api/settings');
  assert.equal(s.body.settings.account.type, 'gmail-oauth');
  assert.equal(s.body.settings.account.email, 'testuser@gmail.com');
  assert.equal(s.body.secrets.googleConnected, true);
  assert.equal(s.text.includes('refresh-1'), false);
  const replay = await req('GET', `/oauth/google/callback?code=abc&state=${state}`);
  assert.equal(replay.status, 400, 'el state es de un solo uso');
  const d = await req('POST', '/api/oauth/google/disconnect', {});
  assert.equal(d.body.view.secrets.googleConnected, false);
  assert.ok(google.calls.some(c => c.url.startsWith('/revoke')), 'revoca el token en Google');
});
