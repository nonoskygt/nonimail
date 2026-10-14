'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../lib/config');
const { Secrets } = require('../lib/secrets');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nm-cfg-'));
const EXAMPLE = path.join(__dirname, '..', 'config.example.json');

test('sin config.json se crea desde el ejemplo con todos los valores por defecto', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  const { cfg, created } = C.loadConfig(file, EXAMPLE);
  assert.equal(created, true);
  assert.ok(fs.existsSync(file));
  assert.equal(cfg.host, '127.0.0.1');
  assert.equal(cfg.account.type, 'none');
  assert.ok(cfg.llmPrompt.length > 50, 'el prompt viene del ejemplo');
  assert.deepEqual(C.validate(cfg), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config 1.x se migra, se respalda y se quitan las claves del Apps Script', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({
    gmailBridge: 'https://script.google.com/x/exec', gmailKey: 'secreta', ollamaUrl: 'http://localhost:11434',
    model: 'ornith:9b', models: ['ornith:9b'], port: 8765, protectConversations: true, myAddresses: ['yo@x.com'],
    defaults: { query: 'in:inbox', bodyMaxChars: 2000 }, heuristics: { keepOverride: 'banco', subject: 'oferta', from: 'noreply', body: 'unsubscribe' }, llmPrompt: 'P',
  }));
  const { cfg, migratedFrom } = C.loadConfig(file, EXAMPLE);
  assert.ok(migratedFrom && fs.existsSync(migratedFrom), 'deja respaldo del archivo original');
  assert.match(fs.readFileSync(migratedFrom, 'utf8'), /secreta/);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal('gmailKey' in saved, false);
  assert.equal('gmailBridge' in saved, false);
  assert.equal(cfg.model, 'ornith:9b');
  assert.deepEqual(cfg.cleaning.myAddresses, ['yo@x.com']);
  assert.equal(cfg.cleaning.bodyMaxChars, 2000);
  assert.equal(cfg.heuristics.subject, 'oferta');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('un config.json parcial hereda las protecciones y el prompt de la plantilla', () => {
  const dir = tmpdir(), file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ port: 8800, model: 'm' }));
  const { cfg } = C.loadConfig(file, EXAMPLE);
  assert.match(cfg.heuristics.keepOverride, /factura/);
  assert.ok(cfg.llmPrompt.length > 50);
  assert.equal(cfg.port, 8800);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeKnown ignora claves desconocidas y convierte tipos', () => {
  const base = C.deepDefaults(C.DEFAULTS, {});
  const out = C.mergeKnown(C.SETTINGS_SHAPE, base, {
    port: '9000', hack: 1, account: { type: 'imap', email: ' a@b.com ', imap: { port: '143', secure: 'false', evil: 1 } },
    cleaning: { myAddresses: 'x@y.com, z@w.com', dryRun: false }, heuristics: { subject: '.*' },
  });
  assert.equal(out.port, 9000);
  assert.equal('hack' in out, false);
  assert.equal(out.account.email, 'a@b.com');
  assert.equal(out.account.imap.port, 143);
  assert.equal(out.account.imap.secure, false);
  assert.equal('evil' in out.account.imap, false);
  assert.deepEqual(out.cleaning.myAddresses, ['x@y.com', 'z@w.com']);
  assert.equal(out.cleaning.dryRun, false);
  assert.equal(out.heuristics.subject, '', 'las heurísticas no se tocan desde Configuración');
});

test('validate reporta errores legibles', () => {
  const cfg = C.deepDefaults(C.DEFAULTS, {});
  cfg.port = 80; cfg.account.type = 'imap'; cfg.account.email = 'mal'; cfg.ollamaUrl = 'localhost';
  cfg.llm.doubtLow = 70; cfg.llm.doubtHigh = 30; cfg.cleaning.myAddresses = ['no-es-correo'];
  const e = C.validate(cfg).join(' | ');
  for (const frag of ['Puerto', 'Correo de la cuenta', 'servidor IMAP', 'Ollama', 'rango de duda', 'no-es-correo']) assert.match(e, new RegExp(frag));
});

test('Secrets: guarda, no pisa con vacío, borra con null y no expone valores', () => {
  const dir = tmpdir(), file = path.join(dir, 'secrets.json');
  const s = new Secrets(file);
  s.set({ imapPassword: 'abc', otra: 'x' });
  s.set({ imapPassword: '' });
  assert.equal(new Secrets(file).get('imapPassword'), 'abc');
  assert.deepEqual(s.status(), { hasImapPassword: true, hasGoogleClientSecret: false, googleConnected: false });
  assert.equal(JSON.stringify(s.status()).includes('abc'), false);
  s.set({ imapPassword: null });
  assert.equal(new Secrets(file).get('imapPassword'), '');
  assert.equal('otra' in JSON.parse(fs.readFileSync(file, 'utf8')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
