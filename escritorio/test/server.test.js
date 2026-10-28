'use strict';
// Prueba de punta a punta de la app: servidor local, API, configurador, cuentas, puerta de licencias, Google y Sincronizar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ImapFlow } = require('imapflow');
const { createApp } = require('../lib/app');
const S = require('./helpers/servers');
const { startService } = require('./helpers/service');
const { makeKeys } = require('./helpers/keys');

let dir, app, port, imap, imapB, imapG, smtpSrv, google, ollama, service, keys;
const today = new Date().toISOString().slice(0, 10);

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) { /* no es JSON */ } resolve({ status: res.statusCode, body: j, text: b, headers: res.headers }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const flush = async () => { await app.telemetry.flush(); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const waitIdle = async () => { for (let i = 0; i < 400; i++) { const j = await req('GET', '/api/jobs'); if (!j.body.current.running) return j.body; await sleep(50); } throw new Error('el trabajo no terminó'); };
const waitSync = async () => { for (let i = 0; i < 400; i++) { const j = await req('GET', '/api/sync'); if (!j.body.running && j.body.result) return j.body; await sleep(50); } throw new Error('la sincronización no terminó'); };
async function count(p, box = 'INBOX') {
  const c = new ImapFlow({ ...S.imapOpts(p), logger: false }); await c.connect();
  try { const st = await c.status(box, { messages: true }); return st.messages; } catch (_) { return 0; } finally { await c.logout(); }
}
const imapAccount = (email, p, extra = {}) => ({ account: { type: 'imap', email, username: 'testuser', provider: 'custom', imap: { host: '127.0.0.1', port: p, secure: false }, smtp: { host: '', port: 465, secure: true }, ...extra }, secrets: { password: 'testpass' } });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-srv-'));
  keys = makeKeys();
  service = await startService();
  imap = await S.startImap({ inbox: [
    S.msg({ from: 'Tienda <ofertas@tienda.com>', subject: 'Gran OFERTA', day: today }),
    S.msg({ from: 'Ana <ana@amiga.com>', subject: 'hola', day: today }),
  ] });
  imapB = await S.startImap({ inbox: [] });
  imapG = await S.startImap({ inbox: [] }); // hace de imap.gmail.com para «Iniciar sesión con Google»
  imapG.server.users['testuser@gmail.com'] = { password: 'x', xoauth2: { accessToken: 'testtoken' } };
  const cfgFile = path.join(dir, 'overrides.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ presets: { gmail: { label: 'Gmail', imap: { host: '127.0.0.1', port: imapG.port, secure: false }, smtp: { host: '', port: 465, secure: true } } } }));
  smtpSrv = await S.startSmtp();
  google = await S.startFakeGoogle({ email: 'testuser@gmail.com' });
  ollama = await new Promise(r => { const s = http.createServer((q, s2) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    s2.writeHead(200, { 'Content-Type': 'application/json' });
    if (q.url === '/api/version') return s2.end('{"version":"9.9.9"}');
    if (q.url === '/api/tags') return s2.end('{"models":[{"name":"m:1b"}]}');
    s2.end(JSON.stringify({ response: /ofertas@/.test(JSON.parse(b).prompt) ? '95' : '2' }));
  }); }).listen(0, '127.0.0.1', () => r({ srv: s, url: `http://127.0.0.1:${s.address().port}` })); });
  app = await createApp({
    dataDir: dir, port: 0, locale: 'es-GT',
    env: {
      NMT_SERVICE_URL: service.url, NMT_OLLAMA_URL: ollama.url, NMT_MODEL: 'm:1b',
      NMT_CONFIG_FILE: cfgFile, NMT_GOOGLE_TOKEN_URL: google.tokenUrl, NMT_GOOGLE_REVOKE_URL: google.revokeUrl, NMT_LICENSE_PUBLIC_KEY: keys.pubFile,
    },
  });
  port = app.port;
});

after(async () => {
  await app.close(); await imap.close(); await imapB.close(); await imapG.close(); await smtpSrv.close(); await google.close(); ollama.srv.close(); await service.close();
  keys.cleanup(); fs.rmSync(dir, { recursive: true, force: true });
});

