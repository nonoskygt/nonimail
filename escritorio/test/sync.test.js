'use strict';
// Motor de Sincronizar contra servidores IMAP en memoria (hoodiecrow): copia sin duplicar, conserva carpetas,
// banderas y fechas, simula sin escribir, no toca el origen y se puede cancelar o limitar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const hoodiecrow = require('hoodiecrow-imap');
const { ImapFlow } = require('imapflow');
const { runSync, messageIdentity } = require('../lib/sync/engine');
const S = require('./helpers/servers');

const boxes = [];
function startBox(storage) {
  const server = hoodiecrow({ plugins: S.ALL_PLUGINS, storage });
  return new Promise(res => server.listen(0, '127.0.0.1', () => {
    const port = (server.server || server).address().port;
    const socks = new Set(); (server.server || server).on('connection', c => { socks.add(c); c.on('close', () => socks.delete(c)); });
    const b = { port, mb: { host: '127.0.0.1', port, secure: false, auth: { user: 'testuser', pass: 'testpass' } }, close: () => new Promise(r => { for (const c of socks) c.destroy(); server.close(r); setTimeout(r, 1500).unref(); }) };
    boxes.push(b); res(b);
  }));
}
const m = (o) => { const x = S.msg({ from: 'Ana <ana@amiga.com>', ...o}); return { raw: x.raw, internaldate: x.internaldate, flags: o.flags || [] }; };

// Estado de un buzón: { carpeta: [{ subject, flags, idate }] }
async function snapshot(b) {
  const c = new ImapFlow({ host: '127.0.0.1', port: b.port, secure: false, auth: b.mb.auth, logger: false });
  c.on('error', () => {}); await c.connect();
  const out = {};
  try {
    for (const f of await c.list()) {
      if (f.flags.has('\\Noselect')) continue;
      const lock = await c.getMailboxLock(f.path, { readOnly: true });
      try {
        const rows = [];
        if (c.mailbox.exists) for await (const x of c.fetch('1:*', { envelope: true, flags: true, internalDate: true })) rows.push({ subject: x.envelope.subject, flags: [...x.flags].filter(g => g !== '\\Recent').sort(), idate: x.internalDate.toISOString().slice(0, 10) });
        out[f.path] = rows.sort((p, q) => String(p.subject).localeCompare(String(q.subject)));
      } finally { lock.release(); }
    }
  } finally { await c.logout(); }
  return out;
}
const total = (snap) => Object.values(snap).reduce((a, r) => a + r.length, 0);

let src, dst;
before(async () => {
  src = await startBox({
    INBOX: { messages: [
      m({ subject: 'Ya está en destino', id: '<a@t>', day: '2026-01-10', flags: ['\\Seen'] }),
      m({ subject: 'Leído y destacado', id: '<b@t>', day: '2026-02-11', flags: ['\\Seen', '\\Flagged'] }),
      m({ subject: 'Sin marcas', id: '<c@t>', day: '2026-03-12' }),
    ] },
    '': { separator: '/', folders: {
      Enviados: { 'special-use': '\\Sent', messages: [m({ subject: 'Enviado uno', id: '<e@t>', day: '2026-05-01', flags: ['\\Seen'] })] },
      Clientes: { messages: [m({ subject: 'En Clientes', id: '<h@t>', day: '2026-06-01' })] },
    } },
  });
  dst = await startBox({
    INBOX: { messages: [m({ subject: 'Ya está en destino', id: '<a@t>', day: '2026-01-10' })] },
    '': { separator: '/', folders: { Sent: { 'special-use': '\\Sent', messages: [] } } },
  });
});
after(async () => { for (const b of boxes) await b.close(); });

test('messageIdentity: el Message-ID manda y, sin él, un hash estable', () => {
  assert.equal(messageIdentity({ messageId: 'x@y' }, 10), 'mid:<x@y>');
  assert.equal(messageIdentity({ messageId: ' <x@y> ' }, 10), 'mid:<x@y>');
  const env = { date: new Date('2026-01-01T00:00:00Z'), subject: ' S ', from: [{ address: 'B@X.com' }], to: [{ address: 'z@a' }, { address: 'A@b' }] };
  const h1 = messageIdentity(env, 5);
  assert.match(h1, /^h:[0-9a-f]{40}$/);
  assert.equal(h1, messageIdentity({ ...env, subject: 'S', to: [{ address: 'a@b' }, { address: 'Z@A' }] }, 5));
  assert.notEqual(h1, messageIdentity(env, 6));
});

test('simulación: informa qué copiaría y no escribe nada en el destino', async () => {
  const before = await snapshot(dst);
  const logs = [];
  const r = await runSync({ origen: src.mb, destino: dst.mb, dryRun: true, onLog: s => logs.push(s) });
  assert.equal(r.error, null, r.error); assert.equal(r.dryRun, true);
  const inbox = r.folders.find(f => f.source === 'INBOX');
  assert.deepEqual([inbox.sourceCount, inbox.existing, inbox.toCopy, inbox.copied], [3, 1, 2, 0]);
  assert.equal(r.totals.copied, 0);
  assert.deepEqual(await snapshot(dst), before);
  assert.ok(logs.length > 0);
});

