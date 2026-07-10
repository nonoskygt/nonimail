// NoniMail Limpieza - app web local
// Backend Node (sin deps): motor heuristica+LLM, reglas por remitente persistentes,
// escaneo de remitentes en streaming, unsubscribe, HTTP + SSE.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
let RX_SUBJ, RX_FROM, RX_BODY, RX_KEEP;
function recompileRules() {
  RX_SUBJ = new RegExp(CFG.heuristics.subject, 'i');
  RX_FROM = new RegExp(CFG.heuristics.from, 'i');
  RX_BODY = new RegExp(CFG.heuristics.body, 'i');
  RX_KEEP = CFG.heuristics.keepOverride ? new RegExp(CFG.heuristics.keepOverride, 'i') : null;
}
recompileRules();
function saveConfig() { fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(CFG, null, 2), 'utf8'); }

// ---------- reglas por remitente persistentes ----------
const SENDERS_FILE = path.join(__dirname, 'senders.json');
let SENDERS = { rules: {}, unsub: {} }; // rules: email->'delete'|'protect'  unsub: email->true
try { if (fs.existsSync(SENDERS_FILE)) SENDERS = JSON.parse(fs.readFileSync(SENDERS_FILE, 'utf8')); } catch (_) {}
if (!SENDERS.rules) SENDERS.rules = {};
if (!SENDERS.unsub) SENDERS.unsub = {};
function saveSenders() { fs.writeFileSync(SENDERS_FILE, JSON.stringify(SENDERS, null, 2), 'utf8'); }

// ---------- estado ----------
const state = {
  running: false, scanning: false, dryRun: false,
  query: CFG.defaults.query, batchSize: CFG.defaults.batchSize, concurrency: CFG.defaults.concurrency,
  startedAt: null,
  stats: { heurSeen: 0, heurDel: 0, llmSeen: 0, llmDel: 0, llmKept: 0, cursor: 0, batch: 0 },
  abort: false, abortScan: false,
};
let logStream = null;

// ---------- SSE ----------
const clients = new Set();
function sse(obj) { const data = `data: ${JSON.stringify(obj)}\n\n`; for (const res of clients) { try { res.write(data); } catch (_) {} } }
function emit(lane, text, kind) {
  const ev = { t: 'line', lane, text, kind, ts: new Date().toISOString().slice(11, 19) };
  sse(ev);
  if (logStream) { try { logStream.write(`[${ev.ts}][${lane}][${kind}] ${text}\n`); } catch (_) {} }
}
function emitStats() { sse({ t: 'stats', stats: state.stats, running: state.running, scanning: state.scanning }); }
function emitSender(s) { sse({ t: 'sender', sender: s }); }

// ---------- métricas CPU/GPU en vivo ----------
let _lastCpu = os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
function cpuPercent() {
  const now = os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  let idleD = 0, totalD = 0;
  for (let i = 0; i < now.length; i++) { idleD += now[i].idle - _lastCpu[i].idle; totalD += now[i].total - _lastCpu[i].total; }
  _lastCpu = now;
  return totalD > 0 ? Math.round(100 * (1 - idleD / totalD)) : 0;
}
function gpuQuery() {
  return new Promise(res => {
    execFile('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000 }, (err, out) => {
      if (err || !out) return res(null);
      const p = out.trim().split('\n')[0].split(',').map(x => parseInt(x.trim()));
      res({ util: p[0] || 0, vramUsed: p[1] || 0, vramTotal: p[2] || 0 });
    });
  });
}
async function metricsTick() {
  const cpu = cpuPercent();
  const gpu = await gpuQuery();
  sse({ t: 'metrics', cpu, gpu });
}
setInterval(() => { metricsTick().catch(() => {}); }, 2500);