test('la interfaz se sirve con el tema aplicado, CSP estricta y la configuración pública', async () => {
  const page = await req('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>NoniMail Tools<\/title>/);
  assert.match(page.text, /<html lang="es" data-mode="auto" data-acento="carmesi"/);
  assert.equal(page.text.includes('{{'), false, 'sin marcas sin reemplazar');
  assert.match(page.headers['content-security-policy'], /script-src 'self'/);
  assert.equal((await req('GET', '/fonts/figtree-latin-wght-normal.woff2')).status, 200);
  assert.equal((await req('GET', '/locales/en.json')).status, 200);
  assert.equal((await req('GET', '/../config/defaults.json')).status, 404);
  const c = await req('GET', '/api/config');
  assert.equal(c.body.setup.done, false);
  assert.equal(c.body.language, 'es');
  assert.equal(c.body.appearance.mode, 'auto');
  assert.equal(c.body.serviceUrl, service.url);
  assert.equal(c.body.plan.precios.moneda, 'USD'); assert.equal(c.body.plan.incluida, false);
  assert.equal(c.body.aiMode, 'equipo');
});

test('seguridad: rechaza POST sin JSON, de otro origen o con Host ajeno', async () => {
  assert.equal((await req('POST', '/api/stop', 'x', { 'Content-Type': 'text/plain' })).status, 403);
  assert.equal((await req('POST', '/api/stop', {}, { Origin: 'https://malo.example' })).status, 403);
  assert.equal((await req('GET', '/api/config', undefined, { Host: 'malo.example:80' })).status, 403);
  assert.equal((await req('POST', '/api/stop', {}, { Origin: `http://localhost:${port}` })).status, 200);
});

test('configurador: idioma, apariencia, IA y telemetría; al terminar manda la instalación', async () => {
  const st = await req('GET', '/api/setup');
  assert.equal(st.body.done, false);
  assert.equal(st.body.ollama.running, true);
  assert.equal(st.body.ollama.modelInstalled, true);
  assert.ok(st.body.presets.gmail);

  let r = await req('POST', '/api/setup/prefs', { language: 'en', appearance: { mode: 'oscuro', accent: 'azul' } });
  assert.equal(r.body.language, 'en'); assert.equal(r.body.appearance.accent, 'azul');
  assert.match((await req('POST', '/api/setup/prefs', { language: 'xx' })).body.error, /Unsupported language/);
  r = await req('POST', '/api/setup/prefs', { language: 'es' });
  assert.equal(r.body.language, 'es');
  assert.equal((await req('GET', '/')).text.includes('data-acento="azul"'), true);
  assert.equal((await req('POST', '/api/appearance', { mode: 'raro', accent: 'violeta' })).body.appearance.accent, 'violeta');
  assert.equal((await req('GET', '/api/config')).body.appearance.mode, 'oscuro', 'un modo inválido se ignora');

  await req('POST', '/api/setup/prefs', { ai: true, telemetry: true, model: 'm:1b' });
  assert.equal(service.installs().length, 0, 'sin terminar el configurador no se manda nada');
  const fin = await req('POST', '/api/setup/finish', {});
  assert.equal(fin.body.setup.done, true);
  assert.equal(service.installs().length, 1);
  const ins = service.installs()[0].body;
  assert.equal(ins.app, 'desktop'); assert.equal(ins.ia_local, true); assert.equal(ins.modelo, 'm:1b');
  assert.match(service.installs()[0].headers['user-agent'], new RegExp(`^NoniMailTools/${require('../package.json').version.replace(/\./g, '\\.')} \\(`));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.deepEqual(saved.appearance, { mode: 'oscuro', accent: 'violeta' });
  assert.equal(saved.service, undefined, 'lo que viene del entorno no se escribe');
});

test('cuentas: probar, guardar sin exponer contraseñas, duplicados y quitar', async () => {
  const bad = await req('POST', '/api/accounts/save', { account: { type: 'imap', email: 'no-es-correo' }, secrets: { password: 'x' } });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /Correo de la cuenta/);
  const body = imapAccount('yo@test.local', imap.port);
  const t = await req('POST', '/api/accounts/test', body);
  assert.equal(t.body.mail.ok, true, JSON.stringify(t.body.mail)); assert.equal(t.body.mail.trash, 'Papelera'); assert.equal(t.body.mail.inboxCount, 2);
  assert.equal(t.body.smtp.ok, false);
  const wrong = await req('POST', '/api/accounts/test', { ...body, secrets: { password: 'mala' } });
  assert.equal(wrong.body.mail.ok, false);

  const ok = await req('POST', '/api/accounts/save', body);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.account.ready, true); assert.equal(ok.body.account.personal, false);
  const dup = await req('POST', '/api/accounts/save', body);
  assert.equal(dup.status, 409);
  const cfg = await req('GET', '/api/config');
  assert.equal(cfg.body.activeAccount, ok.body.account.id);
  assert.equal(cfg.text.includes('testpass'), false, 'la API no devuelve la contraseña');
  const sec = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
  assert.equal(sec.accounts[ok.body.account.id].imapPassword, 'testpass');
  assert.equal(fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('testpass'), false, 'la contraseña no va en config.json');
  await flush();
  const ev = service.events().filter(e => e.tipo === 'cuenta');
  assert.ok(ev.length >= 1);
  assert.equal(ev[0].datos.cuenta, 'yo@test.local'); assert.equal(ev[0].datos.personal, false);
});

