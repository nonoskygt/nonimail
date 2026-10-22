'use strict';
// NoniMail Tools: servidor HTTP local (127.0.0.1) con la interfaz y la API.
//   Limpiar      escanear, ejecutar y limpiar por lotes de fecha (lib/engine.js)
//   Sincronizar  copiar un buzón en otro (lib/sync)
//   Licencias    claves por cuenta comercial (lib/licenses)
//   Ajustes      cuentas, IA, limpieza, reglas, apariencia, privacidad
// Lo usan la app de escritorio (electron/main.js) y el modo sin ventana (server.js).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const { ROOT, defaults } = require('./defaults');
const { resolveDataDir } = require('./paths');
const C = require('./config');
const i18n = require('./i18n');
const { t } = i18n;
const { Secrets } = require('./secrets');
const { compileRules } = require('./classify');
const llm = require('./llm');
const { ProgressStore } = require('./batches');
const { Engine } = require('./engine');
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { MailClient } = require('./mail/imap');
const smtp = require('./mail/smtp');
const oauth = require('./mail/google-oauth');
const { connectionOptions } = require('./mail/account');
const { Logger, pruneRuns } = require('./log');
const { Telemetry } = require('./telemetry');
const { Licenses, TIPOS } = require('./licenses');
const { esPersonal, esCorreo, dominioDe } = require('./licenses/domains');
const { ServiceAuth, algunaRequiereSesion, pestanasActivas } = require('./service-auth');
const { SyncRunner } = require('./sync/runner');
const { OllamaSetup } = require('./ollama');
const { Updater } = require('./updater');
const { releasesApiUrl } = require('./updates');

const PKG = require('../package.json');
const PUBLIC = path.join(ROOT, 'public');
const LOCALES = path.join(ROOT, 'locales');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const ACCOUNT_SHAPE = (({ id, ...rest }) => rest)(C.ACCOUNT_DEFAULT);
const SETTINGS_SHAPE = C.pickShape(defaults(), C.SETTINGS_PATHS);

// La 2.0 guardaba los datos junto al código: la primera vez se copian a la carpeta de datos nueva
function migrateRepoData(dataDir, log) {
  if (path.resolve(dataDir) === path.resolve(ROOT) || fs.existsSync(path.join(dataDir, 'config.json'))) return false;
  if (!fs.existsSync(path.join(ROOT, 'config.json'))) return false;
  for (const f of ['config.json', 'secrets.json', 'senders.json', 'progress.json']) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(dataDir, f)); try { if (f === 'secrets.json') fs.chmodSync(path.join(dataDir, f), 0o600); } catch (_) {} }
  }
  log.info(`datos de la 2.0 copiados de ${ROOT} a ${dataDir}`);
  return true;
}

function readBody(req, limit) {
  return new Promise((res, rej) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > limit) { rej(Object.assign(new Error('payload too large'), { code: 413 })); req.destroy(); } });
    req.on('end', () => res(b)); req.on('error', rej);
  });
}
const httpErr = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});

