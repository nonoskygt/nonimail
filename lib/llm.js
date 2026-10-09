'use strict';
// Ollama: puntaje de "ruido" 0-100 por correo, rápido (sin pensar) o pensando (para los dudosos).

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
      signal: AbortSignal.timeout(timeoutMs || (think ? 300000 : 120000)),
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return { ok: false, error: j.error || `Ollama respondió HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: `Ollama no responde en ${cfg.ollamaUrl} (${e.cause?.code || e.name})` };
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

function buildPrompt(llmPrompt, { from, subjects, bulk, body }, think = false) {
  const tail = think ? 'Razona brevemente y termina con el Puntaje (0-100):' : 'Puntaje (0-100):';
  return `${llmPrompt}\n\nEmail:\nFROM: ${from}\nSUBJECT: ${(subjects || []).join(' | ')}\nBULK: ${bulk ? 'si' : 'no'}\nBODY: ${body || ''}\n\n${tail}`;
}

async function listModels(ollamaUrl) {
  try {
    const r = await fetch(`${base(ollamaUrl)}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return { ok: true, models: (j.models || []).map(m => m.name).sort() };
  } catch (e) {
    return { ok: false, models: [], error: `Ollama no responde en ${ollamaUrl}` };
  }
}

async function version(ollamaUrl) {
  try {
    const r = await fetch(`${base(ollamaUrl)}/api/version`, { signal: AbortSignal.timeout(5000) });
    return { ok: true, version: (await r.json()).version };
  } catch (e) { return { ok: false, error: `Ollama no responde en ${ollamaUrl}` }; }
}

const SAMPLES = [
  { name: 'promoción', expect: 'alto', from: 'Tienda <promo@tienda.example>', subjects: ['¡90% OFF solo hoy! Ofertas relámpago'], bulk: true, body: 'Aprovecha descuentos increíbles. Compra ahora. Darse de baja aquí.' },
  { name: 'personal', expect: 'bajo', from: 'Carlos Pérez <carlos@example.com>', subjects: ['Re: reunión del jueves'], bulk: false, body: 'Hola, confirmo la reunión del jueves a las 10. ¿Llevas tú la propuesta impresa?' },
];
// Prueba el modelo con dos correos de ejemplo: la promoción debe puntuar más alto que el personal.
async function testModel(cfg) {
  const results = [];
  for (const s of SAMPLES) {
    const t = Date.now();
    const r = await generate(cfg, buildPrompt(cfg.llmPrompt, s), { timeoutMs: 180000 });
    if (!r.ok) return { ok: false, error: r.error, results };
    results.push({ name: s.name, expect: s.expect, raw: r.text, score: parseScore(r.text, null), ms: Date.now() - t });
  }
  const [promo, pers] = results;
  const ok = promo.score != null && pers.score != null && promo.score > pers.score;
  return { ok, results, error: ok ? null : 'el modelo no distinguió la promoción del correo personal' };
}

module.exports = { generate, parseScore, buildPrompt, listModels, version, testModel };
