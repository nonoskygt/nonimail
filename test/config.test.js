'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../lib/config');
const D = require('../lib/defaults');
const { defaultDataDir, resolveDataDir } = require('../lib/paths');
const { Secrets } = require('../lib/secrets');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nm-cfg-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('defaults.json trae todo lo configurable y la configuración nueva sale válida', () => {
  const d = D.defaults();
  assert.equal(d.service.url, 'https://mt.nonosky.com');
  assert.equal(d.ollamaUrl, 'http://127.0.0.1:11434');
  assert.match(d.ollama.installer.windows, /^https:\/\/.*OllamaSetup\.exe$/);
  assert.match(d.ollama.installer.linux, /^https:\/\//);
  assert.equal(d.appearance.mode, 'auto');
  assert.equal(d.appearance.accent, 'carmesi');
  assert.equal(d.licenses.prices.limpiar, '1');
  assert.equal(d.licenses.prices.sincronizar, '2');
  const dir = tmpdir();
  const store = new C.ConfigStore({ file: path.join(dir, 'config.json'), env: {} });
  assert.equal(store.created, true);
  assert.deepEqual(C.validate(store.get()), []);
  assert.equal(store.get().setup.done, false);
  assert.ok(store.get().llmPrompt.length > 50);
  rm(dir);
});

test('config.json guarda solo la diferencia con los valores por defecto', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  const store = new C.ConfigStore({ file, env: {} });
  store.save({ port: 9001, appearance: { ...store.get().appearance, accent: 'azul' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { port: 9001, appearance: { accent: 'azul' } });
  const again = new C.ConfigStore({ file, env: {} });
  assert.equal(again.get().port, 9001);
  assert.equal(again.get().appearance.accent, 'azul');
  assert.equal(again.get().appearance.mode, 'auto', 'lo no tocado sigue el valor por defecto');
  rm(dir);
});

test('las variables NMT_* ganan sobre el archivo y nunca se escriben en disco', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ service: { url: 'https://usuario.example' }, model: 'del-usuario:1b' }));
  const env = { NMT_SERVICE_URL: 'https://env.example', NMT_PORT: '9100', NMT_TELEMETRY: '0', NMT_OLLAMA_INSTALLER_WINDOWS: 'https://espejo.example/OllamaSetup.exe' };
  const store = new C.ConfigStore({ file, env });
  const cfg = store.get();
  assert.equal(cfg.service.url, 'https://env.example');
  assert.equal(cfg.port, 9100);
  assert.equal(cfg.telemetry.enabled, false);
  assert.equal(cfg.ollama.installer.windows, 'https://espejo.example/OllamaSetup.exe');
  assert.equal(cfg.model, 'del-usuario:1b', 'sin variable, vale el archivo del usuario');
  assert.ok(store.locked.includes('service.url'));
  store.save({ model: 'otro:2b', service: { ...cfg.service, url: 'https://cambiado.example' } });
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disk.model, 'otro:2b');
  assert.equal(disk.service.url, 'https://usuario.example', 'lo que viene del entorno no se pisa en disco');
  assert.equal(disk.port, undefined);
  rm(dir);
});

test('NMT_CONFIG_FILE aporta un archivo de valores para administradores', () => {
  const dir = tmpdir(), extra = path.join(dir, 'extra.json');
  fs.writeFileSync(extra, JSON.stringify({ ollamaUrl: 'http://gpu.example:11434' }));
  const store = new C.ConfigStore({ file: path.join(dir, 'config.json'), env: { NMT_CONFIG_FILE: extra } });
  assert.equal(store.get().ollamaUrl, 'http://gpu.example:11434');
  rm(dir);
});

test('la carpeta de datos es la correcta de cada sistema y NMT_DATA_DIR la cambia', () => {
  assert.equal(defaultDataDir('win32', { APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming' }, 'C:\\Users\\Ana').replace(/\\/g, '/').split('/').pop(), 'NoniMail Tools');
  assert.equal(defaultDataDir('linux', {}, '/home/ana'), path.join('/home/ana', '.config', 'nonimail-tools'));
  assert.equal(defaultDataDir('linux', { XDG_CONFIG_HOME: '/x/cfg' }, '/home/ana'), path.join('/x/cfg', 'nonimail-tools'));
  assert.equal(defaultDataDir('darwin', {}, '/Users/ana'), path.join('/Users/ana', 'Library', 'Application Support', 'NoniMail Tools'));
  assert.equal(resolveDataDir(null, { NMT_DATA_DIR: '/tmp/nmt-x' }), path.resolve('/tmp/nmt-x'));
  assert.equal(resolveDataDir('/tmp/explicita', { NMT_DATA_DIR: '/tmp/nmt-x' }), path.resolve('/tmp/explicita'));
});

test('config 1.x se migra, se respalda y se quitan las claves del Apps Script', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({
    gmailBridge: 'https://script.google.com/x/exec', gmailKey: 'secreta', ollamaUrl: 'http://localhost:11434',
    model: 'ornith:9b', models: ['ornith:9b'], port: 8765, protectConversations: true, myAddresses: ['yo@x.com'],
    defaults: { query: 'in:inbox', bodyMaxChars: 2000 }, heuristics: { keepOverride: 'banco', subject: 'oferta', from: 'noreply', body: 'unsubscribe' }, llmPrompt: 'P',
  }));
  const store = new C.ConfigStore({ file, env: {} });
  const cfg = store.get();
  assert.ok(store.migratedFrom && fs.existsSync(store.migratedFrom), 'deja respaldo del archivo original');
  assert.match(fs.readFileSync(store.migratedFrom, 'utf8'), /secreta/);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal('gmailKey' in saved, false);
  assert.equal('gmailBridge' in saved, false);
  assert.equal(cfg.model, 'ornith:9b');
  assert.deepEqual(cfg.cleaning.myAddresses, ['yo@x.com']);
  assert.equal(cfg.cleaning.bodyMaxChars, 2000);
  assert.equal(cfg.heuristics.subject, 'oferta');
  rm(dir);
});

test('config 2.0 con una sola cuenta pasa a la lista de cuentas y salta el configurador', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ account: { type: 'gmail-password', email: 'ana@gmail.com' }, model: 'm:1b' }));
  const store = new C.ConfigStore({ file, env: {} });
  const cfg = store.get();
  assert.equal(cfg.accounts.length, 1);
  assert.equal(cfg.accounts[0].email, 'ana@gmail.com');
  assert.equal(cfg.activeAccount, cfg.accounts[0].id);
  assert.equal(cfg.setup.done, true);
  assert.equal(store.legacyAccountId, cfg.accounts[0].id);
  assert.equal('account' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
  rm(dir);
});