test('la puerta de licencias: cuenta comercial solo simula hasta tener clave; con clave ejecuta de verdad', async () => {
  const cfg0 = (await req('GET', '/api/config')).body;
  assert.equal(cfg0.gate.permitido, false);
  assert.equal(cfg0.gate.comprar, 'https://mt.nonosky.com/herramienta.html#suscripcion');

  const r1 = await req('POST', '/api/autorun', { daysBack: 30, dureza: 50, dryRun: false, autoUnsub: true });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.forcedDryRun, true);
  await waitIdle();
  assert.equal(await count(imap.port), 2, 'sin licencia no se movió nada');
  assert.equal(smtpSrv.messages.length, 0, 'ni se dio de baja');
  assert.equal((await req('POST', '/api/unsubscribe', { email: 'ofertas@tienda.com' })).status, 402);

  const bad = await req('POST', '/api/licenses', { clave: 'NMT1.xxx.yyy' });
  assert.equal(bad.status, 400);
  const otra = await req('POST', '/api/licenses', { clave: keys.sign({ cuenta: 'otra@test.local' }) });
  assert.equal(otra.status, 200);
  assert.equal((await req('GET', '/api/config')).body.gate.permitido, false, 'la licencia de otra cuenta no abre esta');
  const ok = await req('POST', '/api/licenses', { clave: keys.sign({ cuenta: 'YO@test.local', canal: 'web' }) });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.licencia.canal, 'web', 'las licencias del servicio web valen en la app');
  const lic = await req('GET', '/api/licenses');
  assert.equal(lic.body.accounts[0].gates.limpiar.permitido, true);
  assert.equal(lic.body.accounts[0].gates.sincronizar.permitido, false, 'cada función tiene su clave');
  assert.equal(lic.text.includes('NMT1.'), false, 'las claves completas no salen a la interfaz');
  await flush();
  assert.ok(service.events().some(e => e.tipo === 'licencia' && e.datos.tipo === 'limpiar'));

  const r2 = await req('POST', '/api/autorun', { daysBack: 30, dureza: 50, dryRun: false, autoUnsub: false });
  assert.equal(r2.body.forcedDryRun, false);
  await waitIdle();
  assert.equal(await count(imap.port), 1, 'con licencia movió la oferta');
  assert.equal(await count(imap.port, 'Papelera'), 1, 'a la Papelera, no la borró');
  await flush();
  const lim = service.events().filter(e => e.tipo === 'limpiar').pop();
  assert.equal(lim.datos.dry_run, false); assert.equal(lim.datos.licencia, true); assert.equal(lim.datos.movidos, 1);
});

