'use strict';
// Puerta de validación de modelos: regla de aprobado, pensamiento automático y qué tiers se ofrecen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { defaults } = require('../lib/defaults');
const { judge, validateModel, offer } = require('../lib/validate');

const V = defaults().llm.validation;
const cfgOf = () => JSON.parse(JSON.stringify(defaults()));

test('regla de aprobado: todo crítico ≤ 30, 3 de 4 promociones ≥ 70 y latencia media bajo el límite', () => {
  const mk = (crit, highs, ms = 200) => [
    ...crit.map((s, i) => ({ name: `c${i}`, group: 'critical', score: s, ms })),
    ...highs.map((s, i) => ({ name: `h${i}`, group: 'high', score: s, ms })),
  ];
  const ok = mk([5, 10, 30, 0], [95, 90, 80, 40]);
  assert.equal(judge(ok, V).pass, true, '3 de 4 promociones bastan');
  const miss = judge(mk([5, 45, 10, 0], [95, 90, 80, 85]), V);   // un crítico en 45: falla aunque lo demás sea perfecto
  assert.equal(miss.pass, false); assert.deepEqual(miss.criticalMiss, ['c1']);
  assert.equal(judge(mk([5, null], [95, 90, 80, 85]), V).pass, false, 'un crítico sin entender tampoco pasa');
  assert.equal(judge(mk([5], [95, 90, 40, 40]), V).pass, false, 'solo 2 promociones');
  assert.equal(judge(mk([5], [95, 90, 80, 85], 3500), V).pass, false, 'demasiado lento');
});

test('si pensar se corta, se duplica el presupuesto una vez y luego se apaga el pensamiento del modelo', async () => {
  const cfg = cfgOf(); cfg.llm.think = true; cfg.llm.thinkNumPredict = 100;
  const budgets = [];
  const fake = (alwaysCut) => async (c, prompt, { think }) => {
    if (!think) return { ok: true, text: /ofertas@|FROM: .*(news|promo|no-reply@spotify)/.test(prompt) ? '95' : '5' };
    budgets.push(c.llm.thinkNumPredict);
    return alwaysCut || c.llm.thinkNumPredict < 200 ? { ok: true, text: null, truncated: true } : { ok: true, text: '60' };
  };
  let r = await validateModel(cfg, { generate: fake(true) });
  assert.deepEqual(budgets, [100, 200], 'un reintento con el doble');
  assert.deepEqual(r.think, { enabled: false, numPredict: 100 });
  budgets.length = 0;
  r = await validateModel(cfg, { generate: fake(false) });
  assert.deepEqual(r.think, { enabled: true, numPredict: 200 }, 'con el doble sí termina: se guarda ese presupuesto');
});

test('un tier que no pasa se oculta y la selección cae al recomendado entre los que pasan', () => {
  const tiers = defaults().ollama.tiers;                      // basic 2b, medium 4b, large 9b
  const verdicts = { 'qwen3.5:9b': false, 'qwen3.5:4b': true, 'qwen3.5:2b': null };
  const r = offer(tiers, 'large', 'qwen3.5:9b', (tag) => verdicts[tag], () => true);
  assert.deepEqual(r.tiers.map(x => x.id), ['basic', 'medium'], 'el grande no se ofrece');
  assert.equal(r.selected, 'qwen3.5:4b', 'no cae a Básico habiendo uno mayor que pasa');
  const none = offer(tiers, 'large', null, () => false);
  assert.deepEqual([none.tiers.length, none.selected], [0, null]);
});
