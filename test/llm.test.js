'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const llm = require('../lib/llm');

test('parseScore toma el veredicto, no la escala', () => {
  assert.equal(llm.parseScore('95', 50), 95);
  assert.equal(llm.parseScore('Puntaje: 12', 50), 12);
  assert.equal(llm.parseScore('Puntaje (0-100): 80', 50), 80);
  assert.equal(llm.parseScore('Es publicidad. **85**', 50), 85);
  assert.equal(llm.parseScore('le doy 70 sobre 100', 50), 70);
  assert.equal(llm.parseScore('70/100', 50), 70);
  assert.equal(llm.parseScore('sin número', 50), 50);
  assert.equal(llm.parseScore(null, 33), 33);
});

test('buildPrompt incluye remitente, asuntos y BULK, y no pide razonar en el texto', () => {
  const p = llm.buildPrompt('BASE', { from: 'a@b', subjects: ['x', 'y'], bulk: true, body: 'cuerpo' });
  assert.match(p, /^BASE\n\nEmail:\nFROM: a@b\nSUBJECT: x \| y\nBULK: si\nBODY: cuerpo\n\nPuntaje \(0-100\):$/);
  assert.doesNotMatch(p, /[Rr]azona/, 'contradiría el "solo un número" del prompt base');
});

function fakeOllama(handler) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        const out = handler(req.url, b ? JSON.parse(b) : null);
        rsp.writeHead(out.status || 200, { 'Content-Type': 'application/json' }); rsp.end(JSON.stringify(out.body));
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
const cfgFor = (url) => ({ ollamaUrl: url, model: 'm', llmPrompt: 'P', llm: { numCtx: 4096, thinkNumPredict: 100, thinkNumCtx: 8192 } });

test('generate: respuesta, error de modelo y Ollama caído', async () => {
  const { srv, url } = await fakeOllama((path, body) => {
    if (body.model === 'falta') return { status: 404, body: { error: 'model "falta" not found' } };
    return { body: { response: ' 42 ', done_reason: 'stop' } };
  });
  try {
    assert.deepEqual(await llm.generate(cfgFor(url), 'x'), { ok: true, text: '42' });
    const e = await llm.generate({ ...cfgFor(url), model: 'falta' }, 'x');
    assert.equal(e.ok, false); assert.match(e.error, /not found/);
  } finally { srv.close(); }
  const down = await llm.generate(cfgFor('http://127.0.0.1:9'), 'x', { timeoutMs: 3000 });
  assert.equal(down.ok, false); assert.match(down.error, /no responde/);
});

test('generate pensando: si se corta sin responder devuelve null (no adivina del razonamiento)', async () => {
  const { srv, url } = await fakeOllama(() => ({ body: { response: '', thinking: 'Puntaje (0-100) ... pienso que 30 o 70', done_reason: 'length' } }));
  try {
    const r = await llm.generate(cfgFor(url), 'x', { think: true });
    assert.equal(r.ok, true); assert.equal(r.text, null); assert.equal(r.truncated, true);
  } finally { srv.close(); }
});

test('listModels devuelve los nombres ordenados y el digest de cada uno', async () => {
  const { srv, url } = await fakeOllama(() => ({ body: { models: [{ name: 'b:9b', digest: 'd2' }, { name: 'a:9b', digest: 'd1' }] } }));
  try {
    assert.deepEqual(await llm.listModels(url), { ok: true, models: ['a:9b', 'b:9b'], digests: { 'b:9b': 'd2', 'a:9b': 'd1' } });
  } finally { srv.close(); }
});