// ---------- HTTP helpers ----------
async function bridge(payload) {
  payload.key = CFG.gmailKey;
  try {
    const r = await fetch(CFG.gmailBridge, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    if (j.status !== 'ok') return { ok: false, error: j.error, data: null };
    return { ok: true, data: j.data };
  } catch (e) { return { ok: false, error: String(e), data: null }; }
}
async function ollama(prompt) {
  try {
    const r = await fetch(`${CFG.ollamaUrl}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CFG.model, prompt: prompt + '\n/no_think', stream: false, think: false, options: { temperature: 0, num_predict: 16, num_ctx: 4096 } }),
      signal: AbortSignal.timeout(120000) });
    const j = await r.json(); return j.response || null;
  } catch (e) { return null; }
}
// con pensamiento: razona antes de responder (para casos dudosos). Mas lento, mas preciso.
async function ollamaThink(prompt) {
  try {
    const r = await fetch(`${CFG.ollamaUrl}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CFG.model, prompt, stream: false, think: true, options: { temperature: 0, num_predict: 800, num_ctx: 8192 } }),
      signal: AbortSignal.timeout(180000) });
    const j = await r.json();
    return (j.response || '') + ' ' + (j.thinking || '');
  } catch (e) { return null; }
}
function parseScore(txt, fallback) {
  if (txt == null) return fallback;
  // 1) número tras "respuesta/puntaje/score"
  let m = txt.match(/(?:respuesta|puntaje|puntuaci[oó]n|score)\D{0,8}(\d{1,3})/i);
  if (m) { const n = +m[1]; if (n >= 0 && n <= 100) return n; }
  // 2) número en negrita **N**
  m = txt.match(/\*\*\s*(\d{1,3})\s*\*\*/);
  if (m) { const n = +m[1]; if (n >= 0 && n <= 100) return n; }
  // 3) limpiar "sobre 100 / de 100 / /100 / 0-100 / 0 a 100" y tomar el último número
  const t2 = txt.replace(/(sobre|de)\s*100/gi, ' ').replace(/\/\s*100/g, ' ').replace(/0\s*[-a]\s*100/gi, ' ');
  const all = [...t2.matchAll(/\b(\d{1,3})\b/g)].map(x => +x[1]).filter(n => n >= 0 && n <= 100);
  return all.length ? all[all.length - 1] : fallback;
}
function shortSubj(s, n = 55) { s = s || '(sin asunto)'; return s.length > n ? s.slice(0, n) + '...' : s; }
function parseFrom(from) {
  if (!from) return { email: '(desconocido)', name: '' };
  const m = from.match(/<([^>]+)>/);
  const email = (m ? m[1] : from).trim().toLowerCase();
  let name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  if (!name) name = email;
  return { email, name };
}
async function pMap(items, fn, concurrency, abortKey) {
  const out = new Array(items.length); let idx = 0;
  async function lane() { while (idx < items.length && !state[abortKey]) { const i = idx++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return out;
}

// ---------- PROTECCIÓN DE CADENAS / CONVERSACIONES (NUNCA borrar) ----------
// Una "cadena" = el usuario participó (respondió) en el hilo, o hay 2+ participantes distintos.
const MY_ADDR = new Set((CFG.myAddresses || []).map(a => String(a).trim().toLowerCase()));
function isConversation(messages) {
  if (!CFG.protectConversations) return false;
  if (!messages || messages.length < 2) return false;
  const senders = new Set();
  for (const m of messages) {
    const { email } = parseFrom(m.from || m.sender || '');
    if (MY_ADDR.has(email)) return true;                 // yo respondí => conversación real
    if (email && email !== '(desconocido)') senders.add(email);
  }
  return senders.size >= 2;                               // ida y vuelta entre 2+ remitentes
}
// guarda: ¿es una cadena que NO se debe borrar? Lee el hilo si no se pasaron los mensajes.
async function isChain(tid, messages) {
  if (!CFG.protectConversations) return false;
  let msgs = messages;
  if (!msgs) { const f = await bridge({ action: 'read_thread', threadId: tid }); msgs = (f.ok && f.data && f.data.messages) || null; }
  return isConversation(msgs);
}

// ¿protegido? rule 'protect' o regex keepOverride; rule 'delete' DESPROTEGE
function isProtected(email, subject, from) {
  if (SENDERS.rules[email] === 'delete') return false;
  if (SENDERS.rules[email] === 'protect') return true;
  if (RX_KEEP && (RX_KEEP.test(subject || '') || RX_KEEP.test(from || ''))) return true;
  return false;
}

// ---------- clasificacion (lane workers) ----------
async function classifyAndAct(thread) {
  const tid = thread.id;
  const subj = thread.subject || '(sin asunto)';
  emit('llm', `read ${shortSubj(subj)}`, 'info');
  let from = '', body = '';
  const full = await bridge({ action: 'read_thread', threadId: tid });
  const msgs = (full.ok && full.data && full.data.messages) || null;
  if (msgs && msgs.length) {
    const m = msgs[0]; from = m.from || ''; body = m.plainBody || m.body || '';
  }
  const { email } = parseFrom(from);

  // 0) CADENA / conversación => NUNCA borrar (gana sobre toda regla)
  if (isConversation(msgs)) { emit('llm', `KEEP (cadena protegida): ${shortSubj(subj)}`, 'keep'); state.stats.llmSeen++; state.stats.llmKept++; return { kept: true }; }
  // 1) regla persistente por remitente
  if (SENDERS.rules[email] === 'protect') { emit('llm', `KEEP (regla-remitente): ${shortSubj(subj)}`, 'keep'); state.stats.llmSeen++; state.stats.llmKept++; return { kept: true }; }
  if (SENDERS.rules[email] === 'delete') return await doTrash(tid, subj, 'regla-remitente', msgs);
  // 2) proteccion financiera (si no fue desprotegido arriba)
  if (RX_KEEP && (RX_KEEP.test(subj) || RX_KEEP.test(from) || RX_KEEP.test(body))) { emit('llm', `KEEP (protegido-financiero): ${shortSubj(subj)}`, 'keep'); state.stats.llmSeen++; state.stats.llmKept++; return { kept: true }; }
  // 3) heuristica from/body
  if (RX_FROM.test(from)) return await doTrash(tid, subj, 'heur-from', msgs);
  if (RX_BODY.test(body)) return await doTrash(tid, subj, 'heur-body', msgs);
  // 4) LLM
  let b = body.replace(/[\r\n\t]+/g, ' '); if (b.length > CFG.defaults.bodyMaxChars) b = b.slice(0, CFG.defaults.bodyMaxChars);
  const prompt = `${CFG.llmPrompt}\n\nEmail:\nFROM: ${from}\nSUBJECT: ${subj}\nBODY: ${b}\n\nRespuesta:`;
  const resp = await ollama(prompt);
  let verdict = 'KEEP', reason = 'llm';
  if (resp == null) { reason = 'llm-null'; }
  else { const clean = resp.replace(/[^A-Za-z]/g, '').toUpperCase(); if (clean.includes('PROMO')) verdict = 'PROMO'; else if (!clean.includes('KEEP')) reason = 'llm-ambig'; }
  if (verdict === 'PROMO') return await doTrash(tid, subj, reason, msgs);
  emit('llm', `KEEP (${reason}): ${shortSubj(subj)}`, 'keep'); state.stats.llmSeen++; state.stats.llmKept++; return { kept: true };
}
async function doTrash(tid, subj, reason, messages) {
  if (await isChain(tid, messages)) { emit('llm', `KEEP (cadena protegida): ${shortSubj(subj)}`, 'keep'); state.stats.llmSeen++; state.stats.llmKept++; return { kept: true }; }
  state.stats.llmSeen++;
  if (state.dryRun) { emit('llm', `[DRY] PROMO (${reason}): ${shortSubj(subj)}`, 'dry'); state.stats.llmDel++; return { kept: false }; }
  const tr = await bridge({ action: 'move_to_trash', threadId: tid });
  if (tr.ok) { emit('llm', `BORRADO (${reason}): ${shortSubj(subj)}`, 'delete'); state.stats.llmDel++; return { kept: false }; }
  emit('llm', `ERR trash: ${shortSubj(subj)}`, 'err'); state.stats.llmKept++; return { kept: true };
}

async function runPool(items, worker, concurrency) {
  let idx = 0, kept = 0;
  async function lane() { while (idx < items.length && !state.abort) { const r = await worker(items[idx++]); if (r && r.kept) kept++; } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return kept;
}

// ---------- limpieza completa ----------
async function runEngine() {
  state.running = true; state.abort = false; state.startedAt = Date.now();
  state.stats = { heurSeen: 0, heurDel: 0, llmSeen: 0, llmDel: 0, llmKept: 0, cursor: 0, batch: 0 };
  const tsName = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try { logStream = fs.createWriteStream(path.join(__dirname, 'logs', `run-${tsName}.log`), { flags: 'a' }); }
  catch (_) { try { fs.mkdirSync(path.join(__dirname, 'logs')); logStream = fs.createWriteStream(path.join(__dirname, 'logs', `run-${tsName}.log`), { flags: 'a' }); } catch (e) {} }
  emit('sys', `Limpieza. query="${state.query}" batch=${state.batchSize} conc=${state.concurrency} dryRun=${state.dryRun}`, 'info');
  emit('llm', `Calentando Ollama (${CFG.model})...`, 'info');
  if (await ollama('ok') == null) { emit('sys', 'ERROR: Ollama no responde', 'err'); state.running = false; emitStats(); return; }
  emit('llm', 'Ollama listo', 'info');

  const seen = new Set(); let cursor = 0, emptyCount = 0, allSeen = 0;
  for (let b = 1; b <= CFG.defaults.maxBatches && !state.abort; b++) {
    state.stats.batch = b; state.stats.cursor = cursor;
    const data = await bridge({ action: 'search', query: state.query, limit: state.batchSize, start: cursor });
    if (!data.ok) { emit('sys', `Search fallo: ${data.error}`, 'err'); break; }
    const threads = (data.data && data.data.threads) || [];
    if (threads.length === 0) { emptyCount++; emit('sys', `Batch ${b} vacio (${emptyCount}/${CFG.defaults.stopAfterEmpty})`, 'info'); if (emptyCount >= CFG.defaults.stopAfterEmpty) { emit('sys', `Fin de inbox cursor=${cursor}`, 'info'); break; } await new Promise(r => setTimeout(r, 500)); continue; }
    emptyCount = 0;
    const fresh = threads.filter(t => !seen.has(t.id));
    if (fresh.length === 0) { allSeen++; if (allSeen >= 3) { cursor += threads.length; allSeen = 0; } else await new Promise(r => setTimeout(r, 800)); continue; }
    allSeen = 0;
    emit('sys', `Batch ${b} cursor=${cursor}: ${threads.length} (${fresh.length} nuevos)`, 'info');
    const heurMatches = []; const needsLLM = []; let protectedKept = 0;
    for (const t of fresh) {
      seen.add(t.id); state.stats.heurSeen++;
      const subj = t.subject || '';
      // proteccion por asunto (financiero) o por nada aun (sin from); reglas-remitente se aplican en classifyAndAct
      if (RX_KEEP && RX_KEEP.test(subj) && SENDERS.rules['__'] !== 'x') { emit('heur', `KEEP (protegido): ${shortSubj(subj)}`, 'keep'); state.stats.llmKept++; protectedKept++; }
      else if (RX_SUBJ.test(subj)) heurMatches.push(t);
      else needsLLM.push(t);
    }
    if (heurMatches.length) {
      await Promise.all(heurMatches.map(async (t) => {
        const ss = shortSubj(t.subject);
        if (await isChain(t.id)) { emit('heur', `KEEP (cadena protegida): ${ss}`, 'keep'); state.stats.llmKept++; return; }
        if (state.dryRun) { emit('heur', `[DRY] HEUR: ${ss}`, 'dry'); state.stats.heurDel++; return; }
        const tr = await bridge({ action: 'move_to_trash', threadId: t.id });
        if (tr.ok) { emit('heur', `BORRADO: ${ss}`, 'delete'); state.stats.heurDel++; } else emit('heur', `ERR: ${ss}`, 'err');
      }));
    }
    emitStats();
    let kept = 0; if (needsLLM.length) kept = await runPool(needsLLM, classifyAndAct, state.concurrency);
    cursor += kept + protectedKept; emitStats();
  }
  const secs = ((Date.now() - state.startedAt) / 1000).toFixed(1); const s = state.stats;
  emit('sys', `FIN. Borrados=${s.heurDel + s.llmDel} Conservados=${s.llmKept} Revisados=${s.heurSeen} Tiempo=${secs}s${state.dryRun ? ' [DRY]' : ''}`, 'info');
  state.running = false; if (logStream) { try { logStream.end(); } catch (_) {} logStream = null; } emitStats();
}

// ---------- escaneo de remitentes (streaming) ----------
async function scanSenders(query, sampleSize) {
  state.scanning = true; state.abortScan = false; emitStats();
  sse({ t: 'scanstart' });
  emit('sys', `Escaneando remitentes (muestra ${sampleSize})...`, 'info');
  const items = []; let cursor = 0; const seenId = new Set();
  while (items.length < sampleSize && !state.abortScan) {
    const d = await bridge({ action: 'search', query, limit: 50, start: cursor });
    if (!d.ok) break;
    const th = (d.data && d.data.threads) || []; if (th.length === 0) break;
    for (const t of th) if (!seenId.has(t.id)) { seenId.add(t.id); items.push(t); }
    cursor += th.length; if (th.length < 50) break;
  }
  const sample = items.slice(0, sampleSize);
  const groups = new Map();
  let doneN = 0;
  function pushSender(g) {
    emitSender({
      email: g.email, name: g.name, count: g.count, samples: g.samples,
      canUnsub: g.canUnsub, unsubDone: !!SENDERS.unsub[g.email],
      protected: g.prot, rule: SENDERS.rules[g.email] || null,
      score: g.score, reason: g.reason,
    });
  }

  // ===== FASE 1: leer + agrupar + heurística (CPU, paralelo 16) =====
  await pMap(sample, async (t) => {
    if (state.abortScan) return;
    sse({ t: 'scanline', text: `leyendo: ${shortSubj(t.subject || '', 45)}`, ts: new Date().toISOString().slice(11, 19) });
    const full = await bridge({ action: 'read_thread', threadId: t.id, includeHeaders: true });
    let from = '', lu = '', body = '';
    if (full.ok && full.data && full.data.messages && full.data.messages.length) {
      const m = full.data.messages[0]; from = m.from || ''; lu = m.listUnsubscribe || ''; body = m.plainBody || m.body || '';
    }
    const { email, name } = parseFrom(from);
    let g = groups.get(email);
    const isNew = !g;
    if (isNew) { g = { email, name, count: 0, samples: [], canUnsub: false, from, body, verdict: null, reason: null, prot: false }; groups.set(email, g); }
    g.count++;
    if (lu) g.canUnsub = true;
    if (g.samples.length < 3) g.samples.push(shortSubj(t.subject || '', 48));
    if (isNew) {
      g.prot = isProtected(email, t.subject || '', from);
      g.score = null;
      // El heurístico SOLO protege (seguridad). Reglas del usuario mandan. Lo demás → LLM (puntaje).
      if (g.prot) { g.score = 0; g.reason = 'protegido'; }
      else if (SENDERS.rules[email] === 'protect') { g.score = 0; g.reason = 'regla-usuario'; }
      else if (SENDERS.rules[email] === 'delete') { g.score = 100; g.reason = 'regla-usuario'; }
      else { g.score = null; g.reason = 'pendiente-llm'; }
      emit('heur', `${g.score === 0 ? '✓ protegido' : g.score === 100 ? '🗑️ regla' : '→ LLM'}: ${name.slice(0, 34)}`, g.score === 100 ? 'delete' : g.score === 0 ? 'keep' : 'info');
    }
    doneN++;
    sse({ t: 'scanline', text: `(${doneN}/${sample.length}) ${name.slice(0, 26)} ×${g.count}`, ts: new Date().toISOString().slice(11, 19) });
    pushSender(g);
  }, 16, 'abortScan');

  // ===== FASE 2: LLM puntúa los pendientes 0-100 (GPU, paralelo 4) =====
  const undecided = [...groups.values()].filter(g => g.score == null);
  if (undecided.length && !state.abortScan) {
    emit('sys', `LLM puntuando ${undecided.length} remitentes (0-100)...`, 'info');
    await pMap(undecided, async (g) => {
      if (state.abortScan) return;
      emit('llm', `🔍 analizando ${g.name.slice(0, 30)} — "${(g.samples[0]||'').slice(0,38)}"`, 'info');
      let b = (g.body || '').replace(/[\r\n\t]+/g, ' '); if (b.length > CFG.defaults.bodyMaxChars) b = b.slice(0, CFG.defaults.bodyMaxChars);
      const prompt = `${CFG.llmPrompt}\n\nEmail:\nFROM: ${g.from}\nSUBJECT: ${g.samples.join(' | ')}\nBULK: ${g.canUnsub ? 'si' : 'no'}\nBODY: ${b}\n\nPuntaje (0-100):`;
      const resp = await ollama(prompt);
      const sc = parseScore(resp, 50);
      g.score = sc; g.reason = 'llm';
      emit('llm', `ruido=${sc} → ${g.name.slice(0, 32)}`, sc >= 60 ? 'delete' : sc <= 40 ? 'keep' : 'dry');
      pushSender(g);
    }, 4, 'abortScan');
  }

  // ===== FASE 3: re-evaluar DUDOSOS con pensamiento (GPU, paralelo 2) =====
  const doubtful = [...groups.values()].filter(g => g.reason === 'llm' && g.score >= 35 && g.score <= 65);
  if (doubtful.length && !state.abortScan) {
    emit('sys', `🧠 Pensando ${doubtful.length} dudosos (razonamiento profundo)...`, 'info');
    await pMap(doubtful, async (g) => {
      if (state.abortScan) return;
      emit('llm', `🧠 razonando ${g.name.slice(0, 30)} (score prev ${g.score})...`, 'info');
      let b = (g.body || '').replace(/[\r\n\t]+/g, ' '); if (b.length > CFG.defaults.bodyMaxChars) b = b.slice(0, CFG.defaults.bodyMaxChars);
      const prompt = `${CFG.llmPrompt}\n\nEmail:\nFROM: ${g.from}\nSUBJECT: ${g.samples.join(' | ')}\nBULK: ${g.canUnsub ? 'si' : 'no'}\nBODY: ${b}\n\nRazona brevemente y termina con el Puntaje (0-100):`;
      const resp = await ollamaThink(prompt);
      const sc = parseScore(resp, g.score);
      const prev = g.score; g.score = sc; g.reason = 'llm-think';
      emit('llm', `🧠 ruido=${sc} (era ${prev}) → ${g.name.slice(0, 30)}`, sc >= 60 ? 'delete' : sc <= 40 ? 'keep' : 'dry');
      pushSender(g);
    }, 2, 'abortScan');
  }

  emit('sys', `Escaneo+puntaje listo: ${groups.size} remitentes en ${sample.length} correos`, 'info');
  sse({ t: 'scandone', total: groups.size, sampled: sample.length });
  state.scanning = false; emitStats();
}

// ---------- borrar todos de un remitente (core, sin tocar state.running) ----------
async function trashSenderCore(email, dryRun) {
  let deleted = 0, kept = 0;
  let cursor = 0, empty = 0; const seen = new Set();
  const q = `in:inbox from:${email}`;
  while (!state.abort) {
    const d = await bridge({ action: 'search', query: q, limit: 50, start: cursor });
    if (!d.ok) break;
    const th = (d.data && d.data.threads) || [];
    const fresh = th.filter(t => !seen.has(t.id));
    if (fresh.length === 0) { empty++; if (empty >= 2) break; cursor = 0; await new Promise(r => setTimeout(r, 400)); continue; }
    empty = 0;
    for (const t of fresh) seen.add(t.id);
    const res = await pMap(fresh, async (t) => {
      const subj = t.subject || '';
      if (await isChain(t.id)) { emit('heur', `KEEP (cadena protegida): ${shortSubj(subj)}`, 'keep'); return 'kept'; }
      if (SENDERS.rules[email] !== 'delete' && RX_KEEP && RX_KEEP.test(subj)) { emit('heur', `KEEP (protegido): ${shortSubj(subj)}`, 'keep'); return 'kept'; }
      if (dryRun) { emit('heur', `[DRY] borraria: ${shortSubj(subj)}`, 'dry'); return 'del'; }
      const tr = await bridge({ action: 'move_to_trash', threadId: t.id });
      if (tr.ok) { emit('heur', `BORRADO: ${shortSubj(subj)}`, 'delete'); return 'del'; }
      emit('heur', `ERR: ${shortSubj(subj)}`, 'err'); return 'kept';
    }, 8, 'abort');
    for (const r of res) { if (r === 'del') deleted++; else kept++; }
    cursor += kept;
  }
  return { deleted, kept };
}
async function trashSender(email, dryRun) {
  state.running = true; state.abort = false; emitStats();
  emit('sys', `Borrado por remitente: ${email}${dryRun ? ' [DRY]' : ''}`, 'info');
  const r = await trashSenderCore(email, dryRun);
  emit('sys', `Remitente ${email}: borrados=${r.deleted} protegidos=${r.kept}`, 'info');
  state.running = false; emitStats();
  return r;
}

// ---------- PASO 2: Ejecutar (borra los remitentes marcados promo) ----------
async function executeDeletes(emails, dryRun) {
  state.running = true; state.abort = false; emitStats();
  emit('sys', `EJECUTAR: ${emails.length} remitentes a borrar${dryRun ? ' [DRY]' : ''}`, 'info');
  let totalDel = 0, n = 0;
  for (const email of emails) {
    if (state.abort) { emit('sys', 'Detenido por el usuario', 'warn'); break; }
    n++;
    emit('sys', `(${n}/${emails.length}) borrando ${email}...`, 'info');
    const r = await trashSenderCore(email, dryRun);
    totalDel += r.deleted;
  }
  emit('sys', `EJECUCIÓN LISTA. Borrados=${totalDel} de ${n} remitentes${dryRun ? ' [DRY]' : ''}`, 'info');
  state.running = false; emitStats();
  return totalDel;
}

// ---------- AUTO: limpiar toda la bandeja de corrido (scan+clasif+borrar) ----------
async function autoRun(query, dureza, dryRun, autoUnsub) {
  state.running = true; state.abort = false; emitStats();
  state.stats = { heurSeen: 0, heurDel: 0, llmSeen: 0, llmDel: 0, llmKept: 0, cursor: 0, batch: 0 };
  const T = 100 - dureza, BAND = 12;             // borra solo promo CLARO (score >= T+BAND); duda/keep se conservan
  const tsName = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  try { logStream = fs.createWriteStream(path.join(__dirname, 'logs', `auto-${tsName}.log`), { flags: 'a' }); } catch (_) {}
  emit('sys', `AUTO LIMPIEZA: "${query}" dureza=${dureza} (borra score>=${T + BAND}) paralelo=30${autoUnsub ? ' +BAJA-AUTO' : ''}${dryRun ? ' [DRY]' : ''}`, 'info');
  if (await ollama('ok') == null) { emit('sys', 'ERROR: Ollama no responde', 'err'); state.running = false; if (logStream) { logStream.end(); logStream = null; } emitStats(); return; }

  const senderCache = new Map(); // email -> {score, decision}
  const seen = new Set();
  let cursor = 0, empty = 0, allSeen = 0, totalDel = 0, totalKept = 0;

  for (let b = 1; b <= 2000 && !state.abort; b++) {
    state.stats.batch = b; state.stats.cursor = cursor;
    const data = await bridge({ action: 'search', query, limit: 50, start: cursor });
    if (!data.ok) { emit('sys', `Search fallo: ${data.error}`, 'err'); break; }
    const threads = (data.data && data.data.threads) || [];
    if (threads.length === 0) { empty++; if (empty >= 2) { emit('sys', `Fin de bandeja cursor=${cursor}`, 'info'); break; } await new Promise(r => setTimeout(r, 400)); continue; }
    empty = 0;
    const fresh = threads.filter(t => !seen.has(t.id));
    if (fresh.length === 0) { allSeen++; if (allSeen >= 3) { cursor += threads.length; allSeen = 0; } else await new Promise(r => setTimeout(r, 600)); continue; }
    allSeen = 0;
    for (const t of fresh) seen.add(t.id);
    emit('heur', `Batch ${b} cursor=${cursor}: ${fresh.length} correos`, 'info');

    // procesar el batch en paralelo (pool 6): clasificar remitente (cache) + borrar si promo claro
    const res = await pMap(fresh, async (t) => {
      state.stats.heurSeen++;
      // lectura LIVIANA (sin getRawContent) para ahorrar cuota de Gmail en la pasada completa
      const full = await bridge({ action: 'read_thread', threadId: t.id, includeHeaders: false });
      let from = '', body = '';
      const msgs = (full.ok && full.data && full.data.messages) || null;
      if (msgs && msgs.length) { const m = msgs[0]; from = m.from || ''; body = m.plainBody || m.body || ''; }
      const { email, name } = parseFrom(from);
      // CADENA / conversación => NUNCA borrar
      if (isConversation(msgs)) { emit('heur', `✓ cadena protegida: ${shortSubj(t.subject, 42)}`, 'keep'); return 'kept'; }
      let dec = senderCache.get(email);
      if (!dec) {
        // clasificar remitente una vez
        let score, reason;
        if (isProtected(email, t.subject || '', from)) { score = 0; reason = 'protegido'; }
        else if (SENDERS.rules[email] === 'protect') { score = 0; reason = 'regla'; }
        else if (SENDERS.rules[email] === 'delete') { score = 100; reason = 'regla'; }
        else {
          let bb = body.replace(/[\r\n\t]+/g, ' '); if (bb.length > CFG.defaults.bodyMaxChars) bb = bb.slice(0, CFG.defaults.bodyMaxChars);
          const prompt = `${CFG.llmPrompt}\n\nEmail:\nFROM: ${from}\nSUBJECT: ${t.subject || ''}\nBODY: ${bb}\n\nPuntaje (0-100):`;
          score = parseScore(await ollama(prompt), 50); reason = 'llm';
          emit('llm', `ruido=${score} → ${name.slice(0, 30)}`, score >= 60 ? 'delete' : score <= 40 ? 'keep' : 'dry');
        }
        dec = { score, decision: score >= T + BAND ? 'delete' : 'keep' };
        senderCache.set(email, dec);
        // BAJA AUTOMÁTICA: si lo descartamos, intentar baja (lectura pesada SOLO acá, 1 vez por remitente)
        if (autoUnsub && dec.decision === 'delete' && !dryRun && !SENDERS.unsub[email]) {
          emit('llm', `✉️ verificando baja de ${name.slice(0, 26)}...`, 'info');
          const ur = await unsubscribeSender(email);
          if (ur.ok) emit('heur', `✉️ baja OK (${ur.method}): ${name.slice(0, 24)}`, 'keep');
        }
      }
      if (dec.decision === 'delete') {
        if (dryRun) { emit('heur', `[DRY] borraría (${dec.score}) ${name.slice(0,20)}: ${shortSubj(t.subject, 38)}`, 'dry'); return 'del'; }
        const tr = await bridge({ action: 'move_to_trash', threadId: t.id });
        if (tr.ok) { emit('heur', `🗑️ (${dec.score}) ${shortSubj(t.subject, 42)}`, 'delete'); return 'del'; }
        emit('heur', `ERR: ${shortSubj(t.subject)}`, 'err'); return 'kept';
      }
      emit('heur', `✓ (${dec.score}${dec.score===0?'·prot':''}) ${shortSubj(t.subject, 42)}`, 'keep'); // mostrar conservados tambien
      return 'kept';
    }, 30, 'abort');

    let kept = 0; for (const r of res) { if (r === 'del') { totalDel++; state.stats.heurDel++; } else { kept++; totalKept++; state.stats.llmKept++; } }
    cursor += kept;
    emitStats();
  }
  emit('sys', `AUTO LISTO. Borrados=${totalDel} Conservados=${totalKept} Remitentes clasificados=${senderCache.size}${dryRun ? ' [DRY]' : ''}`, 'info');
  state.running = false; if (logStream) { try { logStream.end(); } catch (_) {} logStream = null; } emitStats();
}

// ---------- unsubscribe ----------
// core: ejecuta la baja dados los headers (sin re-fetch)
async function doUnsub(email, lu, luPost) {
  if (!lu) return { ok: false, error: 'sin List-Unsubscribe' };
  const urls = [...lu.matchAll(/<([^>]+)>/g)].map(x => x[1].trim());
  const https = urls.find(u => /^https?:/i.test(u));
  const mailto = urls.find(u => /^mailto:/i.test(u));
  try {
    if (https && /one-?click/i.test(luPost || '')) {
      const r = await fetch(https, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', signal: AbortSignal.timeout(20000) });
      SENDERS.unsub[email] = true; saveSenders();
      return { ok: true, method: 'one-click POST', status: r.status };
    }
    if (mailto) {
      const addr = mailto.replace(/^mailto:/i, '').split('?')[0];
      const r = await bridge({ action: 'send_email', to: addr, subject: 'unsubscribe', body: 'Please unsubscribe me. Solicito baja.' });
      if (r.ok) { SENDERS.unsub[email] = true; saveSenders(); return { ok: true, method: 'mailto', to: addr }; }
      return { ok: false, error: 'fallo envio mailto: ' + r.error };
    }
    if (https) {
      const r = await fetch(https, { method: 'GET', signal: AbortSignal.timeout(20000) });
      SENDERS.unsub[email] = true; saveSenders();
      return { ok: true, method: 'GET', status: r.status };
    }
    return { ok: false, error: 'header sin url/mailto utilizable' };
  } catch (e) { return { ok: false, error: String(e) }; }
}
// wrapper: busca un correo del remitente, lee el header y ejecuta la baja
async function unsubscribeSender(email) {
  const d = await bridge({ action: 'search', query: `from:${email}`, limit: 1, start: 0 });
  if (!d.ok || !d.data.threads || !d.data.threads.length) return { ok: false, error: 'sin correos del remitente' };
  const full = await bridge({ action: 'read_thread', threadId: d.data.threads[0].id, includeHeaders: true });
  const m = full.ok && full.data.messages && full.data.messages[0];
  if (!m || !m.listUnsubscribe) return { ok: false, error: 'este remitente no expone List-Unsubscribe' };
  return doUnsub(email, m.listUnsubscribe, m.listUnsubscribePost);
}

// ---------- HTTP server ----------
function readBody(req) { return new Promise(res => { let b = ''; req.on('data', c => b += c); req.on('end', () => res(b)); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }
  if (u.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('retry: 3000\n\n'); clients.add(res);
    res.write(`data: ${JSON.stringify({ t: 'stats', stats: state.stats, running: state.running, scanning: state.scanning })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (u.pathname === '/api/config' && req.method === 'GET') return json(200, { defaults: CFG.defaults, model: CFG.model, running: state.running });
  if (u.pathname === '/api/rules' && req.method === 'GET') {
    const promptTemplate = `${CFG.llmPrompt}\n\nEmail:\nFROM: {remitente}\nSUBJECT: {asuntos del remitente}\nBULK: {si tiene List-Unsubscribe}\nBODY: {cuerpo, max ${CFG.defaults.bodyMaxChars} chars}\n\nRespuesta:\n/no_think`;
    return json(200, { model: CFG.model, bodyMaxChars: CFG.defaults.bodyMaxChars, keepOverride: CFG.heuristics.keepOverride || '', subject: CFG.heuristics.subject, from: CFG.heuristics.from, body: CFG.heuristics.body, llmPrompt: CFG.llmPrompt, promptTemplate });
  }
  if (u.pathname === '/api/rules' && req.method === 'POST') {
    if (state.running) return json(409, { error: 'no se puede editar mientras corre' });
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) { return json(400, { error: 'json invalido' }); }
    for (const f of ['keepOverride', 'subject', 'from', 'body']) if (typeof p[f] === 'string' && p[f].length) { try { new RegExp(p[f], 'i'); } catch (e) { return json(400, { error: `regex invalido en "${f}": ${e.message}` }); } }
    for (const f of ['keepOverride', 'subject', 'from', 'body']) if (typeof p[f] === 'string') CFG.heuristics[f] = p[f];
    if (typeof p.llmPrompt === 'string' && p.llmPrompt.trim()) CFG.llmPrompt = p.llmPrompt.trim();
    try { recompileRules(); saveConfig(); } catch (e) { return json(500, { error: String(e) }); }
    emit('sys', 'Reglas actualizadas', 'info'); return json(200, { ok: true });
  }
  if (u.pathname === '/api/scan-senders' && req.method === 'POST') {
    if (state.scanning) return json(409, { error: 'ya escaneando' });
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    const query = p.query || 'in:inbox'; const sampleSize = Math.max(20, Math.min(3000, parseInt(p.sampleSize) || 300));
    scanSenders(query, sampleSize).catch(e => { emit('sys', 'SCAN ERROR: ' + e, 'err'); state.scanning = false; emitStats(); });
    return json(200, { ok: true });
  }
  if (u.pathname === '/api/scan-stop' && req.method === 'POST') { state.abortScan = true; return json(200, { ok: true }); }
  if (u.pathname === '/api/sender-rule' && req.method === 'POST') {
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    const email = (p.email || '').trim().toLowerCase(); const rule = p.rule;
    if (!email) return json(400, { error: 'falta email' });
    if (rule === 'none' || rule == null) delete SENDERS.rules[email]; else if (['delete', 'protect'].includes(rule)) SENDERS.rules[email] = rule; else return json(400, { error: 'rule invalida' });
    saveSenders();
    return json(200, { ok: true, email, rule: SENDERS.rules[email] || null, protected: isProtected(email, '', '') });
  }
  if (u.pathname === '/api/trash-sender' && req.method === 'POST') {
    if (state.running) return json(409, { error: 'ocupado' });
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    const email = (p.sender || '').trim(); if (!email) return json(400, { error: 'falta sender' });
    const r = await trashSender(email, !!p.dryRun); return json(200, { ok: true, ...r });
  }
  if (u.pathname === '/api/unsubscribe' && req.method === 'POST') {
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    const email = (p.email || '').trim().toLowerCase(); if (!email) return json(400, { error: 'falta email' });
    emit('sys', `Desuscribiendo de ${email}...`, 'info');
    const r = await unsubscribeSender(email);
    emit('sys', r.ok ? `Baja OK (${r.method}) de ${email}` : `Baja fallo: ${r.error}`, r.ok ? 'info' : 'err');
    return json(r.ok ? 200 : 400, r);
  }
  if (u.pathname === '/api/autorun' && req.method === 'POST') {
    if (state.running || state.scanning) return json(409, { error: 'ocupado' });
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    const query = p.query || 'in:inbox';
    const dureza = Math.max(0, Math.min(100, parseInt(p.dureza) || 50));
    autoRun(query, dureza, !!p.dryRun, !!p.autoUnsub).catch(e => { emit('sys', 'AUTO ERROR: ' + e, 'err'); state.running = false; emitStats(); });
    return json(200, { ok: true });
  }
  if (u.pathname === '/api/execute' && req.method === 'POST') {
    if (state.running) return json(409, { error: 'ya corriendo' });
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    const emails = Array.isArray(p.emails) ? p.emails.filter(Boolean) : [];
    if (!emails.length) return json(400, { error: 'no hay remitentes marcados para borrar' });
    executeDeletes(emails, !!p.dryRun).catch(e => { emit('sys', 'EXEC ERROR: ' + e, 'err'); state.running = false; emitStats(); });
    return json(200, { ok: true, count: emails.length });
  }
  if (u.pathname === '/api/start' && req.method === 'POST') {
    if (state.running) return json(409, { error: 'ya corriendo' });
    let p = {}; try { p = JSON.parse(await readBody(req) || '{}'); } catch (_) {}
    state.query = p.query || CFG.defaults.query;
    state.batchSize = Math.max(1, Math.min(50, parseInt(p.batchSize) || CFG.defaults.batchSize));
    state.concurrency = Math.max(1, Math.min(8, parseInt(p.concurrency) || CFG.defaults.concurrency));
    state.dryRun = !!p.dryRun;
    runEngine().catch(e => { emit('sys', 'ENGINE ERROR: ' + e, 'err'); state.running = false; emitStats(); });
    return json(200, { ok: true });
  }
  if (u.pathname === '/api/stop' && req.method === 'POST') { state.abort = true; emit('sys', 'STOP solicitado', 'warn'); return json(200, { ok: true }); }
  res.writeHead(404); res.end('not found');
});
server.listen(CFG.port, () => console.log(`NoniMail Limpieza en http://localhost:${CFG.port}`));