test('Conectar con Google: URL con redirect local, callback guarda el token y Desconectar lo borra', async () => {
  const st = await req('POST', '/api/oauth/google/start', { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' });
  assert.equal(st.status, 200);
  const url = new URL(st.body.authUrl);
  assert.equal(url.searchParams.get('redirect_uri'), `http://127.0.0.1:${port}/oauth/google/callback`);
  const state = url.searchParams.get('state');
  assert.equal((await req('GET', '/oauth/google/callback?code=x&state=otro')).status, 400, 'state desconocido se rechaza');
  const cb = await req('GET', `/oauth/google/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 200, cb.text); assert.match(cb.text, /Conectado como testuser@gmail\.com/);
  const accts = (await req('GET', '/api/accounts')).body.accounts;
  const g = accts.find(a => a.email === 'testuser@gmail.com');
  assert.equal(g.type, 'gmail-oauth'); assert.equal(g.googleConnected, true); assert.equal(g.personal, true);
  assert.equal(JSON.stringify(accts).includes('refresh-1'), false);
  assert.equal((await req('GET', `/oauth/google/callback?code=abc&state=${state}`)).status, 400, 'el state es de un solo uso');
  const d = await req('POST', '/api/oauth/google/disconnect', { id: g.id });
  assert.equal(d.body.accounts.find(a => a.id === g.id).googleConnected, false);
  assert.ok(google.calls.some(c => c.url.startsWith('/revoke')), 'revoca el token en Google');
  await req('POST', '/api/accounts/delete', { id: g.id });
});

test('Sincronizar por la API: copia entre dos cuentas personales sin duplicar y sin tocar el origen', async () => {
  const a = await req('POST', '/api/accounts/save', imapAccount('ana@gmail.com', imap.port));
  const b = await req('POST', '/api/accounts/save', imapAccount('beto@gmail.com', imapB.port));
  assert.equal(a.status, 200, a.text); assert.equal(b.status, 200, b.text);
  assert.equal((await req('POST', '/api/sync/start', { origen: a.body.account.id, destino: a.body.account.id })).status, 400);
  const before = await count(imap.port);

  const dry = await req('POST', '/api/sync/start', { origen: a.body.account.id, destino: b.body.account.id, dryRun: true });
  assert.equal(dry.status, 200, dry.text);
  const rd = await waitSync();
  assert.equal(rd.result.dryRun, true); assert.equal(await count(imapB.port), 0, 'la simulación no copia');

  const run = await req('POST', '/api/sync/start', { origen: a.body.account.id, destino: b.body.account.id, dryRun: false });
  assert.equal(run.body.forcedDryRun, false, 'cuentas personales: gratis');
  for (let i = 0; i < 100; i++) { if ((await req('GET', '/api/sync')).body.result && !(await req('GET', '/api/sync')).body.result.dryRun) break; await sleep(50); }
  const v = await waitSync();
  assert.equal(v.result.ok, true, JSON.stringify(v.result).slice(0, 400));
  assert.equal(await count(imapB.port), before);
  assert.equal(await count(imapB.port, 'Papelera'), 1, 'conserva las carpetas');
  assert.equal(await count(imap.port), before, 'el origen no se tocó');

  const again = await req('POST', '/api/sync/start', { origen: a.body.account.id, destino: b.body.account.id, dryRun: false });
  assert.equal(again.status, 200);
  await sleep(100); await waitSync();
  assert.equal(await count(imapB.port), before, 'una segunda corrida no duplica');
  await flush();
  const ev = service.events().filter(e => e.tipo === 'sincronizar');
  assert.ok(ev.some(e => !e.datos.dry_run && e.datos.copiados === before + 1 && e.datos.resultado === 'ok'), JSON.stringify(ev));
});

test('errores de la interfaz van al registro y a la telemetría de errores, sin secretos', async () => {
  const r = await req('POST', '/api/system/ui-error', { message: 'x is not a function password=hunter2 de ana@secreta.com', source: 'http://127.0.0.1/app.js', line: 12 });
  assert.equal(r.status, 200);
  const log = fs.readFileSync(path.join(dir, 'logs', 'nonimail-tools.log'), 'utf8');
  assert.match(log, /x is not a function/);
  assert.equal(log.includes('hunter2'), false);
  const q = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry-queue.json'), 'utf8')).eventos;
  const e = q.filter(x => x.tipo === 'error').pop();
  assert.ok(e, 'queda en la cola de telemetría');
  assert.equal(e.datos.contexto, 'app');
  assert.equal(JSON.stringify(e).includes('hunter2'), false);
  assert.equal(JSON.stringify(e).includes('ana@secreta.com'), false);
  const info = (await req('GET', '/api/system/info')).body;
  assert.equal(info.logsDir, path.join(dir, 'logs'));
});

test('npm start (server.js) levanta sin ventana, imprime la dirección y guarda sus datos aparte', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-head-'));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, NMT_DATA_DIR: d2, NMT_PORT: '0', NMT_TELEMETRY: '0', NMT_LANGUAGE: 'es' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; proc.stdout.on('data', c => out += c); proc.stderr.on('data', c => out += c);
  try {
    for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+\//.test(out); i++) await sleep(50);
    const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
    assert.ok(m, out);
    const res = await fetch(`http://127.0.0.1:${m[1]}/api/config`);
    assert.equal(res.status, 200);
    assert.ok(fs.existsSync(path.join(d2, 'logs', 'nonimail-tools.log')));
  } finally { proc.kill(); await new Promise(r => proc.on('close', r)); fs.rmSync(d2, { recursive: true, force: true }); }
});

test('Planes, modo de IA y tareas por la API: sin suscripción, Gratis; la IA de Nonosky se elige y se vuelve atrás', async () => {
  const p = await req('GET', '/api/plan');
  assert.equal(p.status, 200); assert.equal(p.body.incluida, false); assert.equal(p.body.precios.moneda, 'USD');
  assert.equal(p.body.subscribeUrl, 'https://mt.nonosky.com/herramienta.html#suscripcion');
  const tr = await req('GET', '/api/tareas');
  assert.equal(tr.body.incluida, false); assert.deepEqual(tr.body.tareas, []);
  assert.equal((await req('POST', '/api/tareas/activar', { tipo: 'limpiar', consentimiento: false })).status, 400, 'sin consentimiento no se manda nada');
  assert.equal((await req('POST', '/api/tareas/activar', { tipo: 'limpiar', consentimiento: true })).status, 402, 'sin suscripción, no');
  assert.equal((await req('POST', '/api/prefs/ai', { mode: 'otra' })).status, 400);
  assert.equal((await req('POST', '/api/prefs/ai', { mode: 'nonosky' })).body.aiMode, 'nonosky');
  assert.equal((await req('GET', '/api/config')).body.aiMode, 'nonosky');
  assert.equal((await req('POST', '/api/prefs/ai', { mode: 'off' })).body.aiMode, 'off');
  assert.equal((await req('POST', '/api/prefs/ai', { mode: 'equipo' })).body.aiMode, 'equipo');
});
