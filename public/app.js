'use strict';
// NoniMail Tools · interfaz. Habla con la API local (lib/app.js) y recibe el progreso por SSE.
(function () {
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const ACCENTS = ['carmesi', 'verde-azulado', 'violeta', 'azul', 'ambar', 'verde'];
  const MODES = ['auto', 'claro', 'oscuro'];

  // ---------------------------------------------------------------- utilidades
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // solo iconos constantes del propio código
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const debounce = (fn, ms) => { let to; return (...a) => { clearTimeout(to); to = setTimeout(() => fn(...a), ms); }; };

  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null;
    try { j = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  }

  // ---------------------------------------------------------------- idioma
  const DICT = { es: {}, en: {} };
  let LANG = document.documentElement.lang || 'es';
  async function loadLocale(l) { if (!Object.keys(DICT[l] || {}).length) DICT[l] = await (await fetch(`/locales/${l}.json`)).json(); }
  function t(key, params) {
    const s = (DICT[LANG] && DICT[LANG][key]) ?? DICT.es[key] ?? key;
    return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m)) : s;
  }
  function applyI18n(root = document) {
    for (const el of qsa('[data-i18n]', root)) el.textContent = t(el.getAttribute('data-i18n'));
    for (const el of qsa('[data-i18n-ph]', root)) el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    for (const el of qsa('[data-i18n-title]', root)) el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  }
  async function setLang(l) {
    await Promise.all([loadLocale('es'), loadLocale(l)]);
    LANG = l; document.documentElement.lang = l;
    applyI18n();
  }
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(LANG, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return iso; } };
  const fmtNum = (n) => Number(n || 0).toLocaleString(LANG);
  function fmtBytes(b) {
    b = Number(b || 0); const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toLocaleString(LANG, { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
  }
  function fmtEta(sec) {
    if (sec == null) return '';
    if (sec < 90) return `${sec}s`;
    const m = Math.round(sec / 60);
    return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // ---------------------------------------------------------------- avisos y diálogo
  function toast(msg, kind = '') {
    const el = h('div', { class: `toast ${kind}`, text: msg });
    $('toasts').append(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 9000 : 4500);
  }
  const fail = (e) => toast(e && e.message ? e.message : String(e), 'bad');
  function ask(title, lines, okLabel) {
    return new Promise((resolve) => {
      const done = (v) => { scrim.remove(); resolve(v); };
      const scrim = h('div', { class: 'modal-scrim', role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'card modal' },
          h('h2', { text: title }),
          h('div', { style: 'display:grid;gap:6px' }, lines.map(l => h('div', { text: l }))),
          h('div', { class: 'row', style: 'justify-content:flex-end' },
            h('button', { class: 'btn', text: t('ui.cancel'), onclick: () => done(false) }),
            h('button', { class: 'btn primary', text: okLabel || t('ui.accept'), onclick: () => done(true), id: 'ask-ok' }))));
      document.body.append(scrim);
      $('ask-ok').focus();
    });
  }
  const copyText = async (txt) => { try { await navigator.clipboard.writeText(txt); toast(t('ui.copied'), 'ok'); } catch (_) { toast(txt); } };

  // Logo «G» de Google (marca oficial, cuatro colores)
  function GLOGO() {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'glogo');
    for (const [c, d] of [['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'], ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'], ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'], ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z']]) {
      const p = document.createElementNS(ns, 'path'); p.setAttribute('fill', c); p.setAttribute('d', d); svg.append(p);
    }
    return svg;
  }

  // ---------------------------------------------------------------- estado
  const S = { config: null, settings: null, lic: null, setup: null, senders: new Map(), over: new Map(), job: { running: false }, sync: null, scanDone: false, unsubMark: new Map(), authOpen: false, phaseDismissed: false, tab: 'cuentas', sec: 'ia', presets: null, draftEmail: '', draftPrivate: false, googleWait: false };
  const acctById = (id) => (S.config.accounts || []).find(a => a.id === id);
  const activeAcct = () => acctById(S.config.activeAccount) || (S.config.accounts || [])[0] || null;
  const busy = () => (S.job && S.job.running) || (S.sync && S.sync.running);

  // ---------------------------------------------------------------- pestañas
  // Sincronizar y Limpiar esperan a una cuenta guardada y probada (config.tabs lo decide el servidor)
  const tabEnabled = (name) => !(S.config && S.config.tabs && S.config.tabs[name] === false);
  function renderTabs() {
    for (const b of qsa('.tab-btn')) {
      const off = !tabEnabled(b.dataset.tab);
      b.setAttribute('aria-disabled', String(off));
      b.classList.toggle('is-off', off);
      if (off) { b.title = t('ui.tab.needAccount'); b.dataset.tip = t('ui.tab.needAccount'); } else { b.removeAttribute('title'); delete b.dataset.tip; }
    }
    if (!tabEnabled(S.tab)) showTab('cuentas');
  }
  function showTab(name, sec) {
    if (!tabEnabled(name)) return;
    S.tab = name;
    for (const b of qsa('.tab-btn')) { const on = b.dataset.tab === name; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
    for (const x of qsa('main > .tab')) x.classList.toggle('on', x.id === `tab-${name}`);
    if (name === 'cuentas') renderAccountsTab();
    if (name === 'ajustes') showSec(sec || S.sec);
    if (name === 'sincronizar') renderSync();
    if (name === 'limpiar') renderClean();
  }
  function showSec(name) {
    S.sec = name;
    for (const b of qsa('#set-nav button')) { b.setAttribute('aria-selected', String(b.dataset.sec === name)); b.tabIndex = b.dataset.sec === name ? 0 : -1; }
    for (const x of qsa('.set-sec')) x.classList.toggle('on', x.id === `sec-${name}`);
    loadSettings().then(renderSettings).catch(fail);
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { const [tab, sec] = g.dataset.goto.split(':'); if (g.dataset.auth) { S.authOpen = true; } showTab(tab, sec); if (g.dataset.auth) renderAuthBoxes(); }
  });
  for (const b of qsa('.tab-btn')) b.addEventListener('click', () => showTab(b.dataset.tab));
  for (const b of qsa('#set-nav button')) b.addEventListener('click', () => showSec(b.dataset.sec));
  // flechas entre pestañas (patrón de pestañas del WAI-ARIA)
  function arrowNav(list, pick) {
    return (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const items = list().filter(b => b.getAttribute('aria-disabled') !== 'true');
      const i = items.indexOf(document.activeElement); if (i < 0) return;
      const n = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
      n.focus(); pick(n); e.preventDefault();
    };
  }
  $('main-tabs').addEventListener('keydown', arrowNav(() => qsa('.tab-btn'), (b) => showTab(b.dataset.tab)));
  $('set-nav').addEventListener('keydown', arrowNav(() => qsa('#set-nav button'), (b) => showSec(b.dataset.sec)));

  // ---------------------------------------------------------------- tema
  function applyAppearance(ap) { if (window.NMTTheme) window.NMTTheme.set(ap.mode, ap.accent); }
  async function saveAppearance(patch) {
    const r = await api('POST', '/api/appearance', patch);
    S.config.appearance = r.appearance; applyAppearance(r.appearance);
    return r.appearance;
  }
  function modeLabel(m) { return t(`ui.mode.${m}`); }
  function accentLabel(a) { return t(`ui.accent.${a}`); }
  function modeControl(el, current, onPick) {
    clear(el).append(h('div', { class: 'seg', role: 'group' }, MODES.map(m =>
      h('button', { type: 'button', 'aria-pressed': String(m === current), text: modeLabel(m), onclick: () => onPick(m) }))));
  }
  function accentControl(el, current, onPick) {
    clear(el).append(h('div', { class: 'swatches', role: 'radiogroup' }, ACCENTS.map(a =>
      h('button', { type: 'button', class: 'sw', role: 'radio', 'aria-checked': String(a === current), 'aria-label': accentLabel(a), title: accentLabel(a), style: `--sw:var(--sw-${a})`, onclick: () => onPick(a) }))));
  }
  function langControl(el, current, onPick, withAuto) {
    const opts = (withAuto ? [['', t('ui.lang.auto')]] : []).concat([['es', 'Español'], ['en', 'English']]);
    clear(el).append(h('div', { class: 'seg', role: 'group' }, opts.map(([v, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(v === current), text: label, onclick: () => onPick(v) }))));
  }
  async function pickLanguage(v) {
    const r = await api('POST', '/api/setup/prefs', { language: v });
    await setLang(r.language);
    S.config.language = r.language;
    S.config.languageSetting = v;
    rerenderStatic();
    if (S.settings) renderSettings();
    if (!$('wizard').hidden) Wizard.render();
  }

  // ---------------------------------------------------------------- cabecera
  function renderHeader() {
    const sel = clear($('acctSel')), list = S.config.accounts || [];
    if (!list.length) sel.append(h('option', { value: '', text: t('ui.noAccountShort') }));
    for (const a of list) sel.append(h('option', { value: a.id, text: a.email }));
    const act = activeAcct();
    if (act) sel.value = act.id;
    sel.disabled = !list.length || !!busy();
    renderUpdate(); // el botón «Reiniciar ahora» depende de si hay una operación en curso
  }
  $('acctSel').addEventListener('change', async (e) => {
    try { S.config = await api('POST', '/api/accounts/active', { id: e.target.value }); S.senders.clear(); S.over.clear(); S.scanDone = false; renderAll(); }
    catch (er) { fail(er); renderHeader(); }
  });

  // ---------------------------------------------------------------- licencias: avisos
  function gatePill(gate) {
    if (!gate) return h('span');
    if (gate.personal) return h('span', { class: 'pill ok', text: t('ui.gate.free') });
    if (gate.permitido) return h('span', { class: 'pill ok', text: t('ui.gate.licensed', { date: fmtDate(gate.vence) }) });
    // cuenta comercial sin licencia: una línea con el enlace de compra; la sesión se inicia desde Cuentas
    return h('span', { class: 'pill warn' }, t('ui.gate.noLicense'), ' ',
      h('a', { href: gate.comprar, target: '_blank', rel: 'noopener', text: t('ui.gate.buyLink') }),
      S.config.auth && !S.config.auth.signedIn ? h('button', { type: 'button', class: 'pill-link', 'data-goto': 'cuentas', 'data-auth': '1', text: t('ui.auth.signIn') }) : null);
  }

  // ================================================================ LIMPIAR
  const cl = { dureza: 50 };
  const dureza = () => cl.dureza;
  function effDecision(s) {
    if (S.over.has(s.email)) return S.over.get(s.email);
    if (s.rule === 'delete') return 'delete';
    if (s.rule === 'protect' || s.protected) return 'keep';
    if (s.score == null) return 'keep';
    // igual que classify.decide(): solo se marca lo claro; el margen de duda queda en Conservar
    return s.score >= (100 - dureza()) + ((S.config.cleaning || {}).band || 0) ? 'delete' : 'keep';
  }
  function renderClean() {
    const acct = activeAcct();
    if (!acct) return;
    const running = !!(S.job && S.job.running);
    $('cl-scan').disabled = running || !acct.ready; $('cl-run').disabled = running || !acct.ready || !S.scanDone && !S.senders.size;
    $('cl-auto').disabled = running || !acct.ready;
    for (const id of ['cl-range', 'cl-dry', 'cl-unsub', 'cl-dureza']) $(id).disabled = running;
    clear($('cl-gate')).append(gatePill(S.config.gate));
    renderTermTitles();
    renderProgress();
    renderPending();
    renderSenders();
  }
  function renderProgress() {
    const j = S.job || {};
    const tt = j.totals || { seen: 0, deleted: 0, kept: 0, protected: 0 };
    $('st-seen').textContent = fmtNum(tt.seen); $('st-del').textContent = fmtNum(tt.deleted);
    $('st-kept').textContent = fmtNum(tt.kept); $('st-prot').textContent = fmtNum(tt.protected);
    $('st-senders').textContent = fmtNum(S.senders.size);
    renderPhase();
  }
  // Barra con fases sobre la lista: conectando · escaneando · agrupando · clasificando · eliminando · dándose de baja · listo
  let phaseTimers = [];
  function renderPhase() {
    const j = S.job || {}, ph = j.phase, box = $('cl-phase');
    const finished = !j.running && ph && ph.name === 'done' && j.status === 'done';
    if (j.running) { S.phaseDismissed = false; phaseTimers.forEach(clearTimeout); phaseTimers = []; box.classList.remove('fade'); }
    if (!(j.running && ph) && !(finished && !S.phaseDismissed)) { box.hidden = true; return; }
    if (finished && !phaseTimers.length) {
      phaseTimers = [setTimeout(() => box.classList.add('fade'), 1800), setTimeout(() => { S.phaseDismissed = true; box.hidden = true; phaseTimers = []; }, 2500)];
    }
    box.hidden = false;
    const win = j.windowCount ? ((j.windowIdx - 1) + (j.windowTotal ? j.windowDone / j.windowTotal : 0)) / j.windowCount : 0;
    const own = ph.total ? ph.done / ph.total : 0;
    let label, frac, extra = '';
    switch (ph.name) {
      case 'connect': label = t('ui.phase.connect'); frac = 0.04; break;
      case 'scan': label = j.windowTotal ? t('ui.phase.scan', { done: fmtNum(j.windowDone), total: fmtNum(j.windowTotal) }) : t('ui.clean.scanning'); frac = win; extra = j.windowCount ? t('ui.clean.batch', { i: j.windowIdx, n: j.windowCount }) : ''; break;
      case 'group': label = t('ui.phase.group'); frac = win; break;
      case 'classify': label = t('ui.phase.classify', { done: fmtNum(ph.done), total: fmtNum(ph.total) }); frac = own; break;
      case 'delete': label = t('ui.phase.delete', { done: fmtNum(ph.done), total: fmtNum(ph.total) }); frac = win; extra = j.windowCount ? t('ui.clean.batch', { i: j.windowIdx, n: j.windowCount }) : ''; break;
      case 'unsub': label = t('ui.phase.unsub', { done: fmtNum(ph.done), total: fmtNum(ph.total) }); frac = own; break;
      default: label = t('ui.phase.done'); frac = 1;
    }
    const pct = Math.max(0, Math.min(100, Math.round(frac * 100)));
    $('cl-phase-t').textContent = label;
    $('cl-phase-s').textContent = [extra, ph.name === 'connect' ? '' : `${pct}%`, j.etaSec != null && j.running ? fmtEta(j.etaSec) : '', j.dryRun ? t('ui.dry') : ''].filter(Boolean).join(' · ');
    $('cl-bar').style.width = `${Math.max(2, pct)}%`;
    $('cl-stop').hidden = !j.running;
  }
  function renderPending() {
    const box = clear($('cl-pending')), list = (S.config.pending || []).filter(p => !S.job.running || p.key !== S.job.key);
    for (const p of list) {
      const resume = h('button', { class: 'btn sm primary', text: t('ui.resume'), onclick: async () => {
        try { await api('POST', '/api/jobs/resume', { key: p.key }); S.config = await api('GET', '/api/config'); renderAll(); } catch (e) { fail(e); }
      } });
      const drop = h('button', { class: 'btn sm', text: t('ui.discard'), onclick: async () => {
        try { await api('POST', '/api/jobs/discard', { key: p.key }); S.config.pending = (S.config.pending || []).filter(x => x.key !== p.key); renderPending(); } catch (e) { fail(e); }
      } });
      box.append(h('div', { class: `banner ${p.error ? 'bad' : ''}` },
        h('span', { class: 'msg', text: `${p.label} · ${p.account} · ${t('ui.clean.batch', { i: p.windowIdx, n: p.windowCount })}${p.error ? ` · ${p.error}` : ''}` }), resume, drop));
    }
  }
  const ICONS = {
    lock: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    mailx: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  };
  const icon = (name) => h('span', { class: 'ico', html: ICONS[name] });
  // marca de baja: la que puso la persona; si no, el valor por defecto del interruptor global (solo para los que se eliminan)
  const unsubMarked = (s) => s.canUnsub && !s.unsubDone && (S.unsubMark.has(s.email) ? S.unsubMark.get(s.email) : $('cl-unsub').checked && effDecision(s) === 'delete');
  function renderSenders() {
    const body = clear($('cl-rows')), q = $('cl-filter').value.trim().toLowerCase();
    const all = [...S.senders.values()].sort((a, b) => b.count - a.count);
    const list = all.filter(s => !q || s.email.includes(q) || (s.name || '').toLowerCase().includes(q));
    $('cl-empty').hidden = all.length > 0;
    $('cl-empty').textContent = S.job.running && S.job.kind === 'scan' ? t('ui.clean.scanning') : t('ui.clean.empty');
    const sel = all.filter(s => effDecision(s) === 'delete');
    $('cl-sel').textContent = t('ui.clean.selected', { n: sel.length, m: fmtNum(sel.reduce((a, s) => a + s.count, 0)) });
    for (const s of list.slice(0, 600)) {
      const dec = effDecision(s), never = s.rule === 'protect', mark = unsubMarked(s);
      const cls = s.score == null ? '' : s.score >= 60 ? 'hi' : s.score <= 40 ? 'lo' : 'mid';
      const tgl = (val, label) => h('button', { type: 'button', 'aria-pressed': String(dec === val), disabled: never, text: label, onclick: () => { S.over.set(s.email, val); renderSenders(); } });
      const acts = h('div', { class: 'row acts' });
      if (s.unsubDone) acts.append(h('span', { class: 'pill ok', text: t('ui.clean.unsubDone') }));
      else if (s.canUnsub) acts.append(h('button', { type: 'button', class: 'btn sm tgl', 'aria-pressed': String(mark), title: t('ui.clean.unsubMarkTip'), onclick: () => { S.unsubMark.set(s.email, !mark); renderSenders(); } }, icon('mailx'), t('ui.clean.unsubOne')));
      acts.append(h('button', { type: 'button', class: 'btn sm tgl', 'aria-pressed': String(never), title: t('ui.clean.protectTip'), onclick: async () => {
        try { const r = await api('POST', '/api/sender-rule', { email: s.email, rule: never ? 'none' : 'protect' }); s.rule = r.rule; s.protected = r.rule === 'protect' ? true : s.protected; S.over.delete(s.email); renderSenders(); } catch (e) { fail(e); }
      } }, icon('lock'), never ? t('ui.clean.unprotect') : t('ui.clean.protect')));
      const flags = [];
      if (never) flags.push(h('div', { class: 's-flag' }, icon('lock'), t('ui.clean.alwaysKept')));
      if (mark) flags.push(h('div', { class: 's-flag warn' }, icon('mailx'), t('ui.clean.willUnsub')));
      body.append(h('tr', {},
        h('td', { title: (s.samples || []).slice(0, 3).join(' · ') }, h('div', { class: 's-name', text: s.name || s.email }), h('div', { class: 's-mail', text: s.email }), flags),
        h('td', { class: 'num', text: fmtNum(s.count) }),
        h('td', { class: 'num' }, h('span', { class: `score ${cls}`, text: s.score == null ? '…' : s.score, title: s.reason || '' })),
        h('td', {}, h('div', { class: `seg sm ${dec === 'delete' ? 'del' : 'keep'}` }, tgl('keep', t('ui.clean.keep')), tgl('delete', t('ui.clean.move')))),
        h('td', {}, acts)));
    }
  }
  const renderSendersSoon = debounce(renderSenders, 150);
  function setCleanView(v) {
    for (const b of qsa('#cl-view button')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
    $('cl-pane-senders').hidden = v !== 'senders'; $('cl-log').hidden = v !== 'log';
    $('cl-filter').hidden = v !== 'senders'; $('cl-sel').hidden = v !== 'senders';
  }
  for (const b of qsa('#cl-view button')) b.addEventListener('click', () => setCleanView(b.dataset.view));

  async function startClean(kind) {
    const acct = activeAcct();
    if (!acct) return;
    const days = parseInt($('cl-range').value, 10), dry = $('cl-dry').checked, unsub = $('cl-unsub').checked; // en «Limpiar todo» el interruptor sí baja a los que borra
    const range = $('cl-range').selectedOptions[0].textContent.toLowerCase();
    try {
      let r;
      if (kind === 'scan') {
        S.senders.clear(); S.over.clear(); S.unsubMark.clear(); S.scanDone = false; clear($('cl-log')); resetFeeds(); renderSenders();
        r = await api('POST', '/api/scan', { daysBack: days });
      } else if (kind === 'execute') {
        const emails = [...S.senders.values()].filter(s => effDecision(s) === 'delete').map(s => s.email);
        if (!emails.length) return toast(t('ui.clean.nothing'), 'bad');
        const n = emails.reduce((a, e) => a + S.senders.get(e).count, 0);
        const bajas = [...S.senders.values()].filter(unsubMarked).map(x => x.email);
        const lines = [t('ui.clean.confirmRun', { n: emails.length, m: fmtNum(n), range }), dry ? t('ui.dry') : t('ui.clean.toTrash')];
        if (bajas.length) lines.push(t('ui.clean.confirmUnsub', { n: bajas.length }) + (dry ? ` · ${t('ui.clean.confirmUnsubDry')}` : ''));
        const ok = await ask(t('ui.clean.run'), lines, t('ui.clean.run'));
        if (!ok) return;
        clear($('cl-log')); resetFeeds();
        r = await api('POST', '/api/execute', { daysBack: days, emails, dryRun: dry, unsub: bajas });
      } else {
        const ok = await ask(t('ui.clean.auto'), [t('ui.clean.confirmAuto', { range, strict: dureza() }), dry ? t('ui.dry') : t('ui.clean.toTrash')], t('ui.clean.auto'));
        if (!ok) return;
        clear($('cl-log')); resetFeeds();
        r = await api('POST', '/api/autorun', { daysBack: days, dureza: dureza(), dryRun: dry, autoUnsub: unsub });
      }
      if (r.forcedDryRun) toast(r.gate.motivo, 'bad');
      S.job = r; renderAll();
    } catch (e) { fail(e); if (e.status === 402) refreshConfig(); }
  }
  $('cl-scan').onclick = () => startClean('scan');
  $('cl-run').onclick = () => startClean('execute');
  $('cl-auto').onclick = () => startClean('auto');
  $('cl-unsub').addEventListener('change', renderSenders);
  $('cl-stop').onclick = () => api('POST', '/api/stop', {}).catch(fail);
  $('cl-filter').addEventListener('input', renderSendersSoon);
  $('cl-dureza').addEventListener('input', (e) => { cl.dureza = parseInt(e.target.value, 10); $('cl-dureza-v').textContent = cl.dureza; renderSenders(); });

  function addLog(el, text, kind, ts) {
    const line = h('div', { class: `l-${kind || 'info'}`, text: `${ts ? `${ts} ` : ''}${text}` });
    const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    el.append(line);
    while (el.childNodes.length > 800) el.firstChild.remove();
    if (stick) el.scrollTop = el.scrollHeight;
  }

  // ---- terminales: CPU (lectura + heurística), GPU (modelo) y red (Sincronizar). El fondo oscuro es el de una terminal real
  const TERM_MAX = 400;
  function termLine(feed, text, kind, ts) {
    const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 30;
    feed.append(h('div', { class: 'ln' }, h('span', { class: 'ts', text: ts || '' }), h('span', { class: `k-${kind || 'info'}`, text })));
    while (feed.childNodes.length > TERM_MAX) feed.firstChild.remove();
    if (stick) feed.scrollTop = feed.scrollHeight;
  }
  function resetFeeds() { clear($('feed-cpu')); clear($('feed-gpu')); }
  function renderTermTitles() {
    $('gpu-title').textContent = t('ui.term.gpu', { model: (S.config && S.config.aiEnabled && S.config.model) || t('ui.term.noModel') });
    $('feed-cpu').dataset.idle = t('ui.term.idle'); $('feed-gpu').dataset.idle = t('ui.term.idle'); $('sy-log').dataset.idle = t('ui.term.syncIdle');
  }
  function setMeter(barId, pctId, pct) {
    const v = Math.max(0, Math.min(100, Math.round(pct) || 0)), bar = $(barId);
    bar.style.width = `${v}%`; bar.className = v > 80 ? 'hi' : v > 45 ? 'mid' : 'lo';
    $(pctId).textContent = `${v}%`;
  }
  function onMetrics(m) {
    if (typeof m.cpu === 'number') setMeter('cpu-bar', 'cpu-pct', m.cpu);
    if (m.gpu) { setMeter('gpu-bar', 'gpu-pct', m.gpu.util); $('vram').textContent = `${(m.gpu.vramUsed / 1024).toFixed(1)}/${(m.gpu.vramTotal / 1024).toFixed(1)} GB`; }
    else { $('gpu-pct').textContent = t('ui.term.na'); $('gpu-bar').style.width = '0'; $('vram').textContent = ''; }
  }

  // ================================================================ SINCRONIZAR
  const sy = { lines: 0, last: null, peak: 0, tick: null, lastText: '' };
  function netRate(bytes) {
    const now = Date.now();
    if (sy.last && bytes >= sy.last.bytes && now > sy.last.ts) {
      const rate = (bytes - sy.last.bytes) / ((now - sy.last.ts) / 1000);
      sy.peak = Math.max(sy.peak, rate, 1);
      $('net-bar').style.width = `${Math.round(100 * rate / sy.peak)}%`; $('net-bar').className = 'lo';
      $('net-rate').textContent = `${fmtBytes(rate)}/s`;
    }
    sy.last = { bytes, ts: now };
    clearTimeout(sy.tick); sy.tick = setTimeout(() => netIdle(), 5000);
  }
  function netIdle() { clearTimeout(sy.tick); $('net-bar').style.width = '0'; $('net-rate').textContent = '—'; }
  function renderSync() {
    const list = S.config.accounts || [];
    const ok = list.length >= 2;
    $('sy-need').hidden = ok; $('sy-main').style.display = ok ? '' : 'none';
    if (!ok) return;
    const fill = (sel, keep, skip) => {
      const prev = keep || sel.value; clear(sel);
      for (const a of list) sel.append(h('option', { value: a.id, text: a.email }));
      sel.value = list.some(a => a.id === prev) ? prev : list[0].id;
    };
    if (!$('sy-src').options.length || $('sy-src').options.length !== list.length) {
      fill($('sy-src')); fill($('sy-dst'));
      if ($('sy-dst').value === $('sy-src').value && list[1]) $('sy-dst').value = list[1].id;
    }
    const running = !!(S.sync && S.sync.running);
    for (const id of ['sy-src', 'sy-dst', 'sy-folders', 'sy-exclude', 'sy-dry']) $(id).disabled = running;
    $('sy-run').disabled = running; $('sy-stop').hidden = !running;
    $('sy-run').textContent = $('sy-dry').checked ? t('ui.sync.simulate') : t('ui.sync.run');
    renderSyncGate();
    const st = S.sync || {};
    const p = st.progress || {};
    const tot = (st.result && st.result.totals) || null;
    $('sy-folders-n').textContent = fmtNum(tot ? (st.result.folders || []).length : (p.foldersDone || 0));
    $('sy-copied').textContent = fmtNum(tot ? tot.copied : (p.copied || 0));
    $('sy-source-n').textContent = fmtNum(tot ? tot.source : 0);
    $('sy-errors').textContent = fmtNum(tot ? tot.errors : 0);
    $('sy-bytes').textContent = fmtBytes(tot ? tot.bytes : (p.bytes || 0));
    $('sy-prog').hidden = !running;
    if (running) {
      const f = p.foldersTotal ? (p.foldersDone || 0) / p.foldersTotal : 0;
      const inner = p.folderTotal ? (p.copied || 0) / p.folderTotal : 0;
      const frac = p.foldersTotal ? Math.min(1, f + inner / p.foldersTotal) : inner;
      $('sy-bar').style.width = `${Math.max(2, Math.round(frac * 100))}%`;
      $('sy-prog-t').textContent = [p.folder, p.folderTotal ? `${fmtNum(p.copied || 0)}/${fmtNum(p.folderTotal)}` : '', st.dryRun ? t('ui.dry') : ''].filter(Boolean).join(' · ');
    }
    const res = clear($('sy-result'));
    if (!running && st.result) {
      const r = st.result;
      if (r.error) res.append(h('div', { class: 'msgline bad', text: r.error }));
      else if (r.cancelled) res.append(h('div', { class: 'msgline warn', text: t('ui.sync.cancelled') }));
      else res.append(h('div', { class: `msgline ${r.ok ? 'ok' : 'warn'}`, text: (r.dryRun ? t('ui.sync.resultDry', { toCopy: fmtNum(r.totals.toCopy), source: fmtNum(r.totals.source) }) : t('ui.sync.resultOk', { copied: fmtNum(r.totals.copied), bytes: fmtBytes(r.totals.bytes) })) + (r.verification ? ` · ${r.verification.ok ? t('ui.sync.verified') : t('ui.sync.notVerified', { n: r.verification.missing })}` : '') }));
    }
  }
  function renderSyncGate() {
    const el = clear($('sy-gate'));
    if (!S.lic) return;
    const ids = [$('sy-src').value, $('sy-dst').value];
    const rows = ids.map(id => S.lic.accounts.find(a => a.id === id)).filter(Boolean);
    const com = rows.filter(r => !r.personal);
    if (!com.length) return el.append(h('span', { class: 'pill ok', text: t('ui.gate.free') }));
    const lic = com.map(r => r.gates.sincronizar).find(g => g.permitido);
    el.append(gatePill(lic || com[0].gates.sincronizar));
  }
  $('sy-src').addEventListener('change', renderSyncGate);
  $('sy-dst').addEventListener('change', renderSyncGate);
  $('sy-dry').addEventListener('change', renderSync);
  $('sy-run').onclick = async () => {
    const dry = $('sy-dry').checked;
    if (!dry) {
      const ok = await ask(t('ui.sync.run'), [t('ui.sync.confirm', { src: $('sy-src').selectedOptions[0].text, dst: $('sy-dst').selectedOptions[0].text })], t('ui.sync.run'));
      if (!ok) return;
    }
    try {
      clear($('sy-log'));
      const r = await api('POST', '/api/sync/start', { origen: $('sy-src').value, destino: $('sy-dst').value, dryRun: dry, folders: $('sy-folders').value, excludeFolders: $('sy-exclude').value });
      if (r.forcedDryRun) toast(r.gate.motivo, 'bad');
      S.sync = await api('GET', '/api/sync'); renderSync();
    } catch (e) { fail(e); }
  };
  $('sy-stop').onclick = () => api('POST', '/api/sync/stop', {}).catch(fail);

  // ================================================================ LICENCIAS (sin pestaña: verificación sin conexión y descarga tras iniciar sesión)
  async function loadLicenses() {
    try { S.lic = await api('GET', '/api/licenses'); if (S.tab === 'sincronizar') renderSyncGate(); } catch (e) { fail(e); }
  }
  // «Agregar clave» (pegar una clave NMT1) vive en Ajustes → Sistema, como opción avanzada
  $('lic-add').onclick = async () => {
    const key = $('lic-key').value.trim(), msg = clear($('lic-msg'));
    if (!key) return;
    $('lic-add').disabled = true;
    try {
      const r = await api('POST', '/api/licenses', { clave: key });
      $('lic-key').value = '';
      msg.append(h('div', { class: 'msgline ok', text: t('ui.lic.added', { cuenta: r.licencia.cuenta, tipo: t(`ui.lic.t.${r.licencia.tipo}`), date: fmtDate(r.licencia.vence) }) }));
      await refreshConfig(); loadLicenses();
    } catch (e) { msg.append(h('div', { class: 'msgline bad', text: e.message })); }
    $('lic-add').disabled = false;
  };
  $('lic-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lic-add').click(); });

  // ---- sesión con el servicio: SOLO para cuentas de dominio propio; compacta y en su sitio
  const authBoxes = [];
  const authState = () => (S.config && S.config.auth) || { signedIn: false, email: '', required: false };
  const sessionEmail = () => {
    const priv = (S.config.accounts || []).find(a => !a.personal);
    return (priv && priv.email) || S.draftEmail || authState().email || '';
  };
  function mountAuth(root, { onlyWhenNeeded }) {
    const B = { root, mode: 'login', email: '', pw: '', key: '', onlyWhenNeeded };
    authBoxes.push(B);
    B.go = (mode) => { B.mode = mode; B.render(true); const f = qs('input:not([type=hidden])', root); if (f && !f.value) f.focus(); };
    B.render = (force) => {
      const a = authState();
      // la sesión se pide solo si la persona pulsó «Iniciar sesión» en una cuenta comercial
      const hasCommercial = (S.config.accounts || []).some(x => !x.personal);
      root.hidden = a.signedIn || !(S.authOpen && hasCommercial);
      const key = `out:${B.mode}`;
      if (!force && key === B.key) return;
      B.key = key;
      clear(root);
      const msg = h('div', { class: 'authmsg', 'aria-live': 'polite' });
      const say = (kind, text) => clear(msg).append(h('div', { class: `msgline ${kind}`, text }));
      const run = (btn, fn) => async (e) => {
        e.preventDefault(); btn.disabled = true; clear(msg);
        try { await fn(); } catch (er) { say('bad', er.message); } finally { btn.disabled = false; }
      };
      const head = (pill) => h('div', { class: 'card-h' }, h('h2', { text: t('ui.auth.title') }), h('span', { class: 'spacer' }), pill);
      const input = (type, label, value, o = {}) => h('label', { class: 'fld' }, h('span', { text: label }), h('input', { type, value: value || '', autocomplete: o.ac || 'off', spellcheck: 'false', maxlength: o.max, inputmode: o.mode, required: true }));
      const val = (lbl) => qs('input', lbl).value.trim();
      const done = async (r) => {
        S.authOpen = false;
        await refreshConfig(); await loadLicenses(); // las licencias llegan solas tras iniciar sesión
        const l = r && r.licencias;
        if (l && !l.error) toast(t('ui.auth.synced', { n: l.imported }), 'ok'); else if (l && l.error) toast(l.error, 'bad');
      };

      const pill = h('span', { class: 'pill warn', text: t('ui.auth.signedOutPill') });
      if (B.mode === 'login') {
        const em = input('email', t('ui.auth.email'), B.email || sessionEmail(), { ac: 'username' });
        const pw = input('password', t('ui.auth.password'), '', { ac: 'current-password' });
        const go = h('button', { class: 'btn primary', type: 'submit', text: t('ui.auth.enter') });
        const forgot = h('button', { class: 'btn link', type: 'button', text: t('ui.auth.forgot'), onclick: () => { B.email = val(em); B.go('forgot'); } });
        const form = h('form', { class: 'authform', novalidate: true }, em, pw, go);
        form.onsubmit = run(go, async () => {
          B.email = val(em); B.pw = qs('input', pw).value;
          const r = await api('POST', '/api/auth/login', { email: B.email, password: B.pw });
          if (r.codigo) { B.go('code'); say('ok', t('ui.auth.codeSent', { email: B.email })); return; }
          B.pw = ''; await done(r);
        });
        root.append(head(pill), h('div', { class: 'hint', text: t('ui.auth.needed') }), form, h('div', { class: 'row' }, forgot, h('button', { class: 'btn link', type: 'button', text: t('ui.cancel'), onclick: () => { S.authOpen = false; renderAuthBoxes(); } })), msg);
      } else if (B.mode === 'code') {
        const code = input('text', t('ui.auth.code'), '', { ac: 'one-time-code', max: 6, mode: 'numeric' });
        const go = h('button', { class: 'btn primary', type: 'submit', text: t('ui.auth.confirm') });
        const form = h('form', { class: 'authform two', novalidate: true }, code, go);
        form.onsubmit = run(go, async () => { const r = await api('POST', '/api/auth/confirm', { email: B.email, code: val(code), password: B.pw }); B.pw = ''; B.mode = 'login'; await done(r); });
        root.append(head(pill), h('div', { class: 'hint', text: B.email }), form, h('div', { class: 'row' }, h('button', { class: 'btn link', type: 'button', text: t('ui.auth.back'), onclick: () => B.go('login') })), msg);
      } else if (B.mode === 'forgot') {
        const em = input('email', t('ui.auth.email'), B.email || sessionEmail(), { ac: 'username' });
        const go = h('button', { class: 'btn primary', type: 'submit', text: t('ui.auth.sendCode') });
        const form = h('form', { class: 'authform two', novalidate: true }, em, go);
        form.onsubmit = run(go, async () => { B.email = val(em); await api('POST', '/api/auth/reset-request', { email: B.email }); B.go('reset'); say('ok', t('ui.auth.codeSent', { email: B.email })); });
        root.append(head(pill), form, h('div', { class: 'row' }, h('button', { class: 'btn link', type: 'button', text: t('ui.auth.back'), onclick: () => B.go('login') })), msg);
      } else {
        const code = input('text', t('ui.auth.code'), '', { ac: 'one-time-code', max: 6, mode: 'numeric' });
        const pw = input('password', t('ui.auth.newPassword'), '', { ac: 'new-password' });
        const go = h('button', { class: 'btn primary', type: 'submit', text: t('ui.auth.change') });
        const form = h('form', { class: 'authform', novalidate: true }, code, pw, go);
        form.onsubmit = run(go, async () => { const r = await api('POST', '/api/auth/reset-confirm', { email: B.email, code: val(code), password: qs('input', pw).value }); B.mode = 'login'; await done(r); });
        root.append(head(pill), h('div', { class: 'hint', text: B.email }), form, h('div', { class: 'row' }, h('button', { class: 'btn link', type: 'button', text: t('ui.auth.back'), onclick: () => B.go('login') })), msg);
      }
    };
    return B;
  }
  const renderAuthBoxes = () => { for (const B of authBoxes) B.render(); };
  mountAuth($('auth-cuentas'), { onlyWhenNeeded: true });

  // ================================================================ AJUSTES
  async function loadSettings() { S.settings = await api('GET', '/api/settings'); return S.settings; }
  async function saveSettings(patch, msgEl) {
    try {
      const r = await api('POST', '/api/settings', { settings: patch, secrets: patch.__secrets });
      S.settings = r.view; await refreshConfig();
      if (msgEl) { clear(msgEl).append(h('div', { class: 'msgline ok', text: t('ui.saved') })); setTimeout(() => clear(msgEl), 3000); } else toast(t('ui.saved'), 'ok');
      return r;
    } catch (e) { if (msgEl) clear(msgEl).append(h('div', { class: 'msgline bad', text: e.message })); else fail(e); throw e; }
  }

  function renderSettings() {
    const st = S.settings; if (!st) return;
    const s = st.settings;
    // cliente de Google propio (Avanzado)
    if (document.activeElement !== $('g-client')) $('g-client').value = s.google.clientId || '';
    $('g-secret').placeholder = st.secrets.hasGoogleClientSecret ? '••••••••' : '';
    $('g-redirect').value = st.redirectUri;
    // IA
    $('ai-on').checked = !!s.llm.enabled || !!S.config.aiEnabled;
    $('sys-close').value = s.closeAction || 'ask';
    $('ai-url').value = s.ollamaUrl; $('ai-model').value = s.model;
    $('ai-think').checked = !!s.llm.think; $('ai-think-n').value = s.llm.thinkNumPredict;
    if (S.sec === 'ia') mountOllamaPanel($('ai-panel'), { getModel: () => $('ai-model').value.trim(), keepCustom: true, onSelect: (tag) => { $('ai-model').value = tag; } });
    // limpieza
    const c = s.cleaning;
    for (const k of ['daysBack', 'windowDays', 'dureza', 'band', 'fetchChunk', 'bodyMaxChars']) $(`c-${k}`).value = c[k];
    for (const k of ['protectConversations', 'autoUnsub', 'dryRun']) $(`c-${k}`).checked = !!c[k];
    $('c-myAddresses').value = (c.myAddresses || []).join(', ');
    // apariencia
    langControl($('ap-lang'), S.config.languageSetting ?? s.language ?? '', (v) => pickLanguage(v).catch(fail), true);
    modeControl($('ap-mode'), S.config.appearance.mode, (m) => saveAppearance({ mode: m }).then(renderSettings).catch(fail));
    accentControl($('ap-accent'), S.config.appearance.accent, (a) => saveAppearance({ accent: a }).then(renderSettings).catch(fail));
    // privacidad / avanzado
    $('tel-on').checked = !!s.telemetry.enabled;
    $('fil-on').checked = !!s.filtro.compartir;
    $('adv-service').value = s.service.url; $('adv-port').value = s.port;
    // sistema
    const info = clear($('sys-info'));
    const kv = (k, v) => h('div', { class: 'fld' }, h('span', { text: k }), h('code', { text: v, style: 'overflow-wrap:anywhere' }));
    info.append(kv(t('ui.sys.version'), st.version), kv(t('ui.sys.data'), st.dataDir), kv(t('ui.sys.logs'), st.logsDir), kv(t('ui.sys.secrets'), st.secrets.encrypted ? t('ui.sys.encrypted') : t('ui.sys.plain')));
    $('sys-issues').href = S.config.links.issues;
    if (S.sec === 'reglas') loadRules();
  }
  function renderAccountsTab() {
    renderAccountsList();
    if (!acctForm.api) acctForm.api = AcctForm($('acct-form'), {});
    renderAuthBoxes();
  }

  // ---- cuentas
  function renderAccountsList() {
    const box = clear($('acct-list')), list = S.config.accounts || [];
    if (!list.length) box.append(h('div', { class: 'empty', text: t('ui.noAccount') }));
    for (const a of list) {
      const active = a.id === S.config.activeAccount;
      box.append(h('div', { class: 'acct-item' },
        h('div', { class: 'who' }, a.email, h('div', { class: 's-mail', text: `${accountTypeLabel(a)} · ${a.personal ? t('ui.lic.personal') : t('ui.lic.commercial')}` })),
        h('span', { class: `pill ${a.ready ? 'ok' : 'warn'}`, text: a.ready ? t('ui.acct.ready') : t('ui.acct.incomplete') }),
        a.personal ? null : (S.config.auth && S.config.auth.signedIn
          ? h('button', { class: 'btn sm link', type: 'button', title: S.config.auth.email, text: t('ui.auth.logout'), onclick: async () => { try { await api('POST', '/api/auth/logout', {}); await refreshConfig(); } catch (e) { fail(e); } } })
          : h('button', { class: 'btn sm', type: 'button', text: t('ui.auth.signIn'), onclick: () => { S.authOpen = true; renderAuthBoxes(); const f = qs('#auth-cuentas input'); if (f && !f.value) f.focus(); } })),
        active ? h('span', { class: 'pill', text: t('ui.acct.active') }) : h('button', { class: 'btn sm', text: t('ui.acct.use'), onclick: async () => { try { S.config = await api('POST', '/api/accounts/active', { id: a.id }); S.senders.clear(); S.over.clear(); renderAll(); } catch (e) { fail(e); } } }),
        h('button', { class: 'btn sm', text: t('ui.edit'), onclick: () => { acctForm.api = AcctForm($('acct-form'), { edit: a }); $('acct-form-title').textContent = t('ui.acct.edit'); } }),
        h('button', { class: 'btn sm', text: t('ui.delete'), onclick: async () => {
          if (!await ask(t('ui.delete'), [a.email, t('ui.acct.deleteNote')], t('ui.delete'))) return;
          try { await api('POST', '/api/accounts/delete', { id: a.id }); await refreshConfig(); } catch (e) { fail(e); }
        } })));
    }
  }
  const accountTypeLabel = (a) => a.type === 'gmail-oauth' ? 'Gmail · Google' : a.type === 'gmail-password' ? 'Gmail · ' + t('ui.acct.appPassword') : (a.provider && a.provider !== 'custom' ? a.provider : 'IMAP');
  const acctForm = { api: null };

  // Formulario de cuenta (configurador y Ajustes). o: { edit?, onSaved?, makeActive?, compact? }
  function AcctForm(root, o = {}) {
    const presets = S.presets || (S.setup && S.setup.presets) || (S.settings && S.settings.presets) || {};
    const edit = o.edit || null;
    const isOauth = edit && edit.type === 'gmail-oauth';
    clear(root);
    const f = {};
    const field = (label, input) => h('label', { class: 'fld grow' }, h('span', { text: label }), input);
    f.preset = h('select', {}, Object.entries(presets).map(([k, p]) => h('option', { value: k, text: k === 'custom' ? t('ui.acct.other') : p.label })));
    f.email = h('input', { type: 'email', autocomplete: 'off', placeholder: 'nombre@dominio.com' });
    f.pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: edit ? t('ui.acct.passKeep') : '' });
    f.user = h('input', { type: 'text', autocomplete: 'off', placeholder: t('ui.acct.userPh') });
    f.ih = h('input', { type: 'text', placeholder: 'imap.dominio.com' }); f.ip = h('input', { type: 'number', min: 1, max: 65535 });
    f.is = h('input', { type: 'checkbox' });
    f.sh = h('input', { type: 'text', placeholder: 'smtp.dominio.com' }); f.sp = h('input', { type: 'number', min: 1, max: 65535 });
    f.ss = h('input', { type: 'checkbox' });
    f.inbox = h('input', { type: 'text' }); f.trash = h('input', { type: 'text', placeholder: t('ui.acct.trashAuto') });
    f.msg = h('div', { class: 'msgs' });
    f.hint = h('span', { class: 'pill sm', hidden: true });
    f.gmsg = h('div', { class: 'msgs' });
    f.gbtn = h('button', { type: 'button', class: 'gbtn' }, GLOGO(), h('span', { text: t('ui.google.signin') }));
    f.gor = h('div', { class: 'or', text: t('ui.acct.or') });
    f.gbox = h('div', { class: 'gbox' }, f.gbtn, h('div', { class: 'hint', text: t('ui.google.tickGmail') }), f.gmsg, f.gor);
    f.passLbl = h('span');
    const setPassLabel = () => {
      clear(f.passLbl).append(f.preset.value === 'gmail' ? t('ui.acct.appPassword') : t('ui.acct.password'));
      if (f.preset.value === 'gmail') f.passLbl.append(' ', h('a', { href: S.config.links.googleAppPasswords, target: '_blank', rel: 'noopener', text: '↗' }));
    };
    const fillPreset = () => {
      const p = presets[f.preset.value] || {};
      if (p.imap) { f.ih.value = p.imap.host; f.ip.value = p.imap.port; f.is.checked = !!p.imap.secure; }
      if (p.smtp) { f.sh.value = p.smtp.host; f.sp.value = p.smtp.port; f.ss.checked = !!p.smtp.secure; }
      if (!p.imap) { f.ih.value = ''; f.ip.value = 993; f.is.checked = true; f.sh.value = ''; f.sp.value = 465; f.ss.checked = true; }
      setPassLabel(); showGoogle();
    };
    const showGoogle = () => { f.gbox.hidden = !(f.preset.value === 'gmail' && !edit); };
    // personal (gratis, sin sesión) o dominio propio (pide sesión con el servicio)
    const classify = debounce(async () => {
      const em = f.email.value.trim();
      if (!/.+@.+\..+/.test(em)) { f.hint.hidden = true; if (!edit) { S.draftEmail = ''; S.draftPrivate = false; renderAuthBoxes(); } return; }
      try {
        const r = await api('GET', `/api/accounts/classify?email=${encodeURIComponent(em)}`);
        f.hint.hidden = !r.valid; f.hint.className = `pill sm ${r.personal ? 'ok' : 'warn'}`;
        f.hint.textContent = r.personal ? t('ui.acct.personalFree') : t('ui.acct.needsSession');
        S.draftEmail = r.valid && !r.personal ? em : ''; S.draftPrivate = r.valid && !r.personal; renderAuthBoxes();
      } catch (_) { /* sin pista */ }
    }, 250);
    f.email.addEventListener('input', classify);
    f.gbtn.onclick = async () => {
      clear(f.gmsg); f.gbtn.disabled = true;
      try {
        const r = await api('POST', '/api/oauth/google/start', { email: f.email.value.trim() || undefined });
        window.open(r.authUrl, '_blank', 'noopener'); S.googleWait = true;
        f.gmsg.append(h('div', { class: 'msgline warn', text: t('ui.google.waiting') }));
      } catch (e) { f.gmsg.append(h('div', { class: 'msgline warn', text: e.message })); f.pass.focus(); }
      f.gbtn.disabled = false;
    };
    f.preset.addEventListener('change', fillPreset);
    if (edit) {
      f.preset.value = edit.type === 'gmail-password' ? 'gmail' : (presets[edit.provider] ? edit.provider : 'custom');
      f.email.value = edit.email; f.user.value = edit.username || '';
      f.ih.value = edit.imap.host; f.ip.value = edit.imap.port; f.is.checked = !!edit.imap.secure;
      f.sh.value = edit.smtp.host; f.sp.value = edit.smtp.port; f.ss.checked = !!edit.smtp.secure;
      f.inbox.value = edit.inboxFolder; f.trash.value = edit.trashFolder || '';
      setPassLabel(); showGoogle(); classify();
    } else { f.preset.value = Object.keys(presets)[0] || 'gmail'; fillPreset(); f.inbox.value = 'INBOX'; S.draftEmail = ''; S.draftPrivate = false; }

    const payload = () => {
      const type = isOauth ? 'gmail-oauth' : f.preset.value === 'gmail' ? 'gmail-password' : 'imap';
      return {
        account: {
          id: edit ? edit.id : '', type, email: f.email.value.trim(), username: f.user.value.trim(), provider: f.preset.value,
          imap: { host: f.ih.value.trim(), port: parseInt(f.ip.value, 10) || 993, secure: f.is.checked },
          smtp: { host: f.sh.value.trim(), port: parseInt(f.sp.value, 10) || 465, secure: f.ss.checked },
          inboxFolder: f.inbox.value.trim() || 'INBOX', trashFolder: f.trash.value.trim(),
        },
        secrets: { password: f.pass.value }, makeActive: o.makeActive !== false && !edit,
      };
    };
    const show = (kind, text) => f.msg.append(h('div', { class: `msgline ${kind}`, text }));
    f.test = h('button', { class: 'btn', type: 'button', text: t('ui.acct.test') });
    f.save = h('button', { class: 'btn primary', type: 'button', text: edit ? t('ui.save') : t('ui.acct.add') });
    const runTest = async () => {
      clear(f.msg); f.test.disabled = true; f.test.textContent = t('ui.acct.testing');
      let ok = false;
      try {
        const r = await api('POST', '/api/accounts/test', payload());
        if (r.mail.ok) {
          ok = true;
          show('ok', `IMAP: ${t('ui.acct.connected')} · ${t('ui.acct.inboxCount', { n: fmtNum(r.mail.inboxCount) })}${r.mail.trash ? ` · ${t('ui.acct.trash')}: ${r.mail.trash}` : ''}`);
          if (r.mail.warning) show('warn', r.mail.warning);
          if (r.smtp && !r.smtp.ok) show('warn', `SMTP: ${r.smtp.error || t('ui.acct.smtpFail')}`);
        } else show('bad', `IMAP: ${r.mail.error}`);
      } catch (e) { show('bad', e.message); }
      f.test.disabled = false; f.test.textContent = t('ui.acct.test');
      return ok;
    };
    f.test.onclick = runTest;
    const doSave = async (skipTest) => {
      if (!skipTest && !(await runTest())) return null;
      try {
        const r = await api('POST', '/api/accounts/save', payload());
        await refreshConfig();
        toast(t('ui.saved'), 'ok');
        if (o.onSaved) o.onSaved(r); else { acctForm.api = AcctForm(root, {}); $('acct-form-title').textContent = t('ui.acct.new'); renderAccountsList(); }
        return r;
      } catch (e) { show('bad', e.message); return null; }
    };
    f.save.onclick = () => doSave(false);

    const adv = h('details', {}, h('summary', { text: t('ui.acct.server') }),
      h('div', { class: 'cols3 tight' },
        field('IMAP', f.ih), field(t('field.imapPort'), f.ip), h('label', { class: 'chk' }, f.is, 'SSL/TLS'),
        field('SMTP', f.sh), field(t('field.smtpPort'), f.sp), h('label', { class: 'chk' }, f.ss, 'SSL/TLS'),
        field(t('ui.acct.user'), f.user), field(t('ui.acct.inbox'), f.inbox), field(t('ui.acct.trash'), f.trash)));
    root.append(h('div', { class: 'acctform' },
      h('div', { class: 'cols2' }, isOauth ? null : field(t('ui.acct.provider'), f.preset), h('label', { class: 'fld grow' }, h('span', {}, t('ui.acct.email'), ' ', f.hint), f.email)),
      isOauth ? null : f.gbox,
      isOauth ? null : h('div', { class: 'cols2' }, h('label', { class: 'fld grow' }, f.passLbl, f.pass)),
      isOauth ? h('div', { class: 'cols2' }, field(t('ui.acct.inbox'), f.inbox), field(t('ui.acct.trash'), f.trash)) : adv,
      h('div', { class: 'row', style: 'margin-top:0' }, f.test, f.save, edit ? h('button', { class: 'btn link', type: 'button', text: t('ui.cancel'), onclick: () => { acctForm.api = AcctForm(root, {}); $('acct-form-title').textContent = t('ui.acct.new'); } }) : null),
      f.msg));
    return { f, doSave, payload, isEmpty: () => !f.email.value.trim() && !f.pass.value };
  }

  // ---- cliente de Google propio (Ajustes → Avanzado) y copiar la URI de redirección
  $('g-copy').onclick = () => copyText($('g-redirect').value);
  const saveGoogleClient = debounce(async () => {
    try {
      const clientId = $('g-client').value.trim(), secret = $('g-secret').value.trim();
      await saveSettings({ google: { clientId }, __secrets: secret ? { googleClientSecret: secret } : undefined });
      $('g-secret').value = '';
    } catch (_) { /* saveSettings ya avisó */ }
  }, 600);
  $('g-client').addEventListener('input', saveGoogleClient);
  $('g-secret').addEventListener('input', saveGoogleClient);

  // ---- IA
  $('ai-on').addEventListener('change', async (e) => { try { await api('POST', '/api/setup/prefs', { ai: e.target.checked }); await refreshConfig(); } catch (er) { fail(er); } });
  $('ai-check').onclick = async () => {
    const msg = clear($('ai-msg'));
    try {
      const r = await api('POST', '/api/llm/check', { ollamaUrl: $('ai-url').value.trim(), model: $('ai-model').value.trim() });
      msg.append(h('div', { class: `msgline ${r.ok ? 'ok' : 'warn'}`, text: r.ok ? t('ui.ai.ready', { v: r.version }) : r.error }));
    } catch (e) { msg.append(h('div', { class: 'msgline bad', text: e.message })); }
  };
  $('ai-test').onclick = async () => {
    const msg = clear($('ai-msg')); $('ai-test').disabled = true; msg.append(h('div', { class: 'msgline warn', text: t('ui.ai.testing') }));
    try {
      const r = await api('POST', '/api/llm/test', { ollamaUrl: $('ai-url').value.trim(), model: $('ai-model').value.trim(), think: $('ai-think').checked, thinkNumPredict: $('ai-think-n').value });
      clear(msg);
      for (const x of r.results || []) msg.append(h('div', { class: 'msgline', text: `${x.name}: ${x.score ?? '?'} (${t('ui.ai.expect')} ${x.expect}) · ${x.ms} ms` }));
      if (r.think) msg.append(h('div', { class: `msgline ${r.think.ok ? 'ok' : 'warn'}`, text: r.think.ok ? `${t('ui.ai.think')}: ${r.think.score ?? '?'} · ${r.think.ms} ms` : r.think.error }));
      msg.append(h('div', { class: `msgline ${r.ok ? 'ok' : 'bad'}`, text: r.ok ? t('ui.ai.testOk') : (r.error || t('ui.ai.testFail')) }));
    } catch (e) { clear(msg).append(h('div', { class: 'msgline bad', text: e.message })); }
    $('ai-test').disabled = false;
  };
  $('ai-save').onclick = () => {
    const llmCfg = { ...S.settings.settings.llm, think: $('ai-think').checked, thinkNumPredict: parseInt($('ai-think-n').value, 10) || 2048, enabled: $('ai-on').checked };
    saveSettings({ ollamaUrl: $('ai-url').value.trim(), model: $('ai-model').value.trim(), llm: llmCfg }, $('ai-msg')).catch(() => {});
  };
  $('ai-url').addEventListener('change', async () => {
    try { const r = await api('GET', `/api/llm/models?url=${encodeURIComponent($('ai-url').value.trim())}`); const dl = clear($('ai-models')); for (const m of r.models || []) dl.append(h('option', { value: m })); } catch (_) { /* sin Ollama */ }
  });

  // ---- limpieza, reglas, avanzado, privacidad
  $('c-save').onclick = () => {
    const c = { ...S.settings.settings.cleaning };
    for (const k of ['daysBack', 'windowDays', 'dureza', 'band', 'fetchChunk', 'bodyMaxChars']) c[k] = parseInt($(`c-${k}`).value, 10);
    for (const k of ['protectConversations', 'autoUnsub', 'dryRun']) c[k] = $(`c-${k}`).checked;
    c.myAddresses = $('c-myAddresses').value.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    saveSettings({ cleaning: c }).then(() => { initCleanControls(); }).catch(() => {});
  };
  // remitentes con regla guardada («Nunca eliminar» desde Limpiar): se listan aquí y se pueden quitar
  async function loadSenderRules() {
    try {
      const { list } = await api('GET', '/api/sender-rules'), box = clear($('r-senders-list'));
      $('r-senders-n').textContent = fmtNum(list.length);
      if (!list.length) box.append(h('div', { class: 'hint', text: t('ui.rules.sendersNone') }));
      for (const r of list) box.append(h('div', { class: 'acct-item' },
        h('div', { class: 'who', text: r.email }),
        h('span', { class: `pill ${r.rule === 'protect' ? 'ok' : 'warn'}`, text: r.rule === 'protect' ? t('ui.rules.never') : t('ui.rules.always') }),
        h('button', { class: 'btn sm', type: 'button', text: t('ui.rules.remove'), onclick: async () => {
          try { await api('POST', '/api/sender-rule', { email: r.email, rule: 'none' }); const s = S.senders.get(r.email); if (s) { s.rule = null; renderSenders(); } loadSenderRules(); } catch (e) { fail(e); }
        } })));
    } catch (e) { fail(e); }
  }
  async function loadRules() {
    loadSenderRules();
    try {
      const r = await api('GET', '/api/rules');
      $('r-keep').value = r.keepOverride; $('r-subject').value = r.subject; $('r-from').value = r.from; $('r-body').value = r.body; $('r-prompt').value = r.llmPrompt;
    } catch (e) { fail(e); }
  }
  $('r-save').onclick = async () => {
    try { await api('POST', '/api/rules', { keepOverride: $('r-keep').value, subject: $('r-subject').value, from: $('r-from').value, body: $('r-body').value, llmPrompt: $('r-prompt').value }); toast(t('ui.saved'), 'ok'); } catch (e) { fail(e); }
  };
  $('r-reset').onclick = async () => {
    if (!await ask(t('ui.rules.reset'), [t('ui.rules.resetNote')], t('ui.rules.reset'))) return;
    try { await api('POST', '/api/rules/reset', {}); await loadRules(); toast(t('ui.saved'), 'ok'); } catch (e) { fail(e); }
  };
  $('adv-save').onclick = () => saveSettings({ service: { url: $('adv-service').value.trim() }, port: parseInt($('adv-port').value, 10) }, $('adv-msg')).then((r) => {
    if (r && r.restartNeeded) clear($('adv-msg')).append(h('div', { class: 'msgline warn', text: t('ui.adv.restart') }));
  }).catch(() => {});
  $('fil-on').addEventListener('change', (e) => saveSettings({ filtro: { compartir: e.target.checked } }).catch(() => {}));
  $('tel-on').addEventListener('change', (e) => saveSettings({ telemetry: { enabled: e.target.checked } }).catch(() => {}));
  $('sys-close').onchange = (e) => api('POST', '/api/prefs/close', { closeAction: e.target.value }).then(() => toast(t('ui.saved'), 'ok')).catch(fail);
  $('upd-auto').addEventListener('change', (e) => api('POST', '/api/prefs/updates', { auto: e.target.checked }).then((r) => { upd = r.update; renderUpdate(); toast(t('ui.saved'), 'ok'); }).catch(fail));
  $('upd-check').onclick = () => api('POST', '/api/update/check', {}).then((u) => { upd = u; renderUpdate(); }).catch(fail);
  $('sys-logs').onclick = () => api('POST', '/api/system/open-logs', {}).catch(fail);
  $('sys-setup').onclick = () => Wizard.open();

  // ================================================================ OLLAMA (panel compartido)
  const ollamaPanels = new Set();
  const gbText = (b) => (b / 1e9).toFixed(1);
  // Una sola barra para todo: verificar, instalar Ollama, bajar el modelo, configurarlo.
  function progressOf(ev) {
    if (!ev) return null;
    if (ev.task === 'install') {
      if (ev.phase === 'download') return { pct: ev.pct, label: t('ui.ai.dlOllama', { pct: ev.pct ?? '…' }) };
      if (ev.phase === 'run') return { pct: ev.pct, label: t('ui.ai.installingOllama') };
      return { pct: null, label: t('ui.ai.starting') };
    }
    if (ev.task === 'start') return { pct: null, label: t('ui.ai.starting') };
    if (ev.phase === 'configure') return { pct: 100, label: t('ui.ai.configuring') };
    if (ev.pct != null && ev.total) return { pct: ev.pct, label: t('ui.ai.dlModel', { pct: ev.pct, done: gbText(ev.completed), total: gbText(ev.total) }) };
    return { pct: ev.pct, label: t('ui.ai.dlModelWait') };
  }
  function hardwareText(hw) {
    if (!hw) return '';
    const ram = `${Math.round(hw.ramBytes / 1024 ** 3)} GB RAM`;
    const g = hw.gpu;
    return `${ram} · ${g ? `${g.vendor || g.name} ${Math.round(g.vramBytes / 1024 ** 3)} GB` : t('ui.ai.noGpu')}`;
  }
  // o: { getModel(), onSelect(tag), onChange(st) }
  function mountOllamaPanel(root, o) {
    for (const old of [...ollamaPanels]) if (old.root === root) ollamaPanels.delete(old);
    const P = { root, o, st: null, ev: null, checking: true, sel: null, autoStarted: false, manual: null };
    ollamaPanels.add(P);
    P.busy = () => !!(P.ev && !P.ev.done);
    P.refresh = async () => {
      try { P.st = await api('GET', '/api/setup/ollama'); } catch (e) { P.st = null; }
      P.checking = false;
      if (P.st && !P.sel) {
        const cur = o.getModel ? o.getModel() : P.st.model;
        const hit = P.st.tiers.find(x => x.tag === cur);
        P.sel = hit ? hit.tag : (P.st.tiers.find(x => x.id === P.st.recommended.id) || P.st.tiers[0]).tag;
        if (!hit && o.keepCustom && cur) P.sel = null;
        if (P.sel && o.onSelect) o.onSelect(P.sel);
      }
      // instalado pero cerrado: se arranca solo, sin pedirle nada al usuario
      if (P.st && P.st.installed && !P.st.running && !P.autoStarted && !P.busy()) {
        P.autoStarted = true;
        try { await api('POST', '/api/setup/ollama/start', {}); P.ev = { task: 'start', phase: 'start' }; } catch (e) { fail(e); }
      }
      P.render(); if (o.onChange) o.onChange(P.st);
    };
    P.render = () => {
      clear(root);
      const st = P.st;
      if (!st) { if (P.checking) root.append(P.progressBox({ pct: null, label: t('ui.ai.verifying') })); return; }
      const ev = P.ev, busy = P.busy(), failed = ev && ev.done && ev.error;
      const notFound = !st.installed && !st.running;
      const head = h('div', { class: 'row', style: 'margin-top:0' },
        h('span', { class: `dot ${st.running ? 'on' : notFound ? 'off' : ''}` }),
        h('b', { text: st.running ? t('ui.ai.detected', { v: st.version || '' }) : notFound ? t('ui.ai.missing') : t('ui.ai.installedNotRunning') }),
        h('span', { class: 'spacer' }));
      if (notFound && !(busy && ev.task === 'install')) head.append(h('button', { class: 'btn primary', text: t('ui.ai.install'), onclick: () => P.doInstall() }));
      root.append(head);
      if (st.running || P.sel) {
        const grid = h('div', { class: 'tiers', role: 'radiogroup' });
        for (const x of st.tiers) {
          const on = P.sel === x.tag, rec = st.recommended.id === x.id;
          const card = h('button', { type: 'button', class: `tier${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false', disabled: busy,
            onclick: () => { P.sel = x.tag; if (o.onSelect) o.onSelect(x.tag); P.render(); if (o.onChange) o.onChange(P.st); } },
            h('b', { text: { basic: t('ui.ai.tier.basic'), medium: t('ui.ai.tier.medium'), large: t('ui.ai.tier.large') }[x.id] || x.id }), h('span', { class: 'sz', text: `${x.tag} · ${gbText(x.sizeBytes)} GB` }),
            h('span', { class: 'bdg' }, x.installed ? h('em', { class: 'ok', text: t('ui.ai.installed') }) : '', rec ? h('em', { class: 'rec', text: t('ui.ai.recommended') }) : ''));
          grid.append(card);
        }
        root.append(grid, h('small', { class: 'hw', text: hardwareText(st.hardware) + (st.recommended.warn ? ` · ${t('ui.ai.lowWarn')}` : '') }));
      }
      const sel = st.tiers.find(x => x.tag === P.sel);
      if (busy) {
        const pr = progressOf(ev);
        root.append(P.progressBox(pr, h('button', { class: 'btn sm', text: t('ui.ai.cancel'), onclick: () => api('POST', '/api/setup/ollama/cancel', {}).catch(fail) })));
      } else if (failed) {
        root.append(h('div', { class: 'prog-row' }, h('div', { class: `msgline ${ev.cancelled ? 'warn' : 'bad'}`, style: 'flex:1', text: ev.cancelled ? t('ui.ai.cancelled') : ev.error }),
          h('button', { class: 'btn sm', text: t('ui.ai.retry'), onclick: () => P.retry() })));
      } else if (st.running && sel) {
        if (sel.installed) root.append(h('div', { class: 'prog-row' }, h('div', { class: 'msgline ok', style: 'flex:1', text: ev && ev.phase === 'done' ? t('ui.ai.done') : t('ui.ai.modelReady', { m: sel.tag }) })));
        else root.append(h('div', { class: 'prog-row' }, h('small', { style: 'flex:1', text: t('ui.ai.modelMissing', { m: sel.tag }) }), h('button', { class: 'btn primary sm', text: t('ui.ai.use1'), onclick: () => P.doPull(sel.tag) })));
      }
      if (P.manual) root.append(h('div', { style: 'display:grid;gap:6px' }, h('small', { text: t('ui.ai.manual') }),
        h('div', { class: 'cmd' }, h('code', { text: P.manual }), h('button', { class: 'btn sm', text: t('ui.copy'), onclick: () => copyText(P.manual) })),
        h('button', { class: 'btn sm', style: 'justify-self:start', text: t('ui.ai.recheck'), onclick: () => P.refresh() })));
    };
    P.progressBox = (pr, extra) => h('div', { class: 'prog-row' },
      h('div', { style: 'flex:1;display:grid;gap:4px;min-width:0' }, h('div', { class: 'bar' }, h('i', { style: `width:${pr.pct ?? 8}%` })), h('small', { text: pr.label })), extra || '');
    P.retry = () => {
      const k = P.ev && P.ev.task; P.ev = null;
      if (k === 'pull' && P.sel) return P.doPull(P.sel);
      if (k === 'install') return P.doInstall();
      P.autoStarted = false; return P.refresh();
    };
    P.doInstall = async () => {
      try {
        const r = await api('POST', '/api/setup/ollama/install', {});
        if (r.manual) { P.manual = r.command || `${r.url}`; } else { P.ev = { task: 'install', phase: 'download', pct: 0 }; P.manual = null; }
        P.render(); if (o.onChange) o.onChange(P.st);
      } catch (e) { fail(e); }
    };
    P.doPull = async (model) => {
      try { await api('POST', '/api/setup/ollama/pull', { model }); P.ev = { task: 'pull', phase: 'pull', pct: 0 }; P.render(); if (o.onChange) o.onChange(P.st); } catch (e) { fail(e); }
    };
    P.event = (ev) => {
      P.ev = ev;
      if (ev.done) { P.refresh(); return; }
      P.render(); if (o.onChange) o.onChange(P.st);
    };
    P.render();
    P.refresh();
    return P;
  }
  function onSetupEvent(ev) {
    for (const P of [...ollamaPanels]) { if (!P.root.isConnected) { ollamaPanels.delete(P); continue; } P.event(ev); }
  }

  // ================================================================ CONFIGURADOR
  const Wizard = {
    step: 1, STEPS: ['ui.wiz.s1', 'ui.wiz.s2', 'ui.wiz.s3', 'ui.wiz.s4'], panel: null, form: null, aiState: null,
    async open() {
      this.step = 1;
      S.setup = await api('GET', '/api/setup');
      $('wizard').hidden = false; document.body.style.overflow = 'hidden';
      this.render();
    },
    close() { $('wizard').hidden = true; document.body.style.overflow = ''; this.panel = null; },
    render() {
      const steps = clear($('wiz-steps'));
      this.STEPS.forEach((k, i) => steps.append(h('li', { class: i + 1 === this.step ? 'on' : i + 1 < this.step ? 'done' : '' }, h('b', { text: i + 1 < this.step ? '✓' : i + 1 }), h('span', { text: t(k) }))));
      const body = clear($('wiz-body')), foot = clear($('wiz-foot'));
      const next = (label, fn, cls = 'primary') => h('button', { class: `btn ${cls}`, id: 'wiz-next', text: label, onclick: fn });
      const back = () => h('button', { class: 'btn', text: t('ui.back'), onclick: () => { this.step--; this.render(); } });
      body.append(h('h2', { text: t(this.STEPS[this.step - 1]), style: 'font-size:18px' }));
      if (this.step === 1) {
        const lang = h('div'), mode = h('div'), acc = h('div');
        body.append(h('div', { class: 'wiz-row' }, h('span', { class: 'lbl', text: t('ui.ap.language') }), lang),
          h('div', { class: 'wiz-row' }, h('span', { class: 'lbl', text: t('ui.ap.mode') }), mode),
          h('div', { class: 'wiz-row' }, h('span', { class: 'lbl', text: t('ui.ap.accent') }), acc));
        const draw = () => {
          langControl(lang, S.config.language, (v) => pickLanguage(v).catch(fail), false);
          modeControl(mode, S.config.appearance.mode, (m) => saveAppearance({ mode: m }).then(draw).catch(fail));
          accentControl(acc, S.config.appearance.accent, (a) => saveAppearance({ accent: a }).then(draw).catch(fail));
        };
        draw();
        foot.append(next(t('ui.next'), () => { this.step = 2; this.render(); }));
      } else if (this.step === 2) {
        const panelBox = h('div');
        body.append(panelBox);
        const nextBtn = next(t('ui.next'), async () => {
          try {
            const P = this.panel, st = P && P.st, sel = st && st.tiers.find(x => x.tag === P.sel);
            const on = !!(st && st.running && sel && sel.installed);
            await api('POST', '/api/setup/prefs', on ? { ai: true, model: sel.tag } : { ai: false });
            S.config.aiEnabled = on; this.step = 3; this.render();
          } catch (e) { fail(e); }
        });
        const skip = h('button', { class: 'btn', text: t('ui.ai.skip'), onclick: async () => { try { if (this.panel && this.panel.busy()) await api('POST', '/api/setup/ollama/cancel', {}).catch(() => {}); await api('POST', '/api/setup/prefs', { ai: false }); S.config.aiEnabled = false; this.step = 3; this.render(); } catch (e) { fail(e); } } });
        this.panel = mountOllamaPanel(panelBox, {
          getModel: () => null, // en el configurador manda la recomendación para este equipo
          onChange: (st) => { const P = this.panel; const sel = P && st && st.tiers.find(x => x.tag === P.sel); nextBtn.disabled = !!(P && P.busy()) || !(st && st.running && sel && sel.installed); },
        });
        nextBtn.disabled = true;
        foot.append(back(), nextBtn, h('span', { class: 'spacer' }), skip);
      } else if (this.step === 3) {
        const sw = h('input', { type: 'checkbox', id: 'wiz-tel' }); sw.checked = !!S.setup.telemetry;
        sw.addEventListener('change', () => api('POST', '/api/setup/prefs', { telemetry: sw.checked }).then(() => { S.setup.telemetry = sw.checked; }).catch(fail));
        body.append(h('label', { class: 'switch' }, sw, h('i'), h('span', { text: t('ui.tel.label') })), h('div', { class: 'msgline warn', text: t('ui.tel.what') }));
        foot.append(back(), next(t('ui.next'), () => { this.step = 4; this.render(); }));
      } else {
        const box = h('div');
        body.append(box);
        this.form = AcctForm(box, { onSaved: () => {}, makeActive: true });
        const finish = async () => {
          try {
            if (!this.form.isEmpty()) { const r = await this.form.doSave(false); if (!r) return; }
            S.config = await api('POST', '/api/setup/finish', {});
            this.close(); renderAll(); showTab('cuentas');
          } catch (e) { fail(e); }
        };
        foot.append(back(), next(t('ui.wiz.finish'), finish), h('span', { class: 'spacer' }), h('button', { class: 'btn', text: t('ui.wiz.skipAccount'), onclick: async () => { try { S.config = await api('POST', '/api/setup/finish', {}); this.close(); renderAll(); showTab('cuentas'); } catch (e) { fail(e); } } }));
        // el formulario de cuenta guarda dentro; al terminar el botón principal ya lo hace
        this.form.f.save.hidden = true;
      }
    },
  };

  // ================================================================ SSE y arranque
  function onEvent(m) {
    if (m.t === 'line') {
      addLog($('cl-log'), m.text, m.kind, m.ts);
      if (m.lane === 'heur') termLine($('feed-cpu'), m.text, m.kind, m.ts);
      else if (m.lane === 'llm') termLine($('feed-gpu'), m.text, m.kind, m.ts);
    } else if (m.t === 'metrics') {
      onMetrics(m);
    } else if (m.t === 'phase') {
      S.job = Object.assign(S.job || {}, { phase: m.phase }); renderPhase();
    } else if (m.t === 'scanstart') {
      S.senders = new Map(m.senders.map(s => [s.email, s])); renderClean();
    } else if (m.t === 'senders') {
      for (const s of m.list) { const prev = S.senders.get(s.email); S.senders.set(s.email, prev ? Object.assign(prev, s) : s); }
      renderSendersSoon(); $('st-senders').textContent = fmtNum(S.senders.size);
    } else if (m.t === 'scandone') {
      S.scanDone = true; renderClean();
    } else if (m.t === 'progress') {
      const wasRunning = S.job && S.job.running;
      S.job = m.job; renderHeader(); renderClean();
      if (wasRunning && !m.job.running) refreshConfig();
    } else if (m.t === 'config') {
      S.config = m.config; renderAll();
    } else if (m.t === 'setup') {
      onSetupEvent(m);
    } else if (m.t === 'sync') {
      onSync(m);
    } else if (m.t === 'google') {
      onGoogle(m);
    } else if (m.t === 'update') {
      upd = m.update; renderUpdate();
    }
  }
  // ---- actualizaciones: aviso flotante («Versión X lista · Reiniciar ahora» / «Versión X disponible · Descargar») y línea de Ajustes
  let upd = null, updLater = '';
  function renderUpdate() {
    const box = $('upd-banner'); if (!box) return;
    const u = upd;
    const show = u && u.banner && updLater !== `${u.banner}${u.version}`;
    box.hidden = !show; clear(box);
    if (show) {
      const later = h('button', { class: 'btn', text: t('ui.upd.b.later'), onclick: () => { updLater = `${u.banner}${u.version}`; renderUpdate(); } });
      if (u.banner === 'ready') {
        const wait = !!busy(); // el servidor vuelve a comprobarlo (también la descarga de modelos)
        const go = h('button', { class: 'btn primary', text: t('ui.upd.b.restart'), title: wait ? t('ui.upd.b.wait') : '' });
        go.disabled = wait;
        go.onclick = () => api('POST', '/api/update/restart', {}).catch(fail);
        box.append(h('span', { class: 'msg', text: t('ui.upd.b.ready', { v: u.version }) }), go, later);
      } else if (u.url) {
        box.append(h('span', { class: 'msg', text: t('ui.upd.b.avail', { v: u.version }) }), h('a', { class: 'btn primary', href: u.url, target: '_blank', rel: 'noopener', text: t('ui.upd.b.download') }), later);
      } else { box.hidden = true; }
    }
    const line = $('upd-line'); if (!line) return;
    $('upd-auto').checked = !u || u.auto;
    $('upd-check').disabled = !!u && (!u.supported || u.phase === 'checking');
    const v = u ? u.version : '', cur = u ? u.current : S.config.version;
    let msg = '';
    if (u && !u.supported) msg = t('ui.upd.r.dev');
    else if (u && u.phase === 'checking') msg = t('ui.upd.r.checking');
    else if (u && u.phase === 'uptodate') msg = t('ui.upd.r.uptodate');
    else if (u && u.phase === 'downloading') msg = t('ui.upd.r.downloading', { v, p: u.percent });
    else if (u && u.phase === 'downloaded') msg = t('ui.upd.r.ready', { v });
    else if (u && u.phase === 'available') msg = t('ui.upd.r.available', { v });
    else if (u && u.phase === 'error') msg = t('ui.upd.r.error');
    line.textContent = `${t('ui.upd.current', { v: cur })}${msg ? ` · ${msg}` : ''}`;
  }
  function onGoogle(m) {
    S.googleWait = false;
    if (!m.ok) { toast(m.error || t('oauth.fail'), 'bad'); return; }
    toast(t('ui.google.done', { email: m.email }), m.test && !m.test.ok ? 'bad' : 'ok');
    if (m.test && !m.test.ok) toast(m.test.error, 'bad');
    acctForm.api = AcctForm($('acct-form'), {}); $('acct-form-title').textContent = t('ui.acct.new');
    refreshConfig().then(() => { if (S.tab === 'cuentas') renderAccountsTab(); }).catch(fail);
  }
  const syKind = (txt) => /error|fall[óo]|fail|perd|rechaz|no se pudo/i.test(txt) ? 'delete' : /^\s*\[?SIM|simul|dry/i.test(txt) ? 'dry' : /ok\b|verific|listo|termin/i.test(txt) ? 'keep' : 'info';
  function onSync(m) {
    if (m.tipo === 'linea') termLine($('sy-log'), m.text, syKind(m.text), m.ts);
    else if (m.tipo === 'inicio') { clear($('sy-log')); sy.last = null; sy.peak = 0; sy.lastText = ''; S.sync = Object.assign(S.sync || {}, { running: true, dryRun: m.dryRun, result: null, progress: null }); renderSync(); renderHeader(); }
    else if (m.tipo === 'progreso') {
      const p = m.progress || {};
      S.sync = Object.assign(S.sync || {}, { progress: p }); renderSync();
      const line = [p.folder, p.folderTotal ? `${fmtNum(p.copied || 0)}/${fmtNum(p.folderTotal)}` : '', p.bytes != null ? fmtBytes(p.bytes) : ''].filter(Boolean).join(' · ');
      if (line && line !== sy.lastText) { sy.lastText = line; termLine($('sy-log'), line, 'info', new Date().toTimeString().slice(0, 8)); }
      if (p.bytes != null) netRate(p.bytes);
    }
    else if (m.tipo === 'fin') { netIdle(); api('GET', '/api/sync').then((v) => { S.sync = v; renderSync(); renderHeader(); loadLicenses(); }).catch(fail); }
  }
  function connectStream() {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (_) { /* línea rota */ } };
  }
  async function refreshConfig() {
    const prevLang = S.config && S.config.language;
    S.config = await api('GET', '/api/config');
    if (prevLang && S.config.language !== prevLang) await setLang(S.config.language);
    renderAll();
  }
  function initCleanControls() {
    const c = S.config.cleaning;
    if (!busy()) {
      cl.dureza = c.dureza; $('cl-dureza').value = c.dureza; $('cl-dureza-v').textContent = c.dureza;
      $('cl-dry').checked = !!c.dryRun; $('cl-unsub').checked = !!c.autoUnsub;
      const sel = $('cl-range'); const opt = [...sel.options].find(o => parseInt(o.value, 10) === c.daysBack);
      if (opt) sel.value = opt.value;
    }
  }
  function renderAll() {
    if (!S.config) return;
    applyAppearance(S.config.appearance);
    renderTabs(); renderHeader(); renderClean();
    if (S.tab === 'sincronizar') renderSync();
    if (S.tab === 'cuentas') renderAccountsList();
    renderAuthBoxes();
  }
  const rerenderStatic = () => {
    renderTabs(); renderHeader(); renderClean(); renderSync();
    if (S.tab === 'cuentas') { acctForm.api = null; renderAccountsTab(); }
    for (const B of authBoxes) B.render(true);
  };

  async function boot() {
    try {
      S.config = await api('GET', '/api/config');
      await setLang(S.config.language);
      S.job = S.config.job || { running: false };
      S.sync = S.config.sync;
      try { S.lic = await api('GET', '/api/licenses'); } catch (_) { /* sin licencias */ }
      initCleanControls(); $('sy-dry').checked = true;
      if (S.config.auth.signedIn) api('POST', '/api/licenses/sync', {}).then(() => refreshConfig()).catch(() => { /* sin red: valen las claves guardadas */ });
      // si había un escaneo hecho, el servidor lo conserva: se recupera
      try { const r = await api('GET', '/api/senders'); if (r.senders.length) { S.senders = new Map(r.senders.map(s => [s.email, s])); S.scanDone = true; } } catch (_) { /* nada */ }
      try { S.presets = (await api('GET', '/api/accounts')).presets; } catch (_) { /* sin plantillas */ }
      setCleanView('senders');
      renderAll(); showTab(tabEnabled('limpiar') ? 'limpiar' : 'cuentas'); renderSync();
      try { upd = await api('GET', '/api/update'); renderUpdate(); } catch (_) { /* sin actualizaciones */ }
      connectStream();
      if (!S.config.setup.done) await Wizard.open();
    } catch (e) {
      document.body.append(h('pre', { class: 'log', style: 'margin:20px', text: e.message }));
    }
  }
  window.addEventListener('error', (e) => { try { fetch('/api/system/ui-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: e.message, source: e.filename, line: e.lineno }) }); } catch (_) { /* nada */ } });
  boot();
})();