test('un config.json parcial hereda las protecciones y el prompt de fábrica', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ port: 8800, model: 'm', heuristics: { keepOverride: '' }, llmPrompt: '  ' }));
  const cfg = new C.ConfigStore({ file, env: {} }).get();
  assert.match(cfg.heuristics.keepOverride, /factura/);
  assert.ok(cfg.llmPrompt.length > 50);
  assert.equal(cfg.port, 8800);
  rm(dir);
});

test('mergeKnown ignora claves desconocidas y convierte tipos', () => {
  const dflt = D.defaults();
  const shape = C.pickShape(dflt, C.SETTINGS_PATHS);
  const out = C.mergeKnown(shape, C.deepDefaults(dflt, {}), {
    port: '9000', hack: 1, service: { url: ' https://x.example ', evil: 1 },
    cleaning: { myAddresses: 'x@y.com, z@w.com', dryRun: false, daysBack: '15' }, heuristics: { subject: '.*' },
  });
  assert.equal(out.port, 9000);
  assert.equal('hack' in out, false);
  assert.equal(out.service.url, 'https://x.example');
  assert.equal('evil' in out.service, false);
  assert.equal(out.cleaning.daysBack, 15);
  assert.deepEqual(out.cleaning.myAddresses, ['x@y.com', 'z@w.com']);
  assert.equal(out.cleaning.dryRun, false);
  assert.notEqual(out.heuristics.subject, '.*', 'las heurísticas no se tocan desde Ajustes');
});

test('validate reporta errores legibles', () => {
  const cfg = C.deepDefaults(D.defaults(), {});
  cfg.port = 80; cfg.ollamaUrl = 'localhost'; cfg.service.url = 'ftp://x';
  cfg.language = 'fr'; cfg.appearance.mode = 'raro';
  cfg.llm.doubtLow = 70; cfg.llm.doubtHigh = 30; cfg.cleaning.myAddresses = ['no-es-correo'];
  cfg.accounts = [{ ...C.ACCOUNT_DEFAULT, id: 'a1', type: 'imap', email: 'mal' }];
  const e = C.validate(cfg).join(' | ');
  for (const frag of ['Puerto', 'Ollama', 'servicio', 'Idioma', 'Modo', 'rango de duda', 'no-es-correo', 'Correo de la cuenta', 'servidor IMAP']) assert.match(e, new RegExp(frag, 'i'), frag);
});

test('Secrets: guarda por cuenta, no pisa con vacío, borra con null y no expone valores', () => {
  const dir = tmpdir(), file = path.join(dir, 'secrets.json');
  const s = new Secrets(file);
  s.setAccount('a1', { imapPassword: 'abc', otra: 'x' });
  s.setAccount('a1', { imapPassword: '' });
  assert.equal(new Secrets(file).scope('a1').get('imapPassword'), 'abc');
  assert.deepEqual(s.accountStatus('a1'), { hasPassword: true, googleConnected: false });
  assert.equal(JSON.stringify(s.status()).includes('abc'), false);
  s.setAccount('a1', { imapPassword: null });
  assert.equal(new Secrets(file).scope('a1').get('imapPassword'), '');
  assert.equal('otra' in JSON.parse(fs.readFileSync(file, 'utf8')).accounts, false);
  rm(dir);
});

test('Secrets cifra con el llavero del sistema cuando lo hay (safeStorage) y no deja nada legible', () => {
  const dir = tmpdir(), file = path.join(dir, 'secrets.json');
  const cipher = { available: () => true, encrypt: (s) => Buffer.from(`ENC:${Buffer.from(s).reverse().toString('latin1')}`), decrypt: (b) => Buffer.from(b.toString().slice(4), 'latin1').reverse().toString() };
  const s = new Secrets(file, { cipher });
  s.setAccount('a1', { imapPassword: 'clave-muy-secreta' });
  s.set({ googleClientSecret: 'GOCSPX-secreto' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(raw).enc, 'safeStorage');
  assert.equal(raw.includes('clave-muy-secreta'), false);
  assert.equal(raw.includes('GOCSPX'), false);
  const back = new Secrets(file, { cipher });
  assert.equal(back.scope('a1').get('imapPassword'), 'clave-muy-secreta');
  assert.equal(back.get('googleClientSecret'), 'GOCSPX-secreto');
  // sin llavero no se puede leer lo cifrado: no revienta, queda vacío
  assert.equal(new Secrets(file).scope('a1').get('imapPassword'), '');
  rm(dir);
});