// o: { dataDir, host, port, desktop, cipher, openPath(p), locale, env, fetch, onLanguage(lang), onAppearance(ap), echoLog,
//      updates: { kind, autoUpdater, quitAndInstall() } (solo la app de escritorio empaquetada; sin esto no hay actualizaciones) }
async function createApp(o = {}) {
  const env = o.env || process.env;
  const dataDir = resolveDataDir(o.dataDir, env);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = (n) => path.join(dataDir, n);
  const D = defaults();
  const LOG = new Logger({ dir: file(D.log.dir), file: D.log.file, maxBytes: D.log.maxBytes, files: D.log.files, echo: !!o.echoLog });
  const migratedRepo = o.desktop ? false : migrateRepoData(dataDir, LOG);

  // ---------- estado persistente ----------
  const STORE = new C.ConfigStore({ file: file('config.json'), env });
  const CFG = () => STORE.get();
  const logsDir = file(CFG().log.dir), runsDir = path.join(logsDir, 'runs');
  i18n.setLanguage(i18n.resolve(CFG().language, o.locale));
  let RULES;
  try { RULES = compileRules(CFG().heuristics); }
  catch (e) { LOG.error(`regla inválida en la configuración (${e.message}); se ignoran las heurísticas`); RULES = compileRules({ keepOverride: D.heuristics.keepOverride }); }
  const SECRETS = new Secrets(file('secrets.json'), { cipher: o.cipher || null, log: LOG });
  if (STORE.legacyAccountId) SECRETS.adoptLegacy(STORE.legacyAccountId);
  SECRETS.upgrade();
  const TOKENS = new oauth.TokenCache({ tokenUrl: CFG().google.tokenUrl });
  const PROGRESS = new ProgressStore(file('progress.json'));
  const SENDERS_FILE = file('senders.json');
  const SENDERS = readJson(SENDERS_FILE, {});
  if (!SENDERS.rules) SENDERS.rules = {};
  if (!SENDERS.unsub) SENDERS.unsub = {};
  const saveSenders = () => writeJsonAtomic(SENDERS_FILE, SENDERS);

  const accounts = () => CFG().accounts;
  const findAccount = (id) => accounts().find(a => a.id === id) || null;
  const activeAccount = () => findAccount(CFG().activeAccount) || accounts()[0] || null;
  const userEmails = () => accounts().map(a => a.email).concat(CFG().cleaning.myAddresses);

  const LIC = new Licenses({ file: file('licenses.json'), getConfig: CFG, log: LOG, fetch: o.fetch });
  const AUTH = new ServiceAuth({ getConfig: CFG, secrets: SECRETS, licenses: LIC, log: LOG, fetch: o.fetch });
  const TEL = new Telemetry({ dir: dataDir, getConfig: CFG, version: PKG.version, userEmails, log: LOG, fetch: o.fetch, locale: o.locale });
  const reportError = (e, contexto = 'app', cuenta) => {
    LOG.error(`[${contexto}] ${e && e.message ? e.message : e}`, e && e.stack ? e.stack : undefined);
    try { TEL.error(e instanceof Error ? e : new Error(String(e)), contexto, cuenta); } catch (_) {}
  };

  // ---------- SSE ----------
  const clients = new Set();
  const sse = (obj) => { const data = `data: ${JSON.stringify(obj)}\n\n`; for (const res of clients) { try { res.write(data); } catch (_) {} } };
  let runLog = null;
  function emit(lane, text, kind) {
    const ev = { t: 'line', lane, text, kind, ts: new Date().toISOString().slice(11, 19) };
    sse(ev);
    if (runLog) { try { runLog.write(`[${ev.ts}][${lane}][${kind}] ${text}\n`); } catch (_) {} }
  }

  // ---------- métricas CPU/GPU ----------
  const cpuTimes = () => os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  let lastCpu = cpuTimes();
  function cpuPercent() {
    const now = cpuTimes(); let idle = 0, total = 0;
    for (let i = 0; i < now.length && i < lastCpu.length; i++) { idle += now[i].idle - lastCpu[i].idle; total += now[i].total - lastCpu[i].total; }
    lastCpu = now; return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
  }
  let gpuAvailable = true;
  const gpuQuery = () => !gpuAvailable ? Promise.resolve(null) : new Promise(res => {
    execFile('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: CFG().metrics.gpuTimeoutMs, windowsHide: true }, (err, out) => {
      if (err && err.code === 'ENOENT') gpuAvailable = false;
      if (err || !out) return res(null);
      const p = out.trim().split('\n')[0].split(',').map(x => parseInt(x.trim(), 10));
      res({ util: p[0] || 0, vramUsed: p[1] || 0, vramTotal: p[2] || 0 });
    });
  });
  const metricsTimer = setInterval(async () => { if (clients.size) sse({ t: 'metrics', cpu: cpuPercent(), gpu: await gpuQuery(), ram: Math.round(100 * (1 - os.freemem() / os.totalmem())) }); }, CFG().metrics.intervalMs);
  metricsTimer.unref();

  // ---------- correo ----------
  async function connectionFor(a, secrets = SECRETS.scope(a.id)) {
    const cfg = CFG();
    const conn = await connectionOptions({ ...cfg, account: a }, secrets, TOKENS, { presets: cfg.presets });
    if (conn.smtp) conn.smtp.timeouts = cfg.smtp;
    return conn;
  }
  async function openMailFor(a) {
    const conn = await connectionFor(a);
    return new MailClient(conn.imap, { inboxFolder: a.inboxFolder, trashFolder: a.trashFolder, timeouts: CFG().imap }).connect();
  }
  const noAccount = { type: 'none', email: '', inboxFolder: 'INBOX', trashFolder: '' };
  const engineCfg = () => ({ ...CFG(), account: activeAccount() || noAccount });

  const engine = new Engine({
    cfg: engineCfg, rules: () => RULES, senderRules: () => SENDERS.rules,
    isUnsubDone: (e) => !!SENDERS.unsub[e], markUnsub: (e) => { SENDERS.unsub[e] = true; saveSenders(); },
    progress: PROGRESS,
    openMail: () => { const a = activeAccount(); if (!a) throw Object.assign(new Error(t('acct.none')), { config: true }); return openMailFor(a); },
    smtpOptions: async () => (await connectionFor(activeAccount())).smtp,
    emit, sse,
    onRunStart(job) {
      try {
        fs.mkdirSync(runsDir, { recursive: true });
        pruneRuns(runsDir, CFG().log.keepRuns - 1);
        runLog = fs.createWriteStream(path.join(runsDir, `${job.kind}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`), { flags: 'a' });
      } catch (_) { runLog = null; }
      LOG.info(`limpiar: ${job.kind} ${job.account} ${job.daysBack}d ${job.dryRun ? 'simulación' : 'real'}`);
    },
    onRunEnd(job) {
      if (runLog) { try { runLog.end(); } catch (_) {} runLog = null; }
      const g = LIC.gate(job.account, 'limpiar');
      const resultado = job.status === 'done' ? 'ok' : job.error ? 'error' : 'cancelado';
      TEL.track('limpiar', {
        cuenta: job.account, fase: job.kind === 'scan' ? 'escaneo' : 'ejecucion', dry_run: job.kind === 'scan' ? true : !!job.dryRun,
        revisados: job.totals.seen, remitentes: Object.keys(job.senders || {}).length,
        movidos: job.kind === 'scan' || job.dryRun ? 0 : job.totals.deleted,
        duracion_s: Math.round((Date.now() - (job.runStart || Date.now())) / 1000), resultado, licencia: !g.personal && g.permitido,
      });
      if (job.error) reportError(new Error(job.error), 'limpiar', job.account);
      LOG.info(`limpiar: fin ${job.kind} ${resultado} revisados=${job.totals.seen} borrados=${job.totals.deleted}`);
      TEL.flush().catch(() => {});
    },
  });

  const SYNC = new SyncRunner({
    cfg: CFG, licenses: LIC, sse, log: LOG,
    mailbox: async (id) => {
      const a = findAccount(id);
      if (!a) throw httpErr(404, t('acct.notFound'));
      const conn = await connectionFor(a);
      return { email: a.email, mb: { ...conn.imap, tlsInsecure: CFG().sync.tlsInsecure } };
    },
    onEnd(st) {
      const r = st.result || {}, x = r.totals || {};
      const resultado = r.error ? 'error' : r.cancelled ? 'cancelado' : 'ok';
      const g = st.gate || {};
      TEL.track('sincronizar', {
        origen: st.origen, destino: st.destino, dry_run: !!st.dryRun, carpetas: (r.folders || []).length,
        mensajes: x.source || 0, copiados: x.copied || 0, bytes: x.bytes || 0, duracion_s: Math.round((st.durationMs || 0) / 1000),
        resultado, licencia: !g.personal && !!g.permitido,
      });
      if (r.error) reportError(new Error(r.error), 'sincronizar', st.origen);
      LOG.info(`sincronizar: ${st.origen} → ${st.destino} ${st.dryRun ? 'simulación' : 'real'} ${resultado} copiados=${x.copied || 0}`);
      TEL.flush().catch(() => {});
    },
  });

  const OLL = new OllamaSetup({
    cfg: CFG, sse, log: LOG,
    onError: (e) => reportError(e, 'ia'),
    onUrl: (url) => { if (CFG().ollamaUrl !== url) STORE.patch('ollamaUrl', url); },
    onPulled: (model) => { if (CFG().model !== model) STORE.patch('model', model); },
  });

  const busy = () => engine.busy() || SYNC.busy();

  // ---------- vistas (nunca incluyen secretos) ----------
  function accountView(a) {
    const st = SECRETS.accountStatus(a.id), cfg = CFG();
    const gc = oauth.clientFor(cfg, SECRETS);
    const ready = a.type === 'gmail-oauth' ? st.googleConnected && !!gc.clientId && !!gc.clientSecret
      : st.hasPassword && (a.type !== 'imap' || !!a.imap.host);
    return {
      id: a.id, type: a.type, email: a.email, username: a.username, provider: a.provider, imap: a.imap, smtp: a.smtp,
      inboxFolder: a.inboxFolder, trashFolder: a.trashFolder, ready, personal: esPersonal(a.email),
      hasPassword: st.hasPassword, googleConnected: st.googleConnected,
    };
  }
  const redirectUri = () => `http://127.0.0.1:${PORT}/oauth/google/callback`;
  function publicConfig() {
    const cfg = CFG(), a = activeAccount();
    return {
      version: PKG.version, desktop: !!o.desktop, language: i18n.language(), languageSetting: cfg.language || '', appearance: cfg.appearance,
      setup: { done: !!cfg.setup.done }, model: cfg.model, aiEnabled: !!cfg.llm.enabled, cleaning: cfg.cleaning,
      accounts: accounts().map(accountView), activeAccount: a ? a.id : '',
      gate: a ? LIC.gate(a.email, 'limpiar') : null,
      job: engine.view(), pending: engine.pendingJobs(), sync: SYNC.view(),
      tabs: pestanasActivas(accounts().map(accountView)),
      auth: { ...AUTH.status(), required: algunaRequiereSesion(accounts()) },
      links: cfg.links, prices: cfg.licenses.prices, serviceUrl: cfg.service.url, telemetry: !!cfg.telemetry.enabled,
      migratedFrom: STORE.migratedFrom, migratedRepo,
    };
  }
  function settingsView() {
    return {
      settings: C.pickShape(CFG(), C.SETTINGS_PATHS), presets: CFG().presets, redirectUri: redirectUri(),
      secrets: { hasGoogleClientSecret: SECRETS.status().hasGoogleClientSecret, encrypted: SECRETS.encrypted },
      locked: STORE.locked, dataDir, logsDir, version: PKG.version, desktop: !!o.desktop,
    };
  }

  function saveConfig(next) {
    const prevLang = CFG().language, prevAp = JSON.stringify(CFG().appearance), prevTel = CFG().telemetry.enabled;
    STORE.save(next);
    const cfg = CFG();
    if (cfg.language !== prevLang) { i18n.setLanguage(i18n.resolve(cfg.language, o.locale)); if (o.onLanguage) o.onLanguage(i18n.language()); }
    if (JSON.stringify(cfg.appearance) !== prevAp && o.onAppearance) o.onAppearance(cfg.appearance);
    if (cfg.telemetry.enabled !== prevTel) TEL.setConsent(cfg.telemetry.enabled);
    sse({ t: 'config', config: publicConfig() });
    return cfg;
  }
  const saveAccounts = (list, activeId) => saveConfig({ accounts: list, activeAccount: activeId ?? CFG().activeAccount });

  function trackAccount(a) {
    const prov = a.type !== 'imap' ? 'gmail' : ['yahoo', 'icloud'].includes(a.provider) ? a.provider
      : /outlook|hotmail|live\.|office365/i.test(`${a.imap.host} ${dominioDe(a.email)}`) ? 'outlook' : a.provider === 'custom' ? 'imap' : 'otro';
    TEL.track('cuenta', { cuenta: a.email, proveedor: prov, personal: esPersonal(a.email) });
  }

  // borrador de cuenta (para "Probar" sin guardar): la contraseña nueva gana sobre la guardada
  function draftAccount(body) {
    const prev = body.account && body.account.id ? findAccount(body.account.id) : null;
    const merged = C.mergeKnown(ACCOUNT_SHAPE, C.deepDefaults(C.ACCOUNT_DEFAULT, prev || {}), body.account || {});
    const a = { ...merged, id: prev ? prev.id : '' };
    const pass = body.secrets && typeof body.secrets.password === 'string' ? body.secrets.password.trim() : '';
    const scope = SECRETS.scope(a.id || '-');
    return { a, prev, pass, secrets: { get: (k) => (k === 'imapPassword' && pass) ? pass : scope.get(k) } };
  }

  async function testAccount(body) {
    const { a, secrets } = draftAccount(body);
    const out = { mail: null, smtp: null };
    let conn = null;
    try { conn = await connectionFor(a, secrets); }
    catch (e) { out.mail = { ok: false, error: e.message }; return out; }
    let mc = null;
    try {
      mc = await new MailClient(conn.imap, { inboxFolder: a.inboxFolder, trashFolder: a.trashFolder, timeouts: CFG().imap }).connect();
      const i = await mc.info();
      const problems = [];
      if (!i.inbox) problems.push(t('test.noInbox', { folder: a.inboxFolder }));
      if (!i.trash) problems.push(t('test.noTrash'));
      if (!i.canMove) problems.push(t('test.noMove'));
      out.mail = { ok: true, warning: problems.join(' · ') || null, inboxCount: i.inboxCount, inbox: i.inbox, trash: i.trash, sent: i.sent, isGmail: i.isGmail, folders: i.folders.map(f => f.path) };
    } catch (e) {
      out.mail = { ok: false, error: e.authenticationFailed ? t('test.authFailed') : (e.responseText || e.message) };
    } finally { if (mc) await mc.close().catch(() => {}); }
    out.smtp = conn.smtp ? await smtp.verify(conn.smtp) : { ok: false, error: t('test.noSmtp') };
    if (out.mail.ok && esCorreo(a.email)) trackAccount(a);
    return out;
  }

  async function testLlm(body) {
    const cfg = CFG();
    const url = body.ollamaUrl || cfg.ollamaUrl, model = body.model || cfg.model;
    const v = await llm.version(url, cfg.ollama.probeTimeoutMs);
    if (!v.ok) return { ok: false, error: v.error };
    const m = await llm.listModels(url, cfg.ollama.probeTimeoutMs);
    const installed = m.models.includes(model);
    return { ok: installed, version: v.version, error: installed ? null : (model ? t('llm.notInstalled', { model }) : t('llm.pickModel')) };
  }

  // ---------- OAuth de Google ----------
  const PENDING_OAUTH = new Map(); // state → { verifier, clientId, clientSecret, accountId, at }
  function oauthPage(ok, msg, retryUrl) {
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<!doctype html><html lang="${i18n.language()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NoniMail Tools · Google</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f0e9;color:#27241f;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}div{max-width:460px;padding:24px;border:1px solid #e3ddd1;border-radius:14px;background:#fcfbf8}h1{font-size:18px;margin:0 0 8px;color:${ok ? '#1d6f40' : '#b42318'}}p{margin:6px 0;color:#5c574e}a.retry{display:inline-block;margin-top:6px;padding:9px 16px;border-radius:8px;background:#27241f;color:#fff;font-weight:600;text-decoration:none}@media (prefers-color-scheme:dark){a.retry{background:#ebe7df;color:#1a1e25}body{background:#1a1e25;color:#ebe7df}div{background:#21262e;border-color:#343a45}h1{color:${ok ? '#5cc98a' : '#f68d80'}}p{color:#b3b8c1}}</style></head>
<body><div><h1>${esc(ok ? t('oauth.ok') : t('oauth.fail'))}</h1><p>${esc(msg)}</p>${retryUrl ? `<p><a class="retry" href="${esc(retryUrl)}">${esc(t('oauth.retry'))}</a></p>` : ''}<p>${esc(t('oauth.close'))}</p></div></body></html>`;
  }

  // ---------- trabajos de Limpiar con la puerta de licencias ----------
  function startClean(kind, body) {
    const a = activeAccount();
    if (!a) throw httpErr(400, t('acct.none'));
    const gate = LIC.gate(a.email, 'limpiar');
    let p = { ...body }, forced = false;
    if (kind !== 'scan' && !p.dryRun && !gate.permitido) { p = { ...p, dryRun: true, autoUnsub: false }; forced = true; emit('sys', t('lic.forcedDry', { reason: gate.motivo }), 'warn'); }
    const view = engine.start(kind, p);
    return { ...view, forcedDryRun: forced, gate };
  }

  // ---------- estáticos ----------
  function serveIndex(res) {
    const cfg = CFG();
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
      .replace('{{lang}}', i18n.language())
      .replace('{{mode}}', C.MODES.includes(cfg.appearance.mode) ? cfg.appearance.mode : 'auto')
      .replace('{{accent}}', C.ACCENTS.includes(cfg.appearance.accent) ? cfg.appearance.accent : 'carmesi')
      .replace('{{day}}', String(cfg.appearance.dayStartHour)).replace('{{night}}', String(cfg.appearance.nightStartHour));
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(html);
  }
  function serveStatic(res, pathname) {
    let base = PUBLIC, rel = pathname.replace(/^\/+/, '');
    if (rel.startsWith('locales/')) { base = LOCALES; rel = rel.slice('locales/'.length); }
    const full = path.resolve(base, rel);
    if (!full.startsWith(base + path.sep) || !TYPES[path.extname(full)] || !fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(fs.readFileSync(full));
    return true;
  }

  // ---------- HTTP ----------
  let PORT = 0;
  // Solo esta PC: Host local (contra DNS rebinding) y, en POST, JSON del mismo origen (contra CSRF)
  function allowed(req) {
    const host = String(req.headers.host || '').toLowerCase();
    const okHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`];
    if (!okHosts.includes(host)) return 'host';
    if (req.method === 'POST') {
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return 'content-type';
      const origin = req.headers.origin;
      if (origin && !okHosts.map(h => `http://${h}`).includes(origin.toLowerCase())) return 'origin';
    }
    return null;
  }

  const authDone = (r) => { sse({ t: 'config', config: publicConfig() }); return r; };
  const routes = {
    // ----- general -----
    'GET /api/config': () => publicConfig(),
    'GET /api/stream': null, // ver abajo

    // ----- Limpiar -----
    'GET /api/senders': () => ({ senders: engine.scanSenders() }),
    'POST /api/scan': (b) => startClean('scan', b),
    'POST /api/autorun': (b) => startClean('auto', b),
    'POST /api/execute': (b) => startClean('execute', b),
    'POST /api/stop': () => { engine.stop(); return { ok: true }; },
    'GET /api/jobs': () => ({ current: engine.view(), pending: engine.pendingJobs() }),
    'POST /api/jobs/resume': (b) => {
      const saved = PROGRESS.get(b.key);
      if (!saved) throw httpErr(404, t('eng.noResume'));
      const owner = accounts().find(a => a.email === saved.account);
      if (!owner) throw httpErr(404, t('acct.notFound'));
      if (owner.id !== (activeAccount() || {}).id) { if (busy()) throw httpErr(409, t('eng.busy')); saveConfig({ activeAccount: owner.id }); }
      const gate = LIC.gate(owner.email, 'limpiar');
      if (saved.kind !== 'scan' && !saved.dryRun && !gate.permitido) throw httpErr(402, gate.motivo, { gate });
      return engine.start(saved.kind, { resume: true, key: saved.key });
    },
    'POST /api/jobs/discard': (b) => { engine.discard(b.key); return { ok: true, pending: engine.pendingJobs() }; },
    // remitentes con regla guardada (Nunca eliminar / Siempre eliminar): se listan en Ajustes → Reglas
    'GET /api/sender-rules': () => ({ list: Object.entries(SENDERS.rules).map(([email, rule]) => ({ email, rule })).sort((a, b) => a.email.localeCompare(b.email)) }),
    'POST /api/sender-rule': (b) => {
      const email = String(b.email || '').trim().toLowerCase(), rule = b.rule;
      if (!email) throw httpErr(400, t('api.missingEmail'));
      if (rule === 'none' || rule == null) delete SENDERS.rules[email];
      else if (['delete', 'protect'].includes(rule)) SENDERS.rules[email] = rule;
      else throw httpErr(400, t('api.badRule'));
      saveSenders();
      return { ok: true, email, rule: SENDERS.rules[email] || null, protected: rule === 'protect' };
    },
    'POST /api/unsubscribe': async (b) => {
      const email = String(b.email || '').trim().toLowerCase();
      if (!email) throw httpErr(400, t('api.missingEmail'));
      const a = activeAccount();
      const gate = a ? LIC.gate(a.email, 'limpiar') : null;
      if (gate && !gate.permitido) throw httpErr(402, gate.motivo, { gate });
      emit('sys', t('unsub.doing', { email }), 'info');
      const r = await engine.unsubscribeSender(email);
      emit('sys', r.ok ? t('unsub.done', { method: r.method, email }) : t('unsub.failed', { email, error: r.error }), r.ok ? 'info' : 'warn');
      if (!r.ok) throw httpErr(400, r.error, r);
      return r;
    },

    // ----- reglas -----
    'GET /api/rules': () => {
      const cfg = CFG();
      const promptTemplate = llm.buildPrompt(cfg.llmPrompt, { from: t('rules.ph.from'), subjects: [t('rules.ph.subjects')], bulk: true, body: t('rules.ph.body', { n: cfg.cleaning.bodyMaxChars }) });
      return { model: cfg.model, aiEnabled: cfg.llm.enabled, ...cfg.heuristics, llmPrompt: cfg.llmPrompt, promptTemplate };
    },
    'POST /api/rules': (b) => {
      if (busy()) throw httpErr(409, t('api.busyEdit'));
      const h = { ...CFG().heuristics };
      for (const f of ['keepOverride', 'subject', 'from', 'body']) if (typeof b[f] === 'string') h[f] = b[f].trim();
      let rules; try { rules = compileRules(h); } catch (e) { throw httpErr(400, t('val.rule', { error: e.message })); }
      const next = { heuristics: h };
      if (typeof b.llmPrompt === 'string' && b.llmPrompt.trim()) next.llmPrompt = b.llmPrompt.trim();
      saveConfig(next); RULES = rules;
      emit('sys', t('rules.saved'), 'info');
      return { ok: true };
    },
    'POST /api/rules/reset': () => {
      if (busy()) throw httpErr(409, t('api.busyEdit'));
      saveConfig({ heuristics: D.heuristics, llmPrompt: D.llmPrompt }); RULES = compileRules(CFG().heuristics);
      return { ok: true };
    },

    // ----- ajustes -----
    'GET /api/settings': () => settingsView(),
    'POST /api/settings': (b) => {
      if (busy()) throw httpErr(409, t('api.busySettings'));
      const next = C.mergeKnown(SETTINGS_SHAPE, CFG(), b.settings || {});
      const errors = C.validate(next);
      if (errors.length) throw httpErr(400, errors.join(' · '), { errors });
      const restartNeeded = next.port !== CFG().port;
      const clientChanged = next.google.clientId !== CFG().google.clientId;
      saveConfig(next);
      if (b.secrets && typeof b.secrets.googleClientSecret === 'string' && b.secrets.googleClientSecret.trim()) SECRETS.set({ googleClientSecret: b.secrets.googleClientSecret });
      if (clientChanged) TOKENS.clear();
      return { ok: true, restartNeeded: restartNeeded && !o.desktop, view: settingsView() };
    },
    'POST /api/prefs/close': (b) => { // no se bloquea con trabajo en curso: es solo una preferencia de la ventana
      if (!['ask', 'minimize', 'quit'].includes(b.closeAction)) throw httpErr(400, t('val.closeAction'));
      saveConfig({ closeAction: b.closeAction });
      return { ok: true, closeAction: CFG().closeAction };
    },
    'POST /api/prefs/updates': (b) => { // el interruptor «Actualizar automáticamente»; tampoco se bloquea con trabajo en curso
      if (typeof b.auto !== 'boolean') throw httpErr(400, t('val.updatesAuto'));
      saveConfig({ updates: { ...CFG().updates, auto: b.auto } });
      return { ok: true, update: UPD.state() };
    },
    'GET /api/update': () => UPD.state(),
    'POST /api/update/check': () => UPD.check(true),
    'POST /api/update/restart': () => {
      const r = UPD.restart();
      if (!r.ok) throw httpErr(409, r.reason === 'busy' ? t('api.updateBusy') : t('api.updateNone'));
      return r;
    },
    'POST /api/appearance': (b) => {
      const ap = { ...CFG().appearance };
      if (C.MODES.includes(b.mode)) ap.mode = b.mode;
      if (C.ACCENTS.includes(b.accent)) ap.accent = b.accent;
      saveConfig({ appearance: ap });
      return { ok: true, appearance: CFG().appearance };
    },
    'GET /api/llm/models': (b, u) => llm.listModels(u.searchParams.get('url') || CFG().ollamaUrl, CFG().ollama.probeTimeoutMs),
    'POST /api/llm/check': (b) => testLlm(b),
    'POST /api/llm/test': async (b) => {
      const base = CFG();
      const cfg = { ...base, ollamaUrl: b.ollamaUrl || base.ollamaUrl, model: b.model || base.model, llm: { ...base.llm } };
      if (typeof b.think === 'boolean') cfg.llm.think = b.think;
      const tp = parseInt(b.thinkNumPredict, 10);
      if (tp >= 64 && tp <= 32768) cfg.llm.thinkNumPredict = tp;
      if (!cfg.model) throw httpErr(400, t('llm.pickModel'));
      const r = await llm.testModel(cfg);
      if (!r.ok && r.error) reportError(new Error(r.error), 'ia');
      return r;
    },

    // ----- cuentas -----
    'GET /api/accounts': () => ({ accounts: accounts().map(accountView), activeAccount: (activeAccount() || {}).id || '', presets: CFG().presets }),
    'GET /api/accounts/classify': (b, u) => { const e = String(u.searchParams.get('email') || '').trim().toLowerCase(); return { email: e, valid: esCorreo(e), personal: esPersonal(e), domain: dominioDe(e) }; },
    'POST /api/accounts/test': async (b) => {
      const r = await testAccount(b);
      if (!r.mail.ok) LOG.warn(`cuenta: prueba fallida (${r.mail.error})`);
      return r;
    },
    'POST /api/accounts/save': (b) => {
      if (busy()) throw httpErr(409, t('api.busySettings'));
      const { a, prev, pass } = draftAccount(b);
      if (a.type === 'gmail-oauth' && !prev) throw httpErr(400, t('acct.useGoogleButton'));
      const errors = C.validateAccount(a);
      if (errors.length) throw httpErr(400, errors.join(' · '), { errors });
      const dup = accounts().find(x => x.email.toLowerCase() === a.email.toLowerCase() && x.id !== a.id);
      if (dup) throw httpErr(409, t('acct.duplicate', { email: a.email }));
      const id = a.id || C.newAccountId();
      const needsPass = a.type !== 'gmail-oauth' && !pass && !SECRETS.accountStatus(id).hasPassword;
      if (needsPass) throw httpErr(400, a.type === 'gmail-password' ? t('acct.missingAppPassword') : t('acct.missingPassword'));
      const row = { ...a, id };
      const list = prev ? accounts().map(x => (x.id === id ? row : x)) : accounts().concat([row]);
      if (pass) SECRETS.setAccount(id, { imapPassword: pass });
      const makeActive = b.makeActive || !activeAccount();
      saveAccounts(list, makeActive ? id : undefined);
      if (prev && JSON.stringify(prev) !== JSON.stringify(row)) TOKENS.clear();
      if (!prev) { trackAccount(row); LOG.info(`cuenta agregada: ${row.email} (${row.type})`); }
      return { ok: true, account: accountView(row), accounts: accounts().map(accountView) };
    },
    'POST /api/accounts/delete': async (b) => {
      if (busy()) throw httpErr(409, t('api.busySettings'));
      const a = findAccount(b.id);
      if (!a) throw httpErr(404, t('acct.notFound'));
      if (a.type === 'gmail-oauth') { const rt = SECRETS.scope(a.id).get('googleRefreshToken'); if (rt) await oauth.revoke(rt, CFG().google.revokeUrl); }
      SECRETS.removeAccount(a.id);
      const list = accounts().filter(x => x.id !== a.id);
      saveAccounts(list, CFG().activeAccount === a.id ? (list[0] ? list[0].id : '') : undefined);
      TOKENS.clear();
      return { ok: true, accounts: list.map(accountView) };
    },
    'POST /api/accounts/active': (b) => {
      if (engine.busy()) throw httpErr(409, t('eng.busy'));
      if (!findAccount(b.id)) throw httpErr(404, t('acct.notFound'));
      saveConfig({ activeAccount: b.id });
      engine.lastScan = null;
      return publicConfig();
    },

    // ----- Google -----
    'POST /api/oauth/google/start': (b) => {
      const cfg = CFG();
      const gc = oauth.clientFor(cfg, SECRETS);
      const clientId = String(b.clientId || gc.clientId || '').trim();
      const clientSecret = String(b.clientSecret || '').trim() || gc.clientSecret;
      // sin cliente de Google en esta versión: la interfaz cae a la contraseña de aplicación
      if (!clientId || !clientSecret) throw httpErr(400, t('google.unavailable'), { unavailable: true });
      for (const [k, v] of PENDING_OAUTH) if (Date.now() - v.at > cfg.google.pendingTtlMs) PENDING_OAUTH.delete(k);
      const state = crypto.randomBytes(16).toString('hex');
      const { verifier, challenge } = oauth.createPkce();
      PENDING_OAUTH.set(state, { verifier, clientId, clientSecret, custom: !!(b.clientId || b.clientSecret) || gc.custom, accountId: b.accountId || '', loginHint: b.email || '', at: Date.now() });
      return { authUrl: oauth.buildAuthUrl({ clientId, redirectUri: redirectUri(), state, challenge, loginHint: b.email || undefined, authUrl: cfg.google.authUrl }) };
    },
    'POST /api/oauth/google/disconnect': async (b) => {
      if (busy()) throw httpErr(409, t('eng.busy'));
      const a = findAccount(b.id) || activeAccount();
      if (a) {
        const rt = SECRETS.scope(a.id).get('googleRefreshToken');
        if (rt) await oauth.revoke(rt, CFG().google.revokeUrl);
        SECRETS.setAccount(a.id, { googleRefreshToken: null });
      }
      TOKENS.clear();
      sse({ t: 'config', config: publicConfig() });
      return { ok: true, accounts: accounts().map(accountView) };
    },

    // ----- configurador inicial -----
    'GET /api/setup': async () => ({
      done: !!CFG().setup.done, language: i18n.language(), appearance: CFG().appearance, telemetry: !!CFG().telemetry.enabled,
      ollama: await OLL.status(), accounts: accounts().map(accountView), presets: CFG().presets, model: CFG().model,
    }),
    'POST /api/setup/prefs': (b) => {
      const next = {};
      if (b.language !== undefined) { if (b.language && !i18n.SUPPORTED.includes(b.language)) throw httpErr(400, t('val.language')); next.language = b.language || ''; }
      if (b.appearance) next.appearance = { ...CFG().appearance, ...(C.MODES.includes(b.appearance.mode) ? { mode: b.appearance.mode } : {}), ...(C.ACCENTS.includes(b.appearance.accent) ? { accent: b.appearance.accent } : {}) };
      if (typeof b.telemetry === 'boolean') next.telemetry = { ...CFG().telemetry, enabled: b.telemetry };
      if (typeof b.ai === 'boolean') next.llm = { ...CFG().llm, enabled: b.ai };
      if (typeof b.model === 'string' && b.model.trim()) next.model = b.model.trim();
      saveConfig(next);
      return { ok: true, language: i18n.language(), appearance: CFG().appearance, telemetry: CFG().telemetry.enabled, ai: CFG().llm.enabled };
    },
    'GET /api/setup/ollama': () => OLL.status(),
    'POST /api/setup/ollama/install': () => OLL.install(),
    'POST /api/setup/ollama/start': () => OLL.start(),
    'POST /api/setup/ollama/pull': (b) => OLL.pull(b.model),
    'POST /api/setup/ollama/cancel': () => { OLL.cancel(); return { ok: true }; },
    'POST /api/setup/finish': async () => {
      saveConfig({ setup: { ...CFG().setup, done: true } });
      LOG.info(`configurador terminado (idioma ${i18n.language()}, IA ${CFG().llm.enabled ? CFG().model : 'no'}, telemetría ${CFG().telemetry.enabled ? 'sí' : 'no'})`);
      await TEL.sendInstall(true).catch(() => {});
      TEL.flush().catch(() => {});
      return publicConfig();
    },

    // ----- Sincronizar -----
    'GET /api/sync': () => SYNC.view(),
    'POST /api/sync/start': (b) => SYNC.start({ origen: b.origen, destino: b.destino, dryRun: b.dryRun, folders: b.folders, excludeFolders: b.excludeFolders }),
    'POST /api/sync/stop': () => { SYNC.stop(); return { ok: true }; },

    // ----- Licencias -----
    'GET /api/licenses': () => ({
      prices: CFG().licenses.prices, serviceUrl: CFG().service.url, list: LIC.list(),
      accounts: accounts().map(a => ({ id: a.id, email: a.email, personal: esPersonal(a.email), gates: Object.fromEntries(TIPOS.map(tp => [tp, LIC.gate(a.email, tp)])) })),
    }),
    'POST /api/licenses': async (b) => {
      const r = await LIC.add(b.clave, { online: b.online !== false });
      if (!r.ok) throw httpErr(400, r.error);
      TEL.track('licencia', { cuenta: r.licencia.cuenta, tipo: r.licencia.tipo, canal: r.licencia.canal, vence: r.licencia.vence });
      LOG.info(`licencia agregada: ${r.licencia.cuenta} ${r.licencia.tipo} hasta ${r.licencia.vence}`);
      sse({ t: 'config', config: publicConfig() });
      return r;
    },
    // ----- sesión con el servicio (solo cuentas de dominio propio) -----
    'GET /api/auth': () => ({ ...AUTH.status(), required: algunaRequiereSesion(accounts()) }),
    'POST /api/auth/login': async (b) => authDone(await AUTH.login(b.email, b.password)),
    'POST /api/auth/confirm': async (b) => authDone(await AUTH.confirm(b.email, b.code, b.password)),
    'POST /api/auth/reset-request': (b) => AUTH.resetRequest(b.email),
    'POST /api/auth/reset-confirm': async (b) => authDone(await AUTH.resetConfirm(b.email, b.code, b.password)),
    'POST /api/auth/logout': () => authDone(AUTH.logout()),
    'POST /api/licenses/sync': async () => { const r = await AUTH.syncLicenses(); sse({ t: 'config', config: publicConfig() }); return { ...r, list: LIC.list() }; },
    'POST /api/licenses/delete': (b) => { LIC.remove(String(b.id || '')); sse({ t: 'config', config: publicConfig() }); return { ok: true, list: LIC.list() }; },
    'POST /api/licenses/gate': (b) => {
      if (!TIPOS.includes(b.tipo)) throw httpErr(400, t('api.badType'));
      return LIC.gate(Array.isArray(b.cuentas) ? b.cuentas : [b.cuenta], b.tipo);
    },

    // ----- sistema -----
    'POST /api/system/open-logs': () => {
      fs.mkdirSync(logsDir, { recursive: true });
      if (o.openPath) { o.openPath(logsDir); return { ok: true, path: logsDir }; }
      const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      try { const p = spawn(opener, [logsDir], { detached: true, stdio: 'ignore' }); p.on('error', () => {}); p.unref(); } catch (_) {}
      return { ok: true, path: logsDir };
    },
    // errores de la interfaz (JavaScript): al registro y a la telemetría de errores
    'POST /api/system/ui-error': (b) => {
      const msg = String((b && b.message) || '').slice(0, 500);
      if (msg) reportError(Object.assign(new Error(msg), { stack: `${msg}\n    at ${String((b && b.source) || 'ui').split('/').pop()}:${Number(b && b.line) || 0}` }), 'app');
      return { ok: true };
    },
    'GET /api/system/info': () => ({ version: PKG.version, dataDir, logsDir, platform: process.platform, arch: process.arch, desktop: !!o.desktop, installId: TEL.installId }),
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); };
    const deny = allowed(req);
    if (deny) return json(403, { error: t('api.forbidden'), reason: deny });
    const route = `${req.method} ${u.pathname}`;
    try {
      if (route === 'GET /' || route === 'GET /index.html') return serveIndex(res);
      if (route === 'GET /api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(`retry: ${CFG().http.sseRetryMs}\n\n`); clients.add(res);
        res.write(`data: ${JSON.stringify({ t: 'progress', job: engine.view() })}\n\n`);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (route === 'GET /oauth/google/callback') {
        const send = (code, ok, msg, retry) => { res.writeHead(code, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }); res.end(oauthPage(ok, msg, retry)); };
        const st = u.searchParams.get('state') || '';
        const p = PENDING_OAUTH.get(st);
        if (!p) return send(400, false, t('oauth.expired'));
        PENDING_OAUTH.delete(st);
        if (u.searchParams.get('error')) return send(400, false, t('oauth.googleSaid', { error: u.searchParams.get('error') }));
        if (busy()) return send(409, false, t('oauth.busy'));
        try {
          const tk = await oauth.exchangeCode({ clientId: p.clientId, clientSecret: p.clientSecret, code: u.searchParams.get('code'), verifier: p.verifier, redirectUri: redirectUri(), tokenUrl: CFG().google.tokenUrl });
          let a = (p.accountId && findAccount(p.accountId)) || accounts().find(x => x.type === 'gmail-oauth' && x.email.toLowerCase() === String(tk.email).toLowerCase());
          const isNew = !a;
          if (isNew) a = C.deepDefaults(C.ACCOUNT_DEFAULT, { id: C.newAccountId(), type: 'gmail-oauth', provider: 'gmail', email: tk.email });
          else a = { ...a, type: 'gmail-oauth', provider: 'gmail', email: tk.email || a.email };
          const list = isNew ? accounts().concat([a]) : accounts().map(x => (x.id === a.id ? a : x));
          if (p.custom && p.clientSecret) SECRETS.set({ googleClientSecret: p.clientSecret }); // solo el cliente propio del usuario
          SECRETS.setAccount(a.id, { googleRefreshToken: tk.refreshToken });
          const nextCfg = { accounts: list, activeAccount: activeAccount() && !isNew ? CFG().activeAccount : (CFG().activeAccount || a.id) };
          if (p.custom && p.clientId !== CFG().google.clientId) nextCfg.google = { ...CFG().google, clientId: p.clientId };
          saveConfig(nextCfg);
          TOKENS.clear(); TOKENS.seed(tk.refreshToken, tk.accessToken, tk.expiresAt);
          // se prueba la conexión; si falla en una cuenta nueva, no se deja a medias
          const test = await testAccount({ account: { id: a.id } });
          if (!test.mail.ok && isNew) {
            SECRETS.removeAccount(a.id); TOKENS.clear();
            saveConfig({ accounts: accounts().filter(x => x.id !== a.id), activeAccount: CFG().activeAccount === a.id ? '' : CFG().activeAccount });
            sse({ t: 'google', ok: false, email: tk.email, error: test.mail.error });
            return send(400, false, test.mail.error);
          }
          if (isNew) trackAccount(a);
          emit('sys', t('oauth.connectedLog', { email: tk.email }), 'info');
          sse({ t: 'google', ok: true, email: tk.email, test: { ok: !!test.mail.ok, error: test.mail.ok ? null : test.mail.error } });
          return send(200, true, t('oauth.connectedAs', { email: tk.email }));
        } catch (e) {
          // sin el permiso de Gmail: un botón que vuelve a abrir Google con una solicitud nueva (misma cuenta y cliente)
          let retry = null;
          if (e.code === 'noGmailScope') {
            const state = crypto.randomBytes(16).toString('hex'), { verifier, challenge } = oauth.createPkce();
            PENDING_OAUTH.set(state, { ...p, verifier, at: Date.now() });
            retry = oauth.buildAuthUrl({ clientId: p.clientId, redirectUri: redirectUri(), state, challenge, loginHint: p.loginHint || undefined, authUrl: CFG().google.authUrl });
          } else reportError(e, 'cuenta');
          sse({ t: 'google', ok: false, error: e.message });
          return send(400, false, e.message, retry);
        }
      }
      if (req.method === 'GET' && !u.pathname.startsWith('/api/') && serveStatic(res, u.pathname)) return;
      const fn = routes[route];
      if (!fn) { res.writeHead(404); return res.end('not found'); }
      let body = {};
      if (req.method === 'POST') {
        try { body = JSON.parse((await readBody(req, CFG().http.maxBodyBytes)) || '{}'); }
        catch (e) { return json(e.code === 413 ? 413 : 400, { error: t('api.badJson') }); }
      }
      return json(200, await fn(body, u));
    } catch (e) {
      const code = Number.isInteger(e.code) && e.code >= 400 && e.code < 600 ? e.code : 500;
      if (code === 500) reportError(e, 'app');
      return json(code, { error: e.message, ...(e.gate ? { gate: e.gate } : {}), ...(e.errors ? { errors: e.errors } : {}), ...(e.unavailable ? { unavailable: true } : {}) });
    }
  });

  // ---------- actualización automática (solo la app de escritorio empaquetada) ----------
  const UPD = new Updater({
    kind: o.updates ? o.updates.kind : 'dev', current: PKG.version, apiUrl: CFG().updates.apiUrl || releasesApiUrl(PKG),
    getConfig: CFG, autoUpdater: o.updates ? o.updates.autoUpdater : null, quitAndInstall: o.updates ? o.updates.quitAndInstall : null,
    busy: () => !!(busy() || OLL.task), fetch: o.fetch, log: LOG, report: reportError, emit: (update) => sse({ t: 'update', update }),
  });

  const host = o.host || CFG().host;
  const wantPort = o.port !== undefined ? o.port : (o.desktop ? CFG().desktopPort : CFG().port); // escritorio: puerto libre
  await new Promise((res, rej) => { server.once('error', rej); server.listen(wantPort, host, () => { server.off('error', rej); res(); }); });
  PORT = server.address().port;
  const url = `http://127.0.0.1:${PORT}/`;
  LOG.info(`NoniMail Tools ${PKG.version} en ${url} (datos: ${dataDir}${SECRETS.encrypted ? ', secretos cifrados' : ''})`);
  TEL.track('inicio', {});
  TEL.start();
  TEL.flush().catch(() => {});
  if (o.updates) UPD.start(CFG().updates.startDelayMs, CFG().updates.intervalMs);

  let closed = false;
  async function close() {
    if (closed) return; closed = true;
    clearInterval(metricsTimer); UPD.stop();
    engine.stop(); SYNC.stop(); OLL.cancel();
    for (const r of clients) { try { r.end(); } catch (_) {} }
    clients.clear();
    await TEL.shutdown();
    const done = new Promise(r => server.close(() => r()));
    if (server.closeAllConnections) server.closeAllConnections();
    await done;
  }

  return {
    url, port: PORT, server, dataDir, logsDir, close, reportError,
    cfg: CFG, updater: UPD, auth: AUTH, store: STORE, engine, sync: SYNC, telemetry: TEL, licenses: LIC, log: LOG, busy, working: () => !!(busy() || OLL.task),
    created: STORE.created, migratedFrom: STORE.migratedFrom,
  };
}

module.exports = { createApp, CSP };