test('copia real: carpetas, banderas y fechas se conservan; Enviados se une a Sent; el origen queda intacto', async () => {
  const srcBefore = await snapshot(src);
  const progress = [];
  const r = await runSync({ origen: src.mb, destino: dst.mb, dryRun: false, onProgress: p => progress.push(p) });
  assert.equal(r.error, null, r.error);
  assert.equal(r.ok, true, JSON.stringify(r.verification));
  assert.equal(r.verification.ok, true);
  assert.equal(r.totals.copied, 4);
  assert.ok(progress.length > 0);
  const d = await snapshot(dst);
  assert.equal(d.INBOX.length, 3, 'sin duplicar el que ya estaba');
  const byS = (rows, s) => rows.find(x => x.subject === s);
  assert.deepEqual(byS(d.INBOX, 'Leído y destacado').flags, ['\\Flagged', '\\Seen']);
  assert.equal(byS(d.INBOX, 'Leído y destacado').idate, '2026-02-11', 'conserva la fecha interna');
  assert.deepEqual(byS(d.INBOX, 'Sin marcas').flags, []);
  assert.deepEqual(d.Sent.map(x => x.subject), ['Enviado uno'], 'la carpeta de enviados se fusiona con la equivalente');
  assert.equal(d.Enviados, undefined);
  assert.deepEqual(d.Clientes.map(x => x.subject), ['En Clientes'], 'las carpetas propias se crean');
  assert.deepEqual(await snapshot(src), srcBefore, 'el origen no se toca nunca');
});

test('una segunda corrida no duplica nada', async () => {
  const before = await snapshot(dst);
  const r = await runSync({ origen: src.mb, destino: dst.mb, dryRun: false });
  assert.equal(r.error, null, r.error); assert.equal(r.totals.copied, 0); assert.equal(r.ok, true);
  assert.deepEqual(await snapshot(dst), before);
  assert.equal(total(before), 5);
});

test('filtro de carpetas, exclusión y cancelación', async () => {
  const a = await startBox({ INBOX: { messages: [m({ subject: 'uno', id: '<1@t>' }), m({ subject: 'dos', id: '<2@t>' })] }, '': { separator: '/', folders: { Otra: { messages: [m({ subject: 'otra', id: '<3@t>' })] } } } });
  const b1 = await startBox({ INBOX: { messages: [] } });
  const r1 = await runSync({ origen: a.mb, destino: b1.mb, dryRun: false, folders: ['INBOX'] });
  assert.equal(r1.error, null, r1.error);
  const s1 = await snapshot(b1);
  assert.equal(s1.INBOX.length, 2); assert.equal(s1.Otra, undefined);

  const b2 = await startBox({ INBOX: { messages: [] } });
  await runSync({ origen: a.mb, destino: b2.mb, dryRun: false, excludeFolders: ['INBOX'] });
  const s2 = await snapshot(b2);
  assert.equal(s2.INBOX.length, 0); assert.equal(s2.Otra.length, 1);

  const b3 = await startBox({ INBOX: { messages: [] } });
  const r3 = await runSync({ origen: a.mb, destino: b3.mb, dryRun: false, shouldCancel: () => true });
  assert.equal(r3.cancelled, true); assert.equal(r3.ok, false);
  assert.equal(total(await snapshot(b3)), 0, 'cancelado antes de copiar');
});

test('un servidor que no responde da un error claro y no revienta', async () => {
  const bad = { host: '127.0.0.1', port: 1, secure: false, auth: { user: 'x', pass: 'y' } };
  const r = await runSync({ origen: bad, destino: dst.mb, dryRun: true });
  assert.ok(r.error);
  assert.match(r.error, /origen/);
  assert.equal(r.ok, false);
});

test('terminal de Sincronizar: el runner emite por SSE líneas, progreso con bytes y el fin', async () => {
  const { SyncRunner } = require('../lib/sync/runner');
  const { defaults } = require('../lib/defaults');
  const events = [];
  const cfg = JSON.parse(JSON.stringify(defaults()));
  cfg.sync.progressEvery = 1;
  const r = new SyncRunner({ cfg: () => cfg, mailbox: async () => null, licenses: { gate: () => ({ permitido: true, personal: true }) }, sse: (e) => events.push(e) });
  const dstBox = await startBox({ INBOX: { messages: [] }, '': { separator: '/', folders: {} } });
  r.o.mailbox = async (id) => ({ email: `${id}@x.test`, mb: id === 'o' ? src.mb : dstBox.mb });
  await r.start({ origen: 'o', destino: 'd', dryRun: false, folders: ['INBOX'] });
  while (r.busy()) await new Promise(res => setTimeout(res, 20));
  const sync = events.filter(e => e.t === 'sync');
  assert.equal(sync[0].tipo, 'inicio');
  assert.ok(sync.some(e => e.tipo === 'linea' && /INBOX/.test(e.text)), 'carpeta y mensajes comparados');
  const prog = sync.filter(e => e.tipo === 'progreso');
  assert.ok(prog.length > 0 && prog.every(e => typeof e.progress.bytes === 'number') && prog.pop().progress.bytes > 0, 'bytes copiados');
  assert.equal(sync.pop().tipo, 'fin');
});
