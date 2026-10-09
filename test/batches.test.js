'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const b = require('../lib/batches');

function covers(wins, from, to) {
  // contiguas, de la más nueva a la más vieja, sin huecos ni solapes, cubriendo [from, to)
  assert.equal(wins[0].before, to);
  assert.equal(wins[wins.length - 1].since, from);
  for (let i = 1; i < wins.length; i++) assert.equal(wins[i].before, wins[i - 1].since);
  for (const w of wins) assert.ok(w.since < w.before);
}

test('1 año en lotes de 30 días: 13 ventanas que cubren exactamente 365 días hasta hoy inclusive', () => {
  const w = b.makeWindows({ daysBack: 365, windowDays: 30, today: '2026-10-09' });
  assert.equal(w.length, 13);
  covers(w, '2025-10-10', '2026-10-10');
  assert.equal(w[0].since, '2026-09-10');
  assert.equal(w[0].label, '2026-09-10 → 2026-10-09');
  assert.equal(b.diffDays(w[12].since, w[12].before), 5); // el último lote es el resto
});

test('rango menor que un lote: una sola ventana', () => {
  const w = b.makeWindows({ daysBack: 7, windowDays: 30, today: '2026-10-09' });
  assert.deepEqual(w.map(x => [x.since, x.before]), [['2026-10-03', '2026-10-10']]);
});

test('"Todo" arranca en el correo más viejo', () => {
  const w = b.makeWindows({ daysBack: 0, windowDays: 365, today: '2026-10-09', oldest: new Date('2019-03-15T08:00:00Z') });
  covers(w, '2019-03-15', '2026-10-10');
  assert.equal(w.length, 8);
});

test('dayToDate da medianoche UTC (imapflow formatea las fechas IMAP en UTC)', () => {
  assert.equal(b.dayToDate('2026-02-28').toISOString(), '2026-02-28T00:00:00.000Z');
  assert.equal(b.addDays('2024-02-28', 1), '2024-02-29');
});

test('ProgressStore guarda, relee y borra trabajos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-prog-'));
  const file = path.join(dir, 'progress.json');
  const key = b.jobKey({ kind: 'auto', account: 'a@b.com', folder: 'INBOX', daysBack: 365, windowDays: 30, dryRun: true });
  const s1 = new b.ProgressStore(file);
  s1.put({ key, kind: 'auto', doneIdx: 3 });
  const s2 = new b.ProgressStore(file);
  assert.equal(s2.get(key).doneIdx, 3);
  assert.equal(s2.list().length, 1);
  s2.remove(key);
  assert.equal(new b.ProgressStore(file).get(key), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
