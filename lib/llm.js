'use strict';
// Ollama: puntaje de "ruido" 0-100 por correo, rápido (sin pensar) o pensando (para los dudosos).
const { pick } = require('./defaults');
const { t } = require('./i18n');

function base(url) { return String(url || '').replace(/\/+$/, ''); }

// { ok:true, text } | { ok:true, text:null } (respuesta vacía) | { ok:false, error }
async function generate(cfg, prompt, { think = false, timeoutMs } = {}) {
  const L = cfg.llm;
  const body = think
    ? { model: cfg.model, prompt, stream: false, think: true, options: { temperature: 0, num_predict: L.thinkNumPredict, num_ctx: L.thinkNumCtx } }
    : { model: cfg.model, prompt: prompt + '\n/no_think', stream: false, think: false, options: { temperature: 0, num_predict: 16, num_ctx: L.numCtx } };
  let j;
  try {
    const r = await fetch(`${base(cfg.ollamaUrl)}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || pick(cfg, think ? 'ollama.thinkTimeoutMs' : 'ollama.requestTimeoutMs')),
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return { ok: false, error: j.error || t('llm.http', { status: r.status }) };
  } catch (e) {
    return { ok: false, error: t('llm.down', { url: cfg.ollamaUrl, code: e.cause?.code || e.name }) };
  }
  // la respuesta final manda; el razonamiento menciona "Puntaje (0-100)" y otros números que no son el veredicto
  const resp = (j.response || '').trim();
  if (resp) return { ok: true, text: resp };
  if (think && j.done_reason === 'length') return { ok: true, text: null, truncated: true }; // se cortó pensando: no adivinar
  return { ok: true, text: think ? (j.thinking || null) : null };
}

function parseScore(txt, fallback) {
  if (txt == null) return fallback;
  // 1) número tras "respuesta/puntaje/score"
  let m = txt.match(/(?:respuesta|puntaje|puntuaci[oó]n|score)\s*[:=]?\s*\**\s*(\d{1,3})\b/i);
  if (m) { const n = +m[1]; if (n >= 0 && n <= 100) return n; }
  // 2) número en negrita **N**
  m = txt.match(/\*\*\s*(\d{1,3})\s*\*\*/);
  if (m) { const n = +m[1]; if (n >= 0 && n <= 100) return n; }
  // 3) limpiar "sobre 100 / de 100 / /100 / (0-100) / 0 a 100" y tomar el último número
  const t2 = txt.replace(/(sobre|de)\s*100/gi, ' ').replace(/\/\s*100/g, ' ').replace(/\b0\s*(-|a|to)\s*100\b/gi, ' ');
  const all = [...t2.matchAll(/\b(\d{1,3})\b/g)].map(x => +x[1]).filter(n => n >= 0 && n <= 100);
  return all.length ? all[all.length - 1] : fallback;
}

// El mismo cierre con o sin pensamiento: el razonamiento va en el canal de "thinking" del modelo.
// Pedir "razona" aquí contradice el "devolvé SOLO un número" del prompt base, y modelos como
// qwen3.5 se quedan discutiendo esa contradicción hasta agotar los tokens sin responder.
function buildPrompt(llmPrompt, { from, subjects, bulk, body }) {
  return `${llmPrompt}\n\nEmail:\nFROM: ${from}\nSUBJECT: ${(subjects || []).join(' | ')}\nBULK: ${bulk ? 'si' : 'no'}\nBODY: ${body || ''}\n\nPuntaje (0-100):`;
}

async function listModels(ollamaUrl, timeoutMs = pick({}, 'ollama.probeTimeoutMs')) {
  try {
    const r = await fetch(`${base(ollamaUrl)}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return { ok: true, models: (j.models || []).map(m => m.name).sort() };
  } catch (e) {
    return { ok: false, models: [], error: t('llm.downShort', { url: ollamaUrl }) };
  }
}

async function version(ollamaUrl, timeoutMs = pick({}, 'ollama.probeTimeoutMs')) {
  try {
    const r = await fetch(`${base(ollamaUrl)}/api/version`, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: true, version: (await r.json()).version };
  } catch (e) { return { ok: false, error: t('llm.downShort', { url: ollamaUrl }) }; }
}

const SAMPLES = [
  { name: 'promo', expect: 'alto', from: 'Tienda <promo@tienda.example>', subjects: ['¡90% OFF solo hoy! Ofertas relámpago'], bulk: true, body: 'Aprovecha descuentos increíbles. Compra ahora. Darse de baja aquí.' },
  { name: 'personal', expect: 'bajo', from: 'Carlos Pérez <carlos@example.com>', subjects: ['Re: reunión del jueves'], bulk: false, body: 'Hola, confirmo la reunión del jueves a las 10. ¿Llevas tú la propuesta impresa?' },
];
// Prueba el modelo con dos correos de ejemplo: la promoción debe puntuar más alto que el personal.
async function testModel(cfg) {
  const results = [];
  for (const s of SAMPLES) {
    const t0 = Date.now();
    const r = await generate(cfg, buildPrompt(cfg.llmPrompt, s), { timeoutMs: pick(cfg, 'ollama.testTimeoutMs') });
    if (!r.ok) return { ok: false, error: r.error, results };
    results.push({ name: t(`llm.sample.${s.name}`), expect: s.expect, raw: r.text, score: parseScore(r.text, null), ms: Date.now() - t0 });
  }
  const [promo, pers] = results;
  const ok = promo.score != null && pers.score != null && promo.score > pers.score;
  // pensamiento: se prueba con un caso dudoso de verdad (con uno fácil, los modelos que piensan de más igual responden)
  let think = null;
  if (cfg.llm.think) {
    const t0 = Date.now();
    const r = await generate(cfg, buildPrompt(cfg.llmPrompt, DOUBT_SAMPLE), { think: true, timeoutMs: pick(cfg, 'ollama.thinkTimeoutMs') });
    const ms = Date.now() - t0;
    think = !r.ok ? { ok: false, ms, error: r.error }
      : r.truncated ? { ok: false, ms, error: t('llm.thinkTruncated', { n: cfg.llm.thinkNumPredict }) }
      : { ok: true, ms, score: parseScore(r.text, null) };
  }
  return { ok, results, think, error: ok ? null : t('llm.cantTell') };
}
const DOUBT_SAMPLE = { from: 'Nube <billing@nube.example>', subjects: ['Tu factura se genera el 1 de octubre | Nuevo: servidores con GPU con 20% de descuento'], bulk: true, body: 'Hola, tu próxima factura se generará el 1 de octubre. Además, pruebe nuestros nuevos servidores con GPU con 20% de descuento el primer mes.' };

module.exports = { generate, parseScore, buildPrompt, listModels, version, testModel };
