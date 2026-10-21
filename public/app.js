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

  // ---------------------------------------------------------------- estado
  const S = { config: null, settings: null, lic: null, setup: null, senders: new Map(), over: new Map(), job: { running: false }, sync: null, scanDone: false, tab: 'limpiar', sec: 'cuentas' };
  const acctById = (id) => (S.config.accounts || []).find(a => a.id === id);
  const activeAcct = () => acctById(S.config.activeAccount) || (S.config.accounts || [])[0] || null;
  const busy = () => (S.job && S.job.running) || (S.sync && S.sync.running);

  // ---------------------------------------------------------------- pestañas
  function showTab(name, sec) {
    S.tab = name;
    for (const b of qsa('.tab-btn')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const s of qsa('main > .tab')) s.classList.toggle('on', s.id === `tab-${name}`);
    if (name === 'licencias') loadLicenses();
    if (name === 'ajustes') showSec(sec || S.sec);
    if (name === 'sincronizar') renderSync();
  }
  function showSec(name) {
    S.sec = name;
    for (const b of qsa('#set-nav button')) b.setAttribute('aria-selected', String(b.dataset.sec === name));
    for (const s of qsa('.set-sec')) s.classList.toggle('on', s.id === `sec-${name}`);
    loadSettings().then(renderSettings).catch(fail);
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) { const [tab, sec] = g.dataset.goto.split(':'); showTab(tab, sec); }
  });
  for (const b of qsa('.tab-btn')) b.addEventListener('click', () => showTab(b.dataset.tab));
  for (const b of qsa('#set-nav button')) b.addEventListener('click', () => showSec(b.dataset.sec));

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
  }
  $('acctSel').addEventListener('change', async (e) => {
    try { S.config = await api('POST', '/api/accounts/active', { id: e.target.value }); S.senders.clear(); S.over.clear(); S.scanDone = false; renderAll(); }
    catch (er) { fail(er); renderHeader(); }
  });

  // ---------------------------------------------------------------- licencias: avisos
  function gatePill(gate, tipo) {
    if (!gate) return h('span');
    if (gate.personal) return h('span', { class: 'pill ok', text: t('ui.gate.free') });
    if (gate.permitido) return h('span', { class: 'pill ok', text: t('ui.gate.licensed', { date: fmtDate(gate.vence) }) });
    const price = (S.config.prices || {})[tipo];
    return h('span', { class: 'pill warn' }, t('ui.gate.dryOnly'), ' · ',
      h('a', { href: gate.comprar, target: '_blank', rel: 'noopener', text: t('ui.gate.buy', { price: `${S.config.prices.currency} ${price}` }) }));
  }

  // ================================================================ LIMPIAR
  const cl = { dureza: 50 };
  const dureza = () => cl.dureza;
  function effDecision(s) {
    if (S.over.has(s.email)) return S.over.get(s.email);
    if (s.rule === 'delete') return 'delete';
    if (s.rule === 'protect' || s.protected) return 'keep';
    if (s.score == null) return 'keep';
    return s.score >= dureza() ? 'delete' : 'keep';
  }
  function renderClean() {
    const acct = activeAcct();
    $('cl-noacct').hidden = !!acct; $('cl-main').style.display = acct ? 'grid' : 'none';
    if (!acct) return;
    const running = !!(S.job && S.job.running);
    $('cl-scan').disabled = running || !acct.ready; $('cl-run').disabled = running || !acct.ready || !S.scanDone && !S.senders.size;
    $('cl-auto').disabled = running || !acct.ready;
    $('cl-stop').hidden = !running;
    for (const id of ['cl-range', 'cl-dry', 'cl-unsub', 'cl-dureza']) $(id).disabled = running;
    clear($('cl-gate')).append(gatePill(S.config.gate, 'limpiar'));
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
    const show = !!j.running;
    $('cl-prog').hidden = !show;
    if (show) {
      const frac = j.windowCount ? ((j.windowIdx - 1) + (j.windowTotal ? j.windowDone / j.windowTotal : 0)) / j.windowCount : 0;
      $('cl-bar').style.width = `${Math.max(2, Math.min(100, Math.round(frac * 100)))}%`;
      $('cl-prog-t').textContent = `${t('ui.clean.batch', { i: j.windowIdx, n: j.windowCount })}${j.windowLabel ? ` · ${j.windowLabel}` : ''}${j.etaSec != null ? ` · ${fmtEta(j.etaSec)}` : ''}${j.dryRun ? ` · ${t('ui.dry')}` : ''}`;
    }
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
  function renderSenders() {
    const body = clear($('cl-rows')), q = $('cl-filter').value.trim().toLowerCase();
    const all = [...S.senders.values()].sort((a, b) => b.count - a.count);
    const list = all.filter(s => !q || s.email.includes(q) || (s.name || '').toLowerCase().includes(q));
    $('cl-empty').hidden = all.length > 0;
    $('cl-empty').textContent = S.job.running && S.job.kind === 'scan' ? t('ui.clean.scanning') : t('ui.clean.empty');
    const sel = all.filter(s => effDecision(s) === 'delete');
    $('cl-sel').textContent = t('ui.clean.selected', { n: sel.length, m: fmtNum(sel.reduce((a, s) => a + s.count, 0)) });
    for (const s of list.slice(0, 600)) {
      const dec = effDecision(s);
      const cls = s.score == null ? '' : s.score >= 60 ? 'hi' : s.score <= 40 ? 'lo' : 'mid';
      const tgl = (val, label, kind) => h('button', { type: 'button', 'aria-pressed': String(dec === val), text: label, onclick: () => { S.over.set(s.email, val); renderSenders(); } });
      const acts = h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap;justify-content:flex-end' });
      if (s.canUnsub && !s.unsubDone) acts.append(h('button', { class: 'btn sm', text: t('ui.clean.unsubOne'), onclick: (ev) => unsubOne(s, ev.target) }));
      if (s.unsubDone) acts.append(h('span', { class: 'pill ok', text: t('ui.clean.unsubDone') }));
      acts.append(h('button', { class: 'btn sm', title: t('ui.clean.protectTip'), text: s.rule === 'protect' ? t('ui.clean.unprotect') : t('ui.clean.protect'), onclick: async () => {
        try { const r = await api('POST', '/api/sender-rule', { email: s.email, rule: s.rule === 'protect' ? 'none' : 'protect' }); s.rule = r.rule; s.protected = r.rule === 'protect' ? true : s.protected; S.over.delete(s.email); renderSenders(); } catch (e) { fail(e); }
      } }));
      body.append(h('tr', {},
        h('td', {}, h('div', { class: 's-name', text: s.name || s.email }), h('div', { class: 's-mail', text: s.email })),
        h('td', { class: 'hide-narrow' }, h('div', { class: 's-sub', text: (s.samples || []).slice(0, 2).join(' · ') })),
        h('td', { class: 'num', text: fmtNum(s.count) }),
        h('td', { class: 'num' }, h('span', { class: `score ${cls}`, text: s.score == null ? '…' : s.score, title: s.reason || '' })),
        h('td', {}, h('div', { class: `seg sm ${dec === 'delete' ? 'del' : 'keep'}` }, tgl('keep', t('ui.clean.keep')), tgl('delete', t('ui.clean.move')))),
        h('td', {}, acts)));
    }
  }
  async function unsubOne(s, btn) {
    btn.disabled = true;
    try { const r = await api('POST', '/api/unsubscribe', { email: s.email }); if (r.ok) { s.unsubDone = true; toast(t('ui.clean.unsubOk', { email: s.email }), 'ok'); } }
    catch (e) { fail(e); if (e.status === 402) renderAll(); }
    renderSenders();
  }
  const renderSendersSoon = debounce(renderSenders, 150);

  async function startClean(kind) {
    const acct = activeAcct();
    if (!acct) return;
    const days = parseInt($('cl-range').value, 10), dry = $('cl-dry').checked, unsub = $('cl-unsub').checked;
    const range = $('cl-range').selectedOptions[0].textContent.toLowerCase();
    try {
      let r;
      if (kind === 'scan') {
        S.senders.clear(); S.over.clear(); S.scanDone = false; clear($('cl-log')); renderSenders();
        r = await api('POST', '/api/scan', { daysBack: days });
      } else if (kind === 'execute') {
        const emails = [...S.senders.values()].filter(s => effDecision(s) === 'delete').map(s => s.email);
        if (!emails.length) return toast(t('ui.clean.nothing'), 'bad');
        const n = emails.reduce((a, e) => a + S.senders.get(e).count, 0);
        const ok = await ask(t('ui.clean.run'), [t('ui.clean.confirmRun', { n: emails.length, m: fmtNum(n), range }), dry ? t('ui.dry') : t('ui.clean.toTrash')], t('ui.clean.run'));
        if (!ok) return;
        clear($('cl-log'));
        r = await api('POST', '/api/execute', { daysBack: days, emails, dryRun: dry });
        if (!dry && !r.forcedDryRun && unsub) pendingUnsub = emails.filter(e => S.senders.get(e).canUnsub && !S.senders.get(e).unsubDone);
      } else {
        const ok = await ask(t('ui.clean.auto'), [t('ui.clean.confirmAuto', { range, strict: dureza() }), dry ? t('ui.dry') : t('ui.clean.toTrash')], t('ui.clean.auto'));
        if (!ok) return;
        clear($('cl-log'));
        r = await api('POST', '/api/autorun', { daysBack: days, dureza: dureza(), dryRun: dry, autoUnsub: unsub });
      }
      if (r.forcedDryRun) toast(r.gate.motivo, 'bad');
      S.job = r; renderAll();
    } catch (e) { fail(e); if (e.status === 402) refreshConfig(); }
  }
  let pendingUnsub = [];
  async function drainUnsub() {
    const list = pendingUnsub; pendingUnsub = [];
    for (const email of list) { const s = S.senders.get(email); if (s) await unsubOne(s, h('button')); }
  }
  $('cl-scan').onclick = () => startClean('scan');
  $('cl-run').onclick = () => startClean('execute');
  $('cl-auto').onclick = () => startClean('auto');
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

  // ================================================================ SINCRONIZAR
  const sy = { lines: 0 };
  function renderSync() {
    const list = S.config.accounts || [];
    const ok = list.length >= 2;
    $('sy-need').hidden = ok; $('sy-main').style.display = ok ? 'grid' : 'none';
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
    el.append(gatePill(lic || com[0].gates.sincronizar, 'sincronizar'));
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

  // ================================================================ LICENCIAS
  async function loadLicenses() {
    try { S.lic = await api('GET', '/api/licenses'); renderLicenses(); if (S.tab === 'sincronizar') renderSyncGate(); } catch (e) { fail(e); }
  }
  function renderLicenses() {
    const L = S.lic; if (!L) return;
    const pr = L.prices;
    $('lic-p1').textContent = `${t('ui.tab.clean')} · ${pr.currency} ${pr.limpiar} / ${pr.days} ${t('ui.days')}`;
    $('lic-p2').textContent = `${t('ui.tab.sync')} · ${pr.currency} ${pr.sincronizar} / ${pr.days} ${t('ui.days')}`;
    const rows = clear($('lic-rows'));
    const cell = (g, tipo) => h('td', {}, g.personal ? h('span', { class: 'pill ok', text: t('ui.gate.free') }) : g.permitido ? h('span', { class: 'pill ok', text: t('ui.gate.licensed', { date: fmtDate(g.vence) }) }) :
      h('a', { class: 'btn sm primary', href: g.comprar, target: '_blank', rel: 'noopener', text: t('ui.gate.buy', { price: `${pr.currency} ${pr[tipo]}` }) }));
    for (const a of L.accounts) rows.append(h('tr', {}, h('td', {}, h('div', { class: 's-name', text: a.email }), h('div', { class: 's-mail', text: a.personal ? t('ui.lic.personal') : t('ui.lic.commercial') })), cell(a.gates.limpiar, 'limpiar'), cell(a.gates.sincronizar, 'sincronizar')));
    if (!L.accounts.length) rows.append(h('tr', {}, h('td', { colspan: 3, class: 'empty', text: t('ui.noAccount') })));
    const list = clear($('lic-list'));
    $('lic-empty').hidden = L.list.length > 0;
    for (const k of L.list) list.append(h('tr', {},
      h('td', { text: k.cuenta }), h('td', { text: t(`ui.lic.t.${k.tipo}`) }), h('td', { class: 'hide-narrow', text: k.canal }),
      h('td', {}, h('span', { class: `pill ${k.vigente ? 'ok' : 'bad'}`, text: `${k.vigente ? '' : `${t('ui.lic.expired')} · `}${fmtDate(k.vence)}` })),
      h('td', {}, h('button', { class: 'btn sm', text: t('ui.delete'), onclick: async () => { try { await api('POST', '/api/licenses/delete', { id: k.id }); await refreshConfig(); loadLicenses(); } catch (e) { fail(e); } } }))));
  }
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
    renderAccountsList();
    if (S.sec === 'cuentas' && !acctForm.api) acctForm.api = AcctForm($('acct-form'), {});
    // Google
    if (document.activeElement !== $('g-client')) $('g-client').value = s.google.clientId || '';
    $('g-secret').placeholder = st.secrets.hasGoogleClientSecret ? '••••••••' : '';
    $('g-redirect').value = st.redirectUri;
    $('g-guide').href = S.config.links.googleGuide[LANG] || S.config.links.googleGuide.es;
    // IA
    $('ai-on').checked = !!s.llm.enabled || !!S.config.aiEnabled;
    $('ai-url').value = s.ollamaUrl; $('ai-model').value = s.model;
    $('ai-think').checked = !!s.llm.think; $('ai-think-n').value = s.llm.thinkNumPredict;
    if (S.sec === 'ia') mountOllamaPanel($('ai-panel'), { getModel: () => $('ai-model').value.trim() });
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
    $('adv-service').value = s.service.url; $('adv-port').value = s.port;
    // sistema
    const info = clear($('sys-info'));
    const kv = (k, v) => h('div', { class: 'fld' }, h('span', { text: k }), h('code', { text: v, style: 'overflow-wrap:anywhere' }));
    info.append(kv(t('ui.sys.version'), st.version), kv(t('ui.sys.data'), st.dataDir), kv(t('ui.sys.logs'), st.logsDir), kv(t('ui.sys.secrets'), st.secrets.encrypted ? t('ui.sys.encrypted') : t('ui.sys.plain')));
    $('sys-issues').href = S.config.links.issues;
    if (S.sec === 'reglas') loadRules();
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
        active ? h('span', { class: 'pill', text: t('ui.acct.active') }) : h('button', { class: 'btn sm', text: t('ui.acct.use'), onclick: async () => { try { S.config = await api('POST', '/api/accounts/active', { id: a.id }); S.senders.clear(); S.over.clear(); renderAll(); } catch (e) { fail(e); } } }),
        h('button', { class: 'btn sm', text: t('ui.edit'), onclick: () => { acctForm.api = AcctForm($('acct-form'), { edit: a }); $('acct-form-title').textContent = t('ui.acct.edit'); $('acct-form').scrollIntoView({ block: 'nearest' }); } }),
        h('button', { class: 'btn sm', text: t('ui.delete'), onclick: async () => {
          if (!await ask(t('ui.delete'), [a.email, t('ui.acct.deleteNote')], t('ui.delete'))) return;
          try { await api('POST', '/api/accounts/delete', { id: a.id }); await refreshConfig(); renderSettings(); } catch (e) { fail(e); }
        } })));
    }
  }
  const accountTypeLabel = (a) => a.type === 'gmail-oauth' ? 'Gmail · Google' : a.type === 'gmail-password' ? 'Gmail · ' + t('ui.acct.appPassword') : (a.provider && a.provider !== 'custom' ? a.provider : 'IMAP');
  const acctForm = { api: null };

  // Formulario de cuenta (configurador y Ajustes). o: { edit?, onSaved?, makeActive?, compact? }
  function AcctForm(root, o = {}) {
    const presets = (S.setup && S.setup.presets) || (S.settings && S.settings.presets) || {};
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
    f.msg = h('div', { style: 'display:grid;gap:8px' });
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
      setPassLabel();
    };
    f.preset.addEventListener('change', fillPreset);
    if (edit) {
      f.preset.value = edit.type === 'gmail-password' ? 'gmail' : (presets[edit.provider] ? edit.provider : 'custom');
      f.email.value = edit.email; f.user.value = edit.username || '';
      f.ih.value = edit.imap.host; f.ip.value = edit.imap.port; f.is.checked = !!edit.imap.secure;
      f.sh.value = edit.smtp.host; f.sp.value = edit.smtp.port; f.ss.checked = !!edit.smtp.secure;
      f.inbox.value = edit.inboxFolder; f.trash.value = edit.trashFolder || '';
      setPassLabel();
    } else { f.preset.value = Object.keys(presets)[0] || 'gmail'; fillPreset(); f.inbox.value = 'INBOX'; }

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
        if (o.onSaved) o.onSaved(r); else { acctForm.api = AcctForm(root, {}); $('acct-form-title').textContent = t('ui.acct.new'); renderSettings(); }
        return r;
      } catch (e) { show('bad', e.message); return null; }
    };
    f.save.onclick = () => doSave(false);

    const adv = h('details', {}, h('summary', { text: t('ui.acct.server') }),
      h('div', { class: 'cols2', style: 'margin-top:10px' },
        field('IMAP', f.ih), field(t('field.imapPort'), f.ip), h('label', { class: 'chk' }, f.is, 'SSL/TLS'),
        field('SMTP', f.sh), field(t('field.smtpPort'), f.sp), h('label', { class: 'chk' }, f.ss, 'SSL/TLS'),
        field(t('ui.acct.user'), f.user), field(t('ui.acct.inbox'), f.inbox), field(t('ui.acct.trash'), f.trash)));
    root.append(h('div', { style: 'display:grid;gap:12px' },
      isOauth ? null : h('div', { class: 'cols2' }, field(t('ui.acct.provider'), f.preset), h('label', { class: 'fld grow' }, f.passLbl, f.pass)),
      h('div', { class: 'cols2' }, field(t('ui.acct.email'), f.email)),
      isOauth ? h('div', { class: 'cols2' }, field(t('ui.acct.inbox'), f.inbox), field(t('ui.acct.trash'), f.trash)) : adv,
      h('div', { class: 'row', style: 'margin-top:0' }, f.test, f.save, edit ? h('button', { class: 'btn link', type: 'button', text: t('ui.cancel'), onclick: () => { acctForm.api = AcctForm(root, {}); $('acct-form-title').textContent = t('ui.acct.new'); } }) : null),
      f.msg));
    return { f, doSave, payload, isEmpty: () => !f.email.value.trim() && !f.pass.value };
  }

  // ---- Google
  $('g-copy').onclick = () => copyText($('g-redirect').value);
  $('g-connect').onclick = async () => {
    const msg = clear($('g-msg'));
    try {
      const clientId = $('g-client').value.trim();
      if (clientId && clientId !== S.settings.settings.google.clientId) await saveSettings({ google: { clientId } });
      const r = await api('POST', '/api/oauth/google/start', { clientId, clientSecret: $('g-secret').value.trim(), email: (activeAcct() || {}).email });
      $('g-secret').value = '';
      window.open(r.authUrl, '_blank', 'noopener');
      msg.append(h('div', { class: 'msgline warn', text: t('ui.google.waiting') }));
    } catch (e) { msg.append(h('div', { class: 'msgline bad', text: e.message })); }
  };

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
  async function loadRules() {
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
  $('tel-on').addEventListener('change', (e) => saveSettings({ telemetry: { enabled: e.target.checked } }).catch(() => {}));
  $('sys-logs').onclick = () => api('POST', '/api/system/open-logs', {}).catch(fail);
  $('sys-setup').onclick = () => Wizard.open();

  // ================================================================ OLLAMA (panel compartido)
  const ollamaPanels = new Set();
  function mountOllamaPanel(root, o) {
    for (const old of [...ollamaPanels]) if (old.root === root) ollamaPanels.delete(old);
    const P = { root, o, st: null, install: null, pull: null, manual: null };
    ollamaPanels.add(P);
    P.refresh = async () => { try { P.st = await api('GET', '/api/setup/ollama'); } catch (e) { P.st = null; } P.render(); if (o.onChange) o.onChange(P.st); };
    P.render = () => {
      clear(root);
      const st = P.st;
      if (!st) return;
      const up = st.running;
      const ins = P.install, pul = P.pull;
      const installing = ins && !ins.done;
      const row1 = h('div', { class: 'row', style: 'margin-top:0' },
        h('span', { class: `dot ${up ? 'on' : 'off'}` }),
        h('b', { text: up ? t('ui.ai.detected', { v: st.version || '' }) : t('ui.ai.missing') }),
        h('span', { class: 'spacer' }));
      if (!up) row1.append(h('button', { class: 'btn primary', text: installing ? t('ui.ai.installing') : t('ui.ai.install'), disabled: installing, onclick: () => P.doInstall() }));
      root.append(row1);
      if (installing || (ins && ins.error)) {
        const label = ins.error ? ins.error : ins.phase === 'download' ? t('ui.ai.downloading', { pct: ins.pct ?? '…' }) : ins.phase === 'run' ? t('ui.ai.running', { pct: ins.pct != null ? ` ${ins.pct}%` : '' }) : ins.phase === 'start' ? t('ui.ai.starting') : '';
        if (ins.error) root.append(h('div', { class: 'msgline bad', text: label, style: 'margin-top:8px' }));
        else root.append(h('div', { style: 'margin-top:8px;display:grid;gap:4px' }, h('div', { class: 'bar' }, h('i', { style: `width:${ins.pct ?? 8}%` })), h('small', { text: label })));
      }
      if (P.manual) root.append(h('div', { style: 'margin-top:8px;display:grid;gap:6px' }, h('small', { text: t('ui.ai.manual') }),
        h('div', { class: 'cmd' }, h('code', { text: P.manual }), h('button', { class: 'btn sm', text: t('ui.copy'), onclick: () => copyText(P.manual) })),
        h('button', { class: 'btn sm', style: 'justify-self:start', text: t('ui.ai.recheck'), onclick: () => P.refresh() })));
      if (up) {
        const model = (o.getModel ? o.getModel() : st.model) || st.model;
        const has = st.models.some(m => m === model || m === `${model}:latest`);
        const pulling = pul && !pul.done;
        const r2 = h('div', { class: 'row' }, h('span', { class: `dot ${has ? 'on' : 'off'}` }), h('b', { text: has ? t('ui.ai.modelReady', { m: model }) : t('ui.ai.modelMissing', { m: model }) }), h('span', { class: 'spacer' }));
        if (!has) r2.append(h('button', { class: 'btn primary', text: pulling ? t('ui.ai.pulling') : t('ui.ai.pull'), disabled: pulling, onclick: () => P.doPull(model) }));
        root.append(r2);
        if (pulling) root.append(h('div', { style: 'margin-top:8px;display:grid;gap:4px' }, h('div', { class: 'bar' }, h('i', { style: `width:${pul.pct ?? 4}%` })), h('small', { text: `${pul.status || ''}${pul.pct != null ? ` · ${pul.pct}%` : ''}` })));
        if (pul && pul.error) root.append(h('div', { class: 'msgline bad', text: pul.error, style: 'margin-top:8px' }));
      }
    };
    P.doInstall = async () => {
      try {
        const r = await api('POST', '/api/setup/ollama/install', {});
        if (r.manual) { P.manual = r.command || `${r.url}`; P.render(); } else { P.install = { phase: 'download', pct: 0 }; P.manual = null; P.render(); }
      } catch (e) { fail(e); }
    };
    P.doPull = async (model) => {
      try { await api('POST', '/api/setup/ollama/pull', { model }); P.pull = { status: '', pct: 0 }; P.render(); } catch (e) { fail(e); }
    };
    P.event = (ev) => {
      if (ev.task === 'install') { P.install = ev; if (ev.done) { P.refresh(); return; } }
      if (ev.task === 'pull') { P.pull = ev; if (ev.done) { P.refresh(); return; } }
      P.render(); if (o.onChange) o.onChange(P.st, ev);
    };
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
        const modelIn = h('input', { type: 'text', value: S.setup.model || S.config.model, 'aria-label': t('ui.ai.model') });
        const panelBox = h('div');
        body.append(panelBox, h('label', { class: 'fld' }, h('span', { text: t('ui.ai.model') }), modelIn));
        const nextBtn = next(t('ui.next'), async () => {
          try {
            const st = this.panel && this.panel.st;
            const on = !!(st && st.running && st.modelInstalled);
            await api('POST', '/api/setup/prefs', { ai: on, model: modelIn.value.trim() });
            S.config.aiEnabled = on; this.step = 3; this.render();
          } catch (e) { fail(e); }
        });
        const skip = h('button', { class: 'btn', text: t('ui.ai.skip'), onclick: async () => { try { await api('POST', '/api/setup/prefs', { ai: false }); S.config.aiEnabled = false; this.step = 3; this.render(); } catch (e) { fail(e); } } });
        this.panel = mountOllamaPanel(panelBox, {
          getModel: () => modelIn.value.trim(),
          onChange: (st) => { const busyNow = this.panel && ((this.panel.install && !this.panel.install.done) || (this.panel.pull && !this.panel.pull.done)); nextBtn.disabled = !!busyNow; },
        });
        modelIn.addEventListener('change', () => { api('POST', '/api/setup/prefs', { model: modelIn.value.trim() }).then(() => this.panel.refresh()).catch(fail); });
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
            this.close(); renderAll(); showTab('limpiar');
          } catch (e) { fail(e); }
        };
        foot.append(back(), next(t('ui.wiz.finish'), finish), h('span', { class: 'spacer' }), h('button', { class: 'btn', text: t('ui.wiz.skipAccount'), onclick: async () => { try { S.config = await api('POST', '/api/setup/finish', {}); this.close(); renderAll(); showTab('ajustes', 'cuentas'); } catch (e) { fail(e); } } }));
        // el formulario de cuenta guarda dentro; al terminar el botón principal ya lo hace
        this.form.f.save.hidden = true;
      }
    },
  };

  // ================================================================ SSE y arranque
  function onEvent(m) {
    if (m.t === 'line') {
      addLog($('cl-log'), m.text, m.kind, m.ts);
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
      if (wasRunning && !m.job.running) { refreshConfig(); if (m.job.kind === 'execute') drainUnsub(); }
    } else if (m.t === 'config') {
      S.config = m.config; renderAll();
    } else if (m.t === 'setup') {
      onSetupEvent(m);
    } else if (m.t === 'sync') {
      onSync(m);
    }
  }
  function onSync(m) {
    if (m.tipo === 'linea') addLog($('sy-log'), m.text, 'info', m.ts);
    else if (m.tipo === 'inicio') { S.sync = Object.assign(S.sync || {}, { running: true, dryRun: m.dryRun, result: null, progress: null }); renderSync(); renderHeader(); }
    else if (m.tipo === 'progreso') { S.sync = Object.assign(S.sync || {}, { progress: m.progress }); renderSync(); }
    else if (m.tipo === 'fin') { api('GET', '/api/sync').then((v) => { S.sync = v; renderSync(); renderHeader(); loadLicenses(); }).catch(fail); }
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
    renderHeader(); renderClean();
    if (S.tab === 'sincronizar') renderSync();
    if (S.tab === 'licencias') renderLicenses();
    if (S.tab === 'ajustes' && S.settings) renderAccountsList();
  }
  const rerenderStatic = () => { renderHeader(); renderClean(); renderSync(); renderLicenses(); };

  async function boot() {
    try {
      S.config = await api('GET', '/api/config');
      await setLang(S.config.language);
      S.job = S.config.job || { running: false };
      S.sync = S.config.sync;
      try { S.lic = await api('GET', '/api/licenses'); } catch (_) { /* sin licencias */ }
      initCleanControls(); $('sy-dry').checked = true;
      // si había un escaneo hecho, el servidor lo conserva: se recupera
      try { const r = await api('GET', '/api/senders'); if (r.senders.length) { S.senders = new Map(r.senders.map(s => [s.email, s])); S.scanDone = true; } } catch (_) { /* nada */ }
      renderAll(); showTab('limpiar'); renderSync();
      connectStream();
      if (!S.config.setup.done) await Wizard.open();
    } catch (e) {
      document.body.append(h('pre', { class: 'log', style: 'margin:20px', text: e.message }));
    }
  }
  window.addEventListener('error', (e) => { try { fetch('/api/system/ui-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: e.message, source: e.filename, line: e.lineno }) }); } catch (_) { /* nada */ } });
  boot();
})();
