'use strict';
// Trabajos por lotes sobre la bandeja:
//   scan    → agrupa por remitente y puntúa con el LLM (no borra nada)
//   execute → mueve a la Papelera los correos de los remitentes elegidos
//   auto    → clasifica y borra lo claramente promocional de corrido
// El rango se recorre en ventanas de fecha; el progreso se guarda al terminar cada ventana
// (y al pausar), así que un corte de Ollama, de la red o de la app se retoma con "Continuar".
const { makeWindows, jobKey } = require('./batches');
const C = require('./classify');
const llm = require('./llm');
const { unsubscribe } = require('./unsub');
const { t } = require('./i18n');
const F = require('./filtro');

const KINDS = ['scan', 'execute', 'auto'];
const kindLabel = (k) => t(`kind.${k}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clampInt = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };

class Paused extends Error {}

async function pMap(items, fn, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

class Engine {
  // o: { cfg(), rules(), senderRules(), isUnsubDone(email), markUnsub(email), progress, openMail(), smtpOptions(),
  //      emit(lane, text, kind), sse(obj), onRunStart(job), onRunEnd(job), retryDelays?,
  //      reputacion? { buscar(email) → {eliminar, n} | null }, onDecisiones?(lista) }
  constructor(o) {
    Object.assign(this, o);
    this.retryDelays = o.retryDelays || [3000, 10000, 30000];
    this.job = null; this.abort = false; this.lastScan = null; this._lastProgress = 0;
  }

  busy() { return !!this.job; }
  stop() { if (this.job) { this.abort = true; this.emit('sys', t('eng.stopping'), 'warn'); } }

  // ---------- crear / continuar ----------
  buildJob(kind, p) {
    const cfg = this.cfg();
    const job = {
      kind, account: cfg.account.email, folder: cfg.account.inboxFolder,
      daysBack: clampInt(p.daysBack, 0, 36500, cfg.cleaning.daysBack), windowDays: cfg.cleaning.windowDays,
      dryRun: !!p.dryRun,
      params: { dureza: clampInt(p.dureza, 0, 100, cfg.cleaning.dureza), autoUnsub: !!p.autoUnsub, unsub: [...new Set((p.unsub || []).map(e => String(e).toLowerCase()))], emails: (p.emails || []).map(e => String(e).toLowerCase()) },
      windows: null, doneIdx: 0, partial: null, totals: { seen: 0, deleted: 0, kept: 0, protected: 0 }, senders: {},
      createdAt: new Date().toISOString(), status: 'running', error: null,
    };
    if (kind === 'scan') job.dryRun = false; // escanear nunca borra: una sola clave
    job.key = jobKey(job);
    return job;
  }

  // Arranca (o continúa, con p.resume) y devuelve enseguida; el trabajo corre en segundo plano.
  start(kind, p = {}) {
    if (this.job) throw Object.assign(new Error(t('eng.busy')), { code: 409 });
    if (kind === 'execute' && !(p.emails || []).length && !p.resume) throw Object.assign(new Error(t('eng.noSenders')), { code: 400 });
    let job = this.buildJob(kind, p);
    const saved = this.progress.get(job.key);
    if (p.resume) {
      const byKey = p.key ? this.progress.get(p.key) : saved;
      if (!byKey) throw Object.assign(new Error(t('eng.noResume')), { code: 404 });
      job = byKey; job.status = 'running'; job.error = null;
    } else if (saved) this.progress.remove(saved.key);
    this.job = job; this.abort = false;
    this._run(job).catch(e => this.emit('sys', t('eng.unexpected', { error: e.message }), 'err'));
    return this.view();
  }

  discard(key) { if (this.job && this.job.key === key) throw Object.assign(new Error(t('eng.running')), { code: 409 }); this.progress.remove(key); }

  pendingJobs() {
    return this.progress.list().filter(j => !this.job || j.key !== this.job.key).map(j => this.view(j));
  }

  view(job = this.job) {
    if (!job) return { running: false };
    const done = job.doneIdx, total = job.windows ? job.windows.length : 0;
    const cur = job.cur || {};
    let etaSec = null;
    if (job === this.job && job.runStart && total) {
      const frac = (done - (job.runStartIdx || 0)) + (cur.total ? cur.done / cur.total : 0);
      const el = (Date.now() - job.runStart) / 1000;
      if (frac > 0.05) etaSec = Math.round(el / frac * (total - done - (cur.total ? cur.done / cur.total : 0)));
    }
    return {
      running: job === this.job, key: job.key, kind: job.kind, label: kindLabel(job.kind), status: job.status, error: job.error,
      account: job.account, daysBack: job.daysBack, windowDays: job.windowDays, dryRun: job.dryRun,
      // número del lote en curso (o el próximo, si está pausado); el total si terminó
      windowIdx: job.status === 'done' ? total : Math.min(done + 1, total), windowCount: total,
      windowLabel: cur.label || (job.windows && job.windows[done] ? job.windows[done].label : ''),
      windowDone: cur.done || 0, windowTotal: cur.total || 0, phase: job.phase || null, totals: job.totals, etaSec, updatedAt: job.updatedAt,
    };
  }

  // fase visible en la barra de progreso: connect · scan · group · classify · delete · unsub · done
  _phase(job, name, done = 0, total = 0) {
    job.phase = { name, done, total };
    this.sse({ t: 'phase', phase: job.phase });
  }

  _progress(force) {
    const now = Date.now();
    if (!force && now - this._lastProgress < 500) return;
    this._lastProgress = now;
    this.sse({ t: 'progress', job: this.view() });
  }

  // ---------- ciclo principal ----------
  async _run(job) {
    const cfg = this.cfg();
    let mail = null;
    this.onRunStart && this.onRunStart(job);
    job.runStart = Date.now(); job.runStartIdx = job.doneIdx;
    job.noThink = false; // al continuar se vuelve a intentar (pudo cambiar el modelo o el límite)
    const mine = new Set([...cfg.cleaning.myAddresses, cfg.account.email].map(a => String(a).toLowerCase()).filter(Boolean));
    const ctx = { cfg, mine, rules: this.rules(), senderRules: this.senderRules() };
    try {
      this.emit('sys', t('eng.start', { kind: kindLabel(job.kind), range: job.daysBack ? t('eng.lastDays', { n: job.daysBack }) : t('eng.all'), w: job.windowDays }) + (job.dryRun ? ` [${t('eng.dry')}]` : ''), 'info');
      job.ai = !!cfg.llm.enabled;
      if (job.kind !== 'execute') await this._checkLlm(cfg);
      this._phase(job, 'connect');
      mail = await this._retry(() => this._open(), t('eng.what.connect'));
      this._phase(job, job.kind === 'execute' ? 'delete' : 'scan', 0, job.kind === 'execute' ? job.params.emails.length : 0);
      if (!job.windows) {
        const oldest = job.daysBack ? null : await mail.oldestDate();
        job.windows = makeWindows({ daysBack: job.daysBack, windowDays: job.windowDays, oldest });
      }
      if (job.kind === 'scan') { this.lastScan = { key: job.key, account: job.account, senders: job.senders }; this.sse({ t: 'scanstart', senders: this._senderList(job) }); }
      this.progress.put(job); this._progress(true);
      if (job.kind !== 'execute') await this._scorePending(job, ctx, mail);
      for (let i = job.doneIdx; i < job.windows.length; i++) {
        if (this.abort) throw new Paused();
        const w = job.windows[i];
        if (!job.partial || job.partial.idx !== i) job.partial = { idx: i, uids: [] };
        job.cur = { idx: i, label: w.label, done: job.partial.uids.length, total: 0 };
        this.emit('heur', `── ${t('eng.batch', { i: i + 1, n: job.windows.length })}: ${w.label}`, 'info');
        let attempt = 0;
        for (;;) {
          try { mail = await this._ensure(mail); await this._window(job, ctx, mail, w); break; }
          catch (e) {
            if (e instanceof Paused || e.fatal) throw e;
            if (attempt >= this.retryDelays.length) throw e;
            this.emit('sys', t('eng.batchRetry', { error: e.message, a: attempt + 1, n: this.retryDelays.length }), 'warn');
            await mail?.close().catch(() => {}); mail = null;
            await sleep(this.retryDelays[attempt++]);
          }
        }
        if (job.kind === 'scan') await this._thinkDoubtful(job, ctx);
        job.doneIdx = i + 1; job.partial = null; job.cur = null;
        this.progress.put(job); this._progress(true);
      }
      if (job.kind === 'execute') { await this._unsubStage(job); this._reportDecisions(job, ctx); }
      job.status = 'done';
      this._phase(job, 'done');
      this.progress.remove(job.key);
      const tt = job.totals;
      this.emit('sys', job.kind === 'scan'
        ? t('eng.doneScan', { kind: kindLabel(job.kind), seen: tt.seen, senders: Object.keys(job.senders).length })
        : t(job.dryRun ? 'eng.doneCleanDry' : 'eng.doneClean', { kind: kindLabel(job.kind), seen: tt.seen, deleted: tt.deleted, kept: tt.kept }), 'info');
    } catch (e) {
      job.status = 'paused';
      job.error = e instanceof Paused ? null : e.message;
      this.progress.put(job);
      this.emit('sys', e instanceof Paused ? t('eng.paused', { i: job.doneIdx + 1, n: (job.windows || []).length }) : t('eng.pausedError', { error: e.message }), e instanceof Paused ? 'warn' : 'err');
    } finally {
      if (job.kind === 'scan') this.sse({ t: 'scandone', total: Object.keys(job.senders).length, sampled: job.totals.seen, status: job.status });
      await mail?.close().catch(() => {});
      this.job = null; this.abort = false;
      this.sse({ t: 'progress', job: { ...this.view(job), running: false } });
      this.onRunEnd && this.onRunEnd(job);
    }
  }

  async _open() { return this.openMail(); }
  async _ensure(mail) { return mail && mail.usable ? mail : this._retry(() => this._open(), t('eng.what.reconnect')); }

  async _retry(fn, what) {
    for (let a = 0; ; a++) {
      try { return await fn(); }
      catch (e) {
        const authFail = e.authenticationFailed || /AUTHENTICATIONFAILED|invalid credentials|authenticat/i.test(`${e.message} ${e.responseText || ''}`);
        if (e.fatal || authFail || e.config || a >= this.retryDelays.length) {
          throw Object.assign(new Error(t('eng.couldNot', { what, error: e.responseText || e.message })), { fatal: true });
        }
        this.emit('sys', t('eng.couldNotRetry', { what, error: e.message, a: a + 1 }), 'warn');
        await sleep(this.retryDelays[a]);
      }
    }
  }

  async _checkLlm(cfg) {
    if (!cfg.llm.enabled) return; // sin IA: solo heurísticas
    if (!cfg.model) throw Object.assign(new Error(t('eng.noModel')), { fatal: true });
    const r = await this._llm(cfg, 'Responde solo: 0', false);
    if (r == null) throw Object.assign(new Error(t('eng.ollamaNoReply')), { fatal: true });
  }

  // LLM con reintentos: Ollama caído o reiniciándose no debe perder el trabajo. Devuelve { text, truncated }
  async _llmRaw(cfg, prompt, think) {
    for (let a = 0; ; a++) {
      const r = await llm.generate(cfg, prompt, { think });
      if (r.ok) return r;
      if (a >= this.retryDelays.length) throw Object.assign(new Error(r.error), { fatal: true });
      this.emit('llm', t('eng.ollamaRetry', { error: r.error, a: a + 1 }), 'warn');
      await sleep(this.retryDelays[a]);
    }
  }
  async _llm(cfg, prompt, think) { return (await this._llmRaw(cfg, prompt, think)).text ?? ''; }

  // Re-evalúa un dudoso pensando. Si el modelo se corta sin responder (qwen3.5:9b piensa más de
  // 2000 tokens), deja de pensar en este trabajo: cada intento costaría más de un minuto para nada.
  async _think(job, cfg, g) {
    if (job.noThink) return;
    const r = await this._llmRaw(cfg, llm.buildPrompt(cfg.llmPrompt, { from: `${g.name} <${g.email}>`, subjects: g.samples, bulk: !!g.lu, body: g.body || '' }), true);
    if (r.truncated) {
      if (!job.noThink) {
        job.noThink = true;
        this.emit('sys', t('eng.thinkTruncated', { model: cfg.model, n: cfg.llm.thinkNumPredict }), 'warn');
      }
      return;
    }
    const prev = g.score; g.score = llm.parseScore(r.text, g.score); g.reason = 'llm-think';
    this.emit('llm', t('eng.thought', { score: g.score, prev, name: g.name.slice(0, 30) }), g.score >= 60 ? 'delete' : g.score <= 40 ? 'keep' : 'dry');
  }

  // ---------- una ventana ----------
  async _window(job, ctx, mail, w) {
    const uids = await mail.searchRange(w.since, w.before);
    const skip = new Set(job.partial.uids);
    const todo = uids.filter(u => !skip.has(u));
    job.cur.total = uids.length; job.cur.done = uids.length - todo.length;
    this._progress(true);
    for (let i = 0; i < todo.length; i += ctx.cfg.cleaning.fetchChunk) {
      if (this.abort) throw new Paused();
      const chunk = todo.slice(i, i + ctx.cfg.cleaning.fetchChunk);
      const metas = await mail.fetchMeta(chunk);
      this.emit('heur', t('eng.reading', { n: metas.length, done: job.cur.done + chunk.length, total: job.cur.total }), 'info');
      if (job.kind === 'scan') {
        // contar y marcar el bloque como hecho ANTES de puntuar: si Ollama se cae, los remitentes
        // sin puntaje se retoman con _scorePending y el bloque no se cuenta dos veces
        this._phase(job, 'group');
        const pending = this._scanChunk(job, ctx, metas);
        job.partial.uids.push(...chunk); job.cur.done += chunk.length;
        await this._scoreSenders(job, ctx, mail, pending);
        this._phase(job, 'scan');
      } else {
        await this._cleanChunk(job, ctx, mail, metas);
        job.partial.uids.push(...chunk); job.cur.done += chunk.length;
      }
      this._progress();
    }
  }

  // ---------- scan ----------
  _senderView(g) {
    return {
      email: g.email, name: g.name, count: g.count, samples: g.samples, canUnsub: !!g.lu,
      unsubDone: this.isUnsubDone(g.email), protected: g.prot, rule: this.senderRules()[g.email] || null, score: g.score, reason: g.reason,
    };
  }
  _senderList(job) { return Object.values(job.senders).map(g => this._senderView(g)); }

  _initialScore(g, ctx, meta) {
    const rule = ctx.senderRules[g.email];
    g.prot = C.isProtected(ctx.rules, ctx.senderRules, g.email, meta.subject, meta.from);
    if (rule === 'delete') { g.score = 100; g.reason = 'regla-usuario'; }
    else if (rule === 'protect') { g.score = 0; g.reason = 'regla-usuario'; }
    else if (g.prot) { g.score = 0; g.reason = 'protegido'; }
    else if (ctx.mine.has(g.email)) { g.score = 0; g.reason = 'mío'; }
    // un correo personal que es respuesta (Re:, In-Reply-To, References) y no trae baja no es envío masivo
    else if (ctx.cfg.cleaning.protectConversations && !meta.listUnsubscribe && C.looksLikeReply(meta)) { g.score = 0; g.reason = 'conversación'; }
    else { g.score = null; g.reason = 'pendiente-llm'; }
  }

  _scanChunk(job, ctx, metas) {
    const changed = new Set(), pending = [];
    for (const m of metas) {
      job.totals.seen++;
      let g = job.senders[m.email];
      if (!g) {
        g = job.senders[m.email] = { email: m.email, name: m.name, count: 0, samples: [], lu: '', luPost: '', sample: { uid: m.uid, part: m.part }, score: null, reason: null, prot: false };
        this._initialScore(g, ctx, m);
        if (g.score == null) pending.push(g);
        this.emit('heur', `${g.score === 0 ? t('eng.tag.protected') : g.score === 100 ? t('eng.tag.rule') : (ctx.cfg.llm.enabled ? t('eng.tag.toAi') : t('eng.tag.toHeur'))}: ${g.name.slice(0, 34)}`, g.score === 100 ? 'delete' : g.score === 0 ? 'keep' : 'info');
      }
      g.count++;
      if (g.samples.length < 3) g.samples.push(C.shortSubj(m.subject, 48));
      if (!g.lu && m.listUnsubscribe) { g.lu = m.listUnsubscribe; g.luPost = m.listUnsubscribePost; }
      changed.add(g);
    }
    if (changed.size) this.sse({ t: 'senders', list: [...changed].map(g => this._senderView(g)) });
    return pending;
  }

  // puntúa (rápido) remitentes sin puntaje, con el cuerpo de su primer correo
  async _scoreSenders(job, ctx, mail, list) {
    list = this._applyReputation(ctx, list);
    if (!list.length) return;
    const cfg = ctx.cfg;
    const classified = () => { const all = Object.values(job.senders); this._phase(job, 'classify', all.filter(g => g.score != null).length, all.length); };
    classified();
    if (!cfg.llm.enabled) { // sin IA: puntaje por señales, sin Ollama
      for (const g of list) {
        if (this.abort && job.kind === 'scan') return;
        const body = ctx.rules.body ? await mail.bodyText({ uid: g.sample.uid, part: g.sample.part }, cfg.cleaning.bodyMaxChars).catch(() => '') : '';
        g.score = C.heuristicScore(ctx.rules, cfg.heuristicScore, { subjects: g.samples, from: `${g.name} <${g.email}>`, bulk: !!g.lu, body });
        g.reason = 'heuristica';
        g.reglas = C.matchedRules(ctx.rules, { subjects: g.samples, from: `${g.name} <${g.email}>`, body });
        this.emit('llm', t('eng.scored', { score: g.score, name: g.name.slice(0, 32) }), g.score >= 60 ? 'delete' : g.score <= 40 ? 'keep' : 'dry');
        classified();
        if (job.kind === 'scan') this.sse({ t: 'senders', list: [this._senderView(g)] });
      }
      return;
    }
    await pMap(list, async (g) => {
      if (this.abort && job.kind === 'scan') return;
      const body = await mail.bodyText({ uid: g.sample.uid, part: g.sample.part }, cfg.cleaning.bodyMaxChars).catch(() => '');
      this.emit('llm', `🔍 ${g.name.slice(0, 30)} — "${(g.samples[0] || '').slice(0, 38)}"`, 'info');
      const txt = await this._llm(cfg, llm.buildPrompt(cfg.llmPrompt, { from: `${g.name} <${g.email}>`, subjects: g.samples, bulk: !!g.lu, body }), false);
      g.score = llm.parseScore(txt, 50); g.reason = 'llm';
      g.reglas = C.matchedRules(ctx.rules, { subjects: g.samples, from: `${g.name} <${g.email}>`, body });
      this.emit('llm', t('eng.answer', { text: String(txt).replace(/\s+/g, ' ').trim().slice(0, 48) || '—' }), 'info');
      if (cfg.llm.think && g.score >= cfg.llm.doubtLow && g.score <= cfg.llm.doubtHigh) g.body = body; // solo los dudosos lo vuelven a necesitar
      this.emit('llm', t('eng.scored', { score: g.score, name: g.name.slice(0, 32) }), g.score >= 60 ? 'delete' : g.score <= 40 ? 'keep' : 'dry');
      classified();
      if (job.kind === 'scan') this.sse({ t: 'senders', list: [this._senderView(g)] });
    }, cfg.llm.parallel);
  }

  // Capa de reputación colectiva (siempre activa): va después de protecciones y reglas, antes de la IA.
  // Devuelve los remitentes que aún necesitan puntaje.
  _applyReputation(ctx, list) {
    if (!this.reputacion) return list;
    const rest = [];
    for (const g of list) {
      const v = C.reputationVerdict(this.reputacion.buscar(g.email), ctx.cfg.filtro);
      if (!v) { rest.push(g); continue; }
      g.score = v.score; g.rep = true;
      g.reason = v.kind === 'eliminar' ? t('eng.rep.delete', { pct: v.pct }) : t('eng.rep.keep');
      const a = { pct: v.pct, score: v.score, name: g.name.slice(0, 32) };
      if (v.kind === 'eliminar') this.emit('heur', t('eng.rep.lineDelete', a), 'delete'); else this.emit('heur', t('eng.rep.lineKeep', a), 'keep');
      if (this.job && this.job.kind === 'scan') this.sse({ t: 'senders', list: [this._senderView(g)] });
    }
    return rest;
  }

  // Filtro colectivo: al EJECUTAR (no en simulación) se reporta el dominio de los remitentes masivos.
  _reportDecisions(job, ctx) {
    if (!this.onDecisiones || job.dryRun || !ctx.cfg.filtro || !ctx.cfg.filtro.compartir) return;
    const scan = this.lastScan && this.lastScan.account === job.account ? this.lastScan.senders : null;
    if (!scan) return;
    const elegidos = new Set(job.params.emails), bajas = new Set(job.params.unsub);
    const filas = Object.values(scan).map(g => ({
      g, decision: ctx.senderRules[g.email] === 'protect' ? 'nunca' : bajas.has(g.email) && elegidos.has(g.email) ? 'baja' : elegidos.has(g.email) ? 'eliminar' : 'conservar',
    })).filter(x => x.decision === 'nunca' || (!x.g.prot && !ctx.mine.has(x.g.email) && (x.decision !== 'conservar' || x.g.score != null)));
    const lista = F.armarDecisiones(filas, Infinity);
    if (lista.length) this.onDecisiones(lista);
  }

  // al continuar: los que quedaron sin puntaje cuando se cortó Ollama
  async _scorePending(job, ctx, mail) {
    const pend = Object.values(job.senders).filter(g => g.score == null && g.sample);
    if (pend.length) { this.emit('sys', t('eng.scoringPending', { n: pend.length }), 'info'); await this._scoreSenders(job, ctx, mail, pend); }
  }

  // re-evalúa con pensamiento los dudosos del lote (más lento, más preciso)
  async _thinkDoubtful(job, ctx) {
    const L = ctx.cfg.llm;
    if (!L.enabled || !L.think || job.noThink) return;
    const list = Object.values(job.senders).filter(g => g.reason === 'llm' && g.score >= L.doubtLow && g.score <= L.doubtHigh);
    if (!list.length) return;
    this.emit('sys', t('eng.thinking', { n: list.length }), 'info');
    await pMap(list, async (g) => {
      if (this.abort || job.noThink) return;
      await this._think(job, ctx.cfg, g);
      delete g.body;
      this.sse({ t: 'senders', list: [this._senderView(g)] });
    }, L.parallel);
  }

  // ---------- execute / auto ----------
  async _cleanChunk(job, ctx, mail, metas) {
    const { cfg } = ctx;
    if (job.kind === 'auto') {
      const nuevos = [];
      for (const m of metas) if (!job.senders[m.email]) {
        const g = job.senders[m.email] = { email: m.email, name: m.name, samples: [C.shortSubj(m.subject, 48)], lu: m.listUnsubscribe, luPost: m.listUnsubscribePost, sample: { uid: m.uid, part: m.part }, score: null, reason: null };
        this._initialScore(g, ctx, m);
        if (g.score == null) nuevos.push(g);
      }
      await this._scoreSenders(job, ctx, mail, nuevos);
      for (const g of nuevos) {
        if (!g.rep && cfg.llm.enabled && cfg.llm.think && g.score >= cfg.llm.doubtLow && g.score <= cfg.llm.doubtHigh) await this._think(job, cfg, g);
        delete g.body;
      }
    }
    // decisión por correo
    const cands = [];
    for (const m of metas) {
      job.totals.seen++;
      const ss = C.shortSubj(m.subject, 42);
      const rule = ctx.senderRules[m.email];
      let del = false, why = '', noted = false;
      if (job.kind === 'execute') del = job.params.emails.includes(m.email);
      else { const g = job.senders[m.email]; del = C.decide(g.score, job.params.dureza, cfg.cleaning.band) === 'delete'; why = `${g.score}`; }
      if (del && rule !== 'delete' && C.isProtected(ctx.rules, ctx.senderRules, m.email, m.subject, m.from)) { del = false; noted = true; job.totals.protected++; this.emit('heur', `${t('eng.tag.protected')}: ${ss}`, 'keep'); }
      else if (del && ctx.mine.has(m.email)) { del = false; noted = true; this.emit('heur', `${t('eng.tag.mine')}: ${ss}`, 'keep'); }
      if (del) cands.push(m);
      else if (job.kind === 'auto') { job.totals.kept++; if (!noted) this.emit('heur', `✓ (${why}) ${ss}`, 'keep'); }
    }
    // guardia de conversación (solo sobre los candidatos a borrar)
    const keep = cfg.cleaning.protectConversations ? await this._conversationGuard(ctx, mail, cands) : new Set();
    const toMove = cands.filter(m => !keep.has(m.uid));
    for (const m of cands) if (keep.has(m.uid)) { job.totals.protected++; job.totals.kept++; this.emit('heur', `${t('eng.tag.conversation')}: ${C.shortSubj(m.subject, 42)}`, 'keep'); }
    if (!toMove.length) return;
    job.delSenders = job.delSenders || new Set();
    for (const m of toMove) job.delSenders.add(m.email);
    if (job.kind === 'execute') this._phase(job, 'delete', job.delSenders.size, job.params.emails.length);
    if (job.dryRun) {
      for (const m of toMove) this.emit('heur', `${t('eng.tag.wouldDelete')}: ${m.name.slice(0, 20)} · ${C.shortSubj(m.subject, 38)}`, 'dry');
      job.totals.deleted += toMove.length;
    } else {
      const n = await mail.moveToTrash(toMove.map(m => m.uid));
      job.totals.deleted += n;
      for (const m of toMove) this.emit('heur', `🗑️ ${m.name.slice(0, 20)} · ${C.shortSubj(m.subject, 38)}`, 'delete');
    }
    if (job.kind === 'auto' && job.params.autoUnsub && !job.dryRun) {
      for (const email of new Set(toMove.map(m => m.email))) {
        const g = job.senders[email];
        if (!g || !g.lu || g.unsubTried || this.isUnsubDone(email)) continue;
        g.unsubTried = true;
        const r = await this.unsubscribeWith(email, g.lu, g.luPost);
        this.emit('heur', r.ok ? t('eng.unsubOk', { method: r.method, name: g.name.slice(0, 24) }) : t('eng.unsubFail', { name: g.name.slice(0, 20), error: r.error }), r.ok ? 'keep' : 'warn');
      }
    }
  }

  // uids de candidatos que son parte de una conversación (no se borran)
  async _conversationGuard(ctx, mail, cands) {
    const keep = new Set();
    const rest = [];
    for (const m of cands) (C.looksLikeReply(m) ? keep.add(m.uid) : rest.push(m));
    if (!rest.length) return keep;
    if (mail.isGmail) {
      const ids = [...new Set(rest.map(m => m.threadId).filter(Boolean))];
      const threads = await mail.gmailThreadSenders(ids);
      for (const m of rest) { const s = threads.get(m.threadId); if (s && C.isConversation(s, ctx.mine)) keep.add(m.uid); }
    } else {
      const replied = await mail.repliedMessageIds(rest.map(m => m.messageId).filter(Boolean));
      for (const m of rest) if (replied.has(m.messageId)) keep.add(m.uid);
    }
    return keep;
  }

  // ---------- bajas ----------
  // Las bajas marcadas en la lista corren aquí, junto con el Eliminar (nunca al marcar). Simulación: solo se informa.
  async _unsubStage(job) {
    const list = (job.params.unsub || []).filter(e => !this.isUnsubDone(e));
    for (let i = 0; i < list.length; i++) {
      if (this.abort) throw new Paused();
      const email = list[i], g = this.lastScan && this.lastScan.senders[email], name = ((g && g.name) || email).slice(0, 24);
      this._phase(job, 'unsub', i, list.length);
      if (job.dryRun) { this.emit('heur', t('eng.unsubWould', { name }), 'dry'); continue; }
      let r;
      try { r = await this.unsubscribeSender(email); } catch (e) { r = { ok: false, error: e.message }; }
      this.emit('heur', r.ok ? t('eng.unsubOk', { method: r.method, name }) : t('eng.unsubFail', { name, error: r.error }), r.ok ? 'keep' : 'warn');
    }
    if (list.length) this._phase(job, 'unsub', list.length, list.length);
  }

  async unsubscribeWith(email, lu, luPost) {
    const smtpOptions = lu && /mailto:/i.test(lu) ? await this.smtpOptions().catch(() => null) : null;
    const r = await unsubscribe({ lu, luPost, smtpOptions, from: this.cfg().account.email });
    if (r.ok) this.markUnsub(email);
    return r;
  }

  // baja pedida desde la UI: usa la cabecera del escaneo o lee el último correo del remitente
  async unsubscribeSender(email) {
    email = String(email).toLowerCase();
    let g = this.lastScan && this.lastScan.senders[email];
    let lu = g && g.lu, luPost = g && g.luPost;
    if (!lu) {
      const mail = await this.openMail();
      try { const m = await mail.latestFrom(email); lu = m && m.listUnsubscribe; luPost = m && m.listUnsubscribePost; }
      finally { await mail.close().catch(() => {}); }
    }
    return this.unsubscribeWith(email, lu, luPost);
  }

  scanSenders() { return this.lastScan ? Object.values(this.lastScan.senders).map(g => this._senderView(g)) : []; }
}

module.exports = { Engine, KINDS, kindLabel };
