'use strict';
// Puerta de validación de modelos: un modelo que no pasa la prueba no se ofrece.
// La prueba, los umbrales y los correos de muestra viven en config/defaults.json → llm.validation.
// El resultado se guarda por modelo + digest de Ollama en <datos>/model-validation.json.
const llm = require('./llm');
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { t } = require('./i18n');

// Regla: TODO correo crítico ≤ criticalMax, al menos highRequired de las promociones claras ≥ highMin,
// y latencia media bajo maxAvgMs. results: [{ name, group, score, ms }] (score null = no se entendió)
function judge(results, V) {
  const crit = results.filter(r => r.group === 'critical');
  const high = results.filter(r => r.group === 'high');
  const criticalMiss = crit.filter(r => !(r.score != null && r.score <= V.criticalMax)).map(r => r.name);
  const highOk = high.filter(r => r.score != null && r.score >= V.highMin).length;
  const avgMs = results.length ? Math.round(results.reduce((a, r) => a + (r.ms || 0), 0) / results.length) : 0;
  const reasons = [];
  if (criticalMiss.length) reasons.push(t('llm.val.critical', { names: criticalMiss.join(', ') }));
  if (highOk < V.highRequired) reasons.push(t('llm.val.high', { n: highOk, m: high.length }));
  if (avgMs >= V.maxAvgMs) reasons.push(t('llm.val.slow', { ms: avgMs, max: V.maxAvgMs }));
  return { pass: reasons.length === 0, criticalMiss, highOk, avgMs, reasons };
}

const cancelled = () => Object.assign(new Error('cancelado'), { cancelled: true });

// Corre la prueba completa. opts: { onProgress({ i, n }), signal, generate }. Lanza si Ollama falla (no se guarda nada).
// -> { pass, reasons, avgMs, ..., think: { enabled, numPredict }, results, at }
async function validateModel(cfg, opts = {}) {
  const gen = opts.generate || llm.generate, signal = opts.signal;
  const V = cfg.llm.validation, L = cfg.llm;
  const check = () => { if (signal && signal.aborted) throw cancelled(); };
  const call = async (c, s, think) => {
    check();
    const r = await gen(c, llm.buildPrompt(c.llmPrompt, s), { think, signal });
    check();
    if (!r.ok) throw new Error(r.error);
    return r;
  };
  const n = V.samples.length;
  if (opts.onProgress) opts.onProgress({ i: 0, n });
  await call(cfg, { from: 'a <a@example.com>', subjects: ['hola'], bulk: false, body: 'hola' }, false); // carga el modelo: el arranque en frío no cuenta en la latencia
  const results = [];
  for (let i = 0; i < n; i++) {
    const s = V.samples[i];
    if (opts.onProgress) opts.onProgress({ i: i + 1, n });
    const t0 = Date.now();
    const r = await call(cfg, s, false);
    results.push({ name: s.name, group: s.group, score: llm.parseScore(r.text, null), ms: Date.now() - t0 });
  }
  // pensamiento, una vez y con un caso dudoso: si se corta con el presupuesto, se duplica una vez; si sigue cortado, se apaga
  const think = { enabled: false, numPredict: L.thinkNumPredict };
  if (L.think) {
    let budget = L.thinkNumPredict;
    for (let a = 0; a < 2; a++, budget *= 2) {
      const r = await call({ ...cfg, llm: { ...L, thinkNumPredict: budget } }, V.thinkSample, true);
      if (!r.truncated) { think.enabled = true; think.numPredict = budget; break; }
    }
  }
  return { ...judge(results, V), think, results, at: Date.now() };
}

// Resultados guardados: { [modelo]: { digest, ...resultado } }
class ValidationStore {
  constructor(file) { this.file = file; }
  _all() { return readJson(this.file, {}) || {}; }
  // sin digest: el último resultado del modelo (lo usa el motor); con digest: solo si es la misma versión del modelo
  get(model, digest) {
    const e = this._all()[model];
    if (!e) return null;
    return digest === undefined || e.digest === digest ? e : null;
  }
  set(model, digest, res) { const all = this._all(); all[model] = { ...res, digest }; writeJsonAtomic(this.file, all); }
}

// Config efectiva del motor para un modelo: pensar o no y con qué presupuesto, según lo que se midió.
// Un modelo que falló la prueba deja la IA apagada (solo heurística).
function applyModel(cfg, store) {
  const e = store && cfg.model ? store.get(cfg.model) : null;
  if (!e) return cfg;
  const llmCfg = { ...cfg.llm };
  if (e.think) { llmCfg.think = !!(llmCfg.think && e.think.enabled); if (e.think.enabled) llmCfg.thinkNumPredict = e.think.numPredict; }
  if (!e.pass) llmCfg.enabled = false;
  return { ...cfg, llm: llmCfg };
}

// Qué tiers se ofrecen y cuál queda marcado. verdict(tag) → true | false | null (sin validar).
// Se ocultan los que fallaron. Selección: el modelo en uso si ya está instalado y pasó; si no, el recomendado
// entre los que quedan (si el recomendado se ocultó, el más grande que no lo supere; si no hay, el más chico).
function offer(tiers, recommendedId, current, verdict, installed = () => false) {
  const visible = tiers.filter(x => verdict(x.tag) !== false);
  const cur = visible.find(x => x.tag === current);
  if (cur && installed(cur.tag) && verdict(cur.tag) === true) return { tiers: visible, selected: cur.tag };
  const bySize = [...visible].sort((a, b) => a.sizeBytes - b.sizeBytes);
  const rec = tiers.find(x => x.id === recommendedId);
  const pick = bySize.find(x => rec && x.id === rec.id)
    || [...bySize].reverse().find(x => rec && x.sizeBytes <= rec.sizeBytes) || bySize[0] || null;
  return { tiers: visible, selected: pick ? pick.tag : null };
}

module.exports = { judge, validateModel, ValidationStore, applyModel, offer };
