// ============================================================================
// MOTOR DE SINCRONIZACIÓN IMAP → IMAP  (el mismo algoritmo del servicio web)
// ----------------------------------------------------------------------------
// Copia del ORIGEN al DESTINO todo lo que falta, sin tocar nunca el origen.
//   1. Conecta origen y destino (TLS verificado salvo tlsInsecure).
//   2. Enumera carpetas seleccionables del origen; quita las virtuales de Gmail
//      (\Important, \Flagged) y deja "Todos" (\All) al final.
//   3. Por carpeta: indexa ambos lados por IDENTIDAD de mensaje (multiconjunto) y
//      copia solo lo que falta, preservando flags e INTERNALDATE.
//   4. Verifica end-to-end con conexiones nuevas: origen ⊆ destino por carpeta.
//
// El motor no sabe nada de cuentas ni de licencias: reporta por callbacks (onLog/onProgress).
// Nada de cuerpos para indexar: ENVELOPE + RFC822.SIZE + FLAGS + INTERNALDATE en
// lotes por rango de UID. El cuerpo se baja solo al copiar, mensaje a mensaje.
// ============================================================================
'use strict';
const { createHash } = require('crypto');
const { ImapFlow } = require('imapflow');
const { t } = require('../i18n');
const { pick } = require('../defaults');

const MAX_ERROR_SAMPLES = 5;
// Carpetas *virtuales* (RFC 6154): sus mensajes ya viven en otras carpetas.
// "Importantes" y "Destacados" de Gmail son siempre subconjunto de "Todos".
const VIRTUAL_USES = new Set(['\\important', '\\flagged']);
// "Todos" contiene TODO, incluidos archivados que no están en otra carpeta: no se
// puede omitir; se procesa al final y solo copia lo que no está en otra carpeta.
const ALL_USE = '\\all';
// Carpetas especiales que se fusionan con su equivalente del destino.
const MAPPABLE_USES = new Set(['\\sent', '\\trash', '\\drafts', '\\junk', '\\archive', ALL_USE]);
// Flags que NO se pueden (ni deben) fijar con APPEND.
const UNSETTABLE_FLAGS = new Set(['\\recent']);

// ===== IDENTIDAD DE MENSAJE =====
// 1) Message-ID normalizado → "mid:<...>".  2) Si no hay → "h:" + sha1(fecha, de,
// para, asunto, tamaño). Se compara como multiconjunto (Map de conteos).
function normMessageId(raw) {
  let s = raw == null ? '' : String(raw).trim();
  if (!s) return '';
  if (!s.startsWith('<')) s = '<' + s;
  if (!s.endsWith('>')) s += '>';
  return s;
}

function addrRepr(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return list.map((a) => {
    // imapflow da {name, address:"buzon@host"}; se tolera también {mailbox, host}.
    const addr = a?.address ?? (a?.mailbox != null ? `${a.mailbox}@${a.host ?? ''}` : '');
    return String(addr).toLowerCase();
  }).sort().join(',');
}

function messageIdentity(envelope, size) {
  const env = envelope || {};
  const mid = normMessageId(env.messageId ?? env.message_id);
  if (mid) return 'mid:' + mid;
  const d = env.date;
  const dateS = d instanceof Date ? (isNaN(d) ? '' : d.toISOString()) : (d == null ? '' : String(d));
  const subject = env.subject == null ? '' : String(env.subject).trim();
  const basis = [dateS, addrRepr(env.from ?? env.from_), addrRepr(env.to), subject, String(size || 0)].join('\x1f');
  return 'h:' + createHash('sha1').update(basis, 'utf8').digest('hex');
}

// ===== MULTICONJUNTOS =====
function countIds(metas) {
  const m = new Map();
  for (const x of metas) m.set(x.identity, (m.get(x.identity) || 0) + 1);
  return m;
}
const sumCounts = (m) => { let n = 0; for (const v of m.values()) n += v; return n; };
// consume 1 unidad de `id` si hay; true si la había.
function take(m, id) {
  const n = m.get(id) || 0;
  if (n <= 0) return false;
  m.set(id, n - 1);
  return true;
}

// ===== CONEXIONES =====
const errMsg = (e) => {
  if (!e) return t('sync.unknownError');
  const base = e.message || e.name || String(e);
  return e.responseText && !base.includes(e.responseText) ? `${base}: ${e.responseText}` : base;
};

// mb: { host, port, secure, auth: { user, pass } | { user, accessToken }, tlsInsecure }
// (también acepta user/pass sueltos, como el servicio web)
async function connect(mb, side, opts = {}) {
  const { host, port = 993, secure = true, tlsInsecure = false } = mb || {};
  const auth = mb && mb.auth ? mb.auth : { user: mb && mb.user, pass: mb && mb.pass };
  const sideName = t(`sync.side.${side}`);
  if (!host || !auth.user || (auth.pass == null && !auth.accessToken)) throw new Error(t('sync.missingCreds', { side: sideName }));
  const p = Number(port) || 993;
  const c = new ImapFlow({
    host, port: p, secure: secure !== false, auth, logger: false,
    tls: { rejectUnauthorized: !tlsInsecure },
    connectionTimeout: opts.connectionTimeout, greetingTimeout: opts.greetingTimeout,
    // 30 min por defecto (mínimo de autologout del RFC): indexar "Todos" en el origen puede
    // dejar la conexión del destino quieta varios minutos.
    socketTimeout: opts.socketTimeout,
  });
  // imapflow emite 'error' si el socket cae; sin oyente tumba el proceso. El
  // siguiente comando fallará y lo recoge el try/catch del motor.
  c.on('error', () => {});
  try { await c.connect(); }
  catch (e) { throw new Error(t('sync.connectFailed', { side: sideName, host, port: p, error: errMsg(e) })); }
  return c;
}

async function closeQuietly(c) {
  if (!c) return;
  try { await c.logout(); } catch { try { c.close(); } catch {} }
}

// Deselecciona (CLOSE) la carpeta abierta. imapflow filtra los flags del APPEND
// con los PERMANENTFLAGS de la carpeta seleccionada: un EXAMINE suele traer
// PERMANENTFLAGS () y se perderían todos. Solo abrimos en solo-lectura, así que
// CLOSE nunca expulsa nada (RFC 3501 §6.4.2).
async function unselect(c) {
  if (c.mailbox && c.mailbox.readOnly) await c.mailboxClose();
}

// Igual que imapflow: INBOX sin mayúsculas y prefijo de namespace si falta. Así
// el nombre que comparamos con LIST es el mismo al que se hace CREATE/APPEND.
function nsPath(c, path) {
  if (path.toUpperCase() === 'INBOX') return 'INBOX';
  const prefix = c.namespace?.prefix;
  return prefix && !path.startsWith(prefix) ? prefix + path : path;
}

// ===== CARPETAS =====
// [{name, delim, special}] de las carpetas seleccionables. special = atributo
// RFC 6154 en minúsculas ("\\sent"…) o "". Se leen los flags del LIST y, si no hay,
// el specialUse que imapflow deduce (por extensión o por nombre conocido).
async function listFoldersMeta(c) {
  const out = [];
  for (const b of await c.list()) {
    const flags = new Set([...(b.flags || [])].map((f) => String(f).toLowerCase()));
    if (flags.has('\\noselect') || flags.has('\\nonexistent')) continue;
    let special = [...flags].sort().find((f) => MAPPABLE_USES.has(f) || VIRTUAL_USES.has(f)) || '';
    if (!special && b.specialUse) {
      const su = String(b.specialUse).toLowerCase();
      if (MAPPABLE_USES.has(su) || VIRTUAL_USES.has(su)) special = su;
    }
    out.push({ name: b.path, delim: b.delimiter || '/', special });
  }
  return out;
}

async function listPaths(c) {
  return new Set((await listFoldersMeta(c)).map((f) => f.name));
}

const lowerSet = (arr) => new Set((arr || []).map((f) => String(f).trim().toLowerCase()).filter(Boolean));

// Quita las virtuales que solo duplican (salvo lista blanca) y deja "Todos" al final.
function planSourceFolders(metas, include, log) {
  const normal = [], allMail = [];
  for (const f of metas) {
    if (VIRTUAL_USES.has(f.special) && !include.has(f.name.toLowerCase())) {
      log(t('sync.log.virtual', { folder: f.name, special: f.special }));
      continue;
    }
    (f.special === ALL_USE ? allMail : normal).push(f);
  }
  return normal.concat(allMail);
}

function translateName(name, srcDelim, dstDelim) {
  if (name.toUpperCase() === 'INBOX') return 'INBOX';
  if (srcDelim && dstDelim && srcDelim !== dstDelim) return name.split(srcDelim).join(dstDelim);
  return name;
}

// Crea la carpeta destino (y sus padres) si no existe. `paths` = caché del LIST.
async function ensureDestFolder(dest, name, delim, paths, log) {
  if (name.toUpperCase() === 'INBOX' || paths.has(name)) return;
  const create = async (p) => {
    try { await dest.mailboxCreate(p); paths.add(p); }
    catch (e) {
      // ¿ya existía sin avisar ALREADYEXISTS? Se confirma con un LIST nuevo.
      const fresh = await listPaths(dest);
      if (fresh.has(p)) { paths.add(p); return; }
      if (p === name) log(t('sync.log.createFailed', { folder: name, error: errMsg(e) }));
    }
  };
  if (delim && name.includes(delim)) {
    let acc = '';
    for (const part of name.split(delim)) {
      acc = acc ? `${acc}${delim}${part}` : part;
      if (acc.toUpperCase() === 'INBOX' || paths.has(acc)) continue;
      await create(acc);
    }
  } else {
    await create(name);
  }
}

// ===== INDEXADO POR IDENTIDAD =====
// UID SEARCH ALL y luego FETCH por lotes de rango contiguo lo:hi (entre dos UIDs
// existentes no pueden aparecer UIDs nuevos, así que el rango = el lote).
async function indexFolder(c, folder, fetchBatch) {
  await c.mailboxOpen(folder, { readOnly: true });
  const uids = ((await c.search({ all: true }, { uid: true })) || []).slice().sort((a, b) => a - b);
  const byUid = new Map();
  for (let i = 0; i < uids.length; i += fetchBatch) {
    const chunk = uids.slice(i, i + fetchBatch);
    const range = `${chunk[0]}:${chunk[chunk.length - 1]}`;
    const query = { uid: true, envelope: true, size: true, flags: true, internalDate: true };
    for await (const m of c.fetch(range, query, { uid: true })) {
      if (!m.uid) continue;
      byUid.set(m.uid, {
        uid: m.uid, identity: messageIdentity(m.envelope, m.size), size: m.size || 0,
        flags: m.flags || new Set(), internalDate: m.internalDate || null,
      });
    }
  }
  return [...byUid.values()].sort((a, b) => a.uid - b.uid);
}

async function destIdentityCounter(dest, folder, paths, fetchBatch) {
  if (folder.toUpperCase() !== 'INBOX' && !paths.has(folder)) return new Map();
  return countIds(await indexFolder(dest, folder, fetchBatch));
}

const cleanFlags = (flags) => [...(flags || [])].map(String).filter((f) => !UNSETTABLE_FLAGS.has(f.toLowerCase()));

// ===== COPIA DE UNA CARPETA =====
async function copyFolder(ctx, source, dest, srcName, dstName) {
  const { log, progress, cancel, dryRun, maxBytes, fetchBatch, progressEvery } = ctx;
  const res = { source: srcName, dest: dstName, sourceCount: 0, existing: 0, toCopy: 0, copied: 0, errors: 0, bytes: 0, errorSamples: [] };
  const fail = (uid, msg) => { res.errors++; if (res.errorSamples.length < MAX_ERROR_SAMPLES) res.errorSamples.push(`uid ${uid}: ${msg}`); };

  let srcMetas = await indexFolder(source, srcName, fetchBatch);
  const skip = ctx.skipIds.get(srcName);
  if (skip) {
    const before = srcMetas.length;
    const pending = new Map(skip);
    srcMetas = srcMetas.filter((m) => !take(pending, m.identity));
    log(t('sync.log.allMailSkip', { folder: srcName, skipped: before - srcMetas.length, left: srcMetas.length }));
  }
  res.sourceCount = srcMetas.length;

  // Qué copiar, consumiendo del multiconjunto del destino (duplicados legítimos se respetan).
  const destCounter = await destIdentityCounter(dest, dstName, ctx.dstPaths, fetchBatch);
  const toCopy = [];
  for (const m of srcMetas) {
    if (take(destCounter, m.identity)) res.existing++;
    else toCopy.push(m);
  }
  res.toCopy = toCopy.length;
  log(t('sync.log.folderPlan', { folder: srcName, source: res.sourceCount, existing: res.existing, toCopy: res.toCopy }));
  if (dryRun || !toCopy.length) return res;

  await source.mailboxOpen(srcName, { readOnly: true });
  await unselect(dest);
  for (const m of toCopy) {
    if (cancel()) break;
    if (maxBytes && ctx.transferred + m.size > maxBytes) {
      ctx.overLimit = true;
      log(t('sync.log.limit', { folder: srcName, bytes: ctx.transferred }));
      break;
    }
    try {
      const msg = await source.fetchOne(String(m.uid), { uid: true, source: true }, { uid: true });
      const raw = msg && msg.source;
      if (!raw || !raw.length) { fail(m.uid, t('sync.emptyBody')); continue; }
      const r = await dest.append(dstName, raw, cleanFlags(m.flags), m.internalDate || undefined);
      if (!r) throw new Error(t('sync.appendNoReply'));
      res.copied++;
      res.bytes += raw.length;
      ctx.transferred += raw.length;
      if (res.copied % progressEvery === 0) progress({ folder: srcName, copied: res.copied, folderTotal: toCopy.length, bytes: ctx.transferred });
    } catch (e) {
      // Un mensaje no aborta la carpeta… salvo que la conexión haya muerto.
      if (!source.usable || !dest.usable) throw new Error(t('sync.connectionLost', { folder: srcName, error: errMsg(e) }));
      fail(m.uid, errMsg(e));
    }
  }
  if (res.copied % progressEvery !== 0) progress({ folder: srcName, copied: res.copied, folderTotal: toCopy.length, bytes: ctx.transferred });
  return res;
}

// ===== VERIFICACIÓN E2E =====
// Conexiones nuevas e independientes; por carpeta: multiconjunto del origen (menos
// lo que "Todos" no copia) ⊆ multiconjunto del destino.
async function verify(ctx, origen, destino, mapping) {
  const report = { ok: true, missing: 0, folders: [] };
  let source, dest;
  try {
    source = await connect(origen, 'origen', ctx.imap);
    dest = await connect(destino, 'destino', ctx.imap);
    const dstPaths = await listPaths(dest);
    for (const { src, dst } of mapping) {
      const srcCounter = countIds(await indexFolder(source, src, ctx.fetchBatch));
      const skip = ctx.skipIds.get(src);
      if (skip) {
        for (const [id, n] of skip) {
          if (!srcCounter.has(id)) continue;
          const left = srcCounter.get(id) - n;
          if (left > 0) srcCounter.set(id, left); else srcCounter.delete(id);
        }
      }
      const dstCounter = await destIdentityCounter(dest, dst, dstPaths, ctx.fetchBatch);
      let missing = 0, matched = 0;
      const samples = [];
      for (const [id, n] of srcCounter) {
        const have = dstCounter.get(id) || 0;
        matched += Math.min(n, have);
        if (have < n) { missing += n - have; if (samples.length < 20) samples.push(`${id} x${n - have}`); }
      }
      report.folders.push({ folder: src, sourceCount: sumCounts(srcCounter), destCount: sumCounts(dstCounter), matched, missing });
      report.missing += missing;
      if (missing && !ctx.dryRun) ctx.log(t('sync.log.verifyMissing', { folder: src, missing, dest: dst, samples: samples.slice(0, 5).join(', ') }));
    }
  } finally {
    await closeQuietly(source);
    await closeQuietly(dest);
  }
  report.ok = report.missing === 0;
  return report;
}

function summary(r) {
  const x = r.totals;
  const parts = [t('sync.summary', { folders: r.folders.length, source: x.source, copied: x.copied, errors: x.errors, bytes: x.bytes })];
  if (r.verification) parts.push(r.verification.ok ? t('sync.summary.verified') : t('sync.summary.missing', { missing: r.verification.missing }));
  if (r.dryRun) parts.push(t('sync.summary.dry'));
  if (r.cancelled) parts.push(t('sync.summary.cancelled'));
  if (r.overLimit) parts.push(t('sync.summary.limit'));
  return parts.join(' · ');
}

// ===== ORQUESTACIÓN =====
// options (de la configuración, sync.* e imap.*): { fetchBatch, progressEvery, socketTimeoutMs, connectionTimeoutMs, greetingTimeoutMs }
async function runSync({
  origen,
  destino,
  dryRun = true,
  folders = [],
  excludeFolders = [],
  maxBytes = 0,
  options = {},
  onLog = () => {},
  onProgress = () => {},
  shouldCancel = () => false,
} = {}) {
  const t0 = Date.now();
  const log = (s) => { try { onLog(s); } catch {} };
  const progress = (o) => { try { onProgress(o); } catch {} };
  const cancel = () => { try { return !!shouldCancel(); } catch { return false; } };
  const result = {
    ok: false, dryRun: !!dryRun, cancelled: false, overLimit: false, error: null, durationMs: 0,
    folders: [], totals: { source: 0, existing: 0, toCopy: 0, copied: 0, errors: 0, bytes: 0 }, verification: null,
  };
  const ctx = {
    log, progress, cancel, dryRun: !!dryRun, maxBytes: Math.max(0, Number(maxBytes) || 0),
    transferred: 0, overLimit: false,
    fetchBatch: options.fetchBatch || pick({}, 'sync.fetchBatch'),
    progressEvery: options.progressEvery || pick({}, 'sync.progressEvery'),
    imap: {
      socketTimeout: options.socketTimeoutMs || pick({}, 'sync.socketTimeoutMs'),
      connectionTimeout: options.connectionTimeoutMs || pick({}, 'imap.connectionTimeoutMs'),
      greetingTimeout: options.greetingTimeoutMs || pick({}, 'imap.greetingTimeoutMs'),
    },
    // Por carpeta "Todos": multiconjunto de lo que NO se copia porque ya viaja con
    // otra carpeta. Se reutiliza en la verificación.
    skipIds: new Map(), dstPaths: new Set(),
  };

  try {
    let source, dest;
    try {
      source = await connect(origen, 'origen', ctx.imap);
      dest = await connect(destino, 'destino', ctx.imap);

      const include = lowerSet(folders);
      const exclude = lowerSet(excludeFolders);
      const srcFolders = planSourceFolders(await listFoldersMeta(source), include, log)
        .filter((f) => (!include.size || include.has(f.name.toLowerCase())) && !exclude.has(f.name.toLowerCase()));

      // Delimitador del destino (para traducir jerarquías) y sus carpetas especiales.
      const dstMeta = await listFoldersMeta(dest);
      const dstDelim = dstMeta.find((f) => f.delim)?.delim || dest.namespace?.delimiter || '/';
      ctx.dstPaths = new Set(dstMeta.map((f) => f.name));
      const dstSpecial = new Map();
      for (const f of dstMeta) if (MAPPABLE_USES.has(f.special) && !dstSpecial.has(f.special)) dstSpecial.set(f.special, f.name);

      const mapping = [];
      for (const f of srcFolders) {
        let dst;
        if (dstSpecial.has(f.special)) {
          dst = dstSpecial.get(f.special);
          if (dst !== f.name) log(t('sync.log.merge', { folder: f.name, dest: dst, special: f.special }));
        } else {
          dst = nsPath(dest, translateName(f.name, f.delim, dstDelim));
        }
        mapping.push({ src: f.name, dst, delim: dstDelim });
        if (f.special === ALL_USE && srcFolders.length > 1) {
          // Lo que está en otra carpeta del origen ya viaja con esa carpeta.
          const others = new Map();
          for (const o of srcFolders) {
            if (o.name === f.name || o.special === ALL_USE) continue;
            for (const m of await indexFolder(source, o.name, ctx.fetchBatch)) others.set(m.identity, (others.get(m.identity) || 0) + 1);
          }
          ctx.skipIds.set(f.name, others);
        }
      }

      log(t('sync.log.folders', { n: mapping.length }));
      for (const { src, dst, delim } of mapping) {
        if (cancel()) { result.cancelled = true; break; }
        if (!ctx.dryRun) await ensureDestFolder(dest, dst, delim, ctx.dstPaths, log);
        result.folders.push(await copyFolder(ctx, source, dest, src, dst));
        progress({ folder: src, foldersDone: result.folders.length, foldersTotal: mapping.length });
        if (ctx.overLimit) { result.overLimit = true; break; }
      }
    } finally {
      await closeQuietly(source);
      await closeQuietly(dest);
    }

    if (cancel()) result.cancelled = true;

    // Verificación E2E (también en simulación: confirma el estado real).
    if (!result.cancelled) {
      const done = result.folders.map((f) => ({ src: f.source, dst: f.dest }));
      result.verification = await verify(ctx, origen, destino, done);
      const v = result.verification;
      log(v.ok ? t('sync.log.verifyOk') : ctx.dryRun ? t('sync.log.verifyDry', { missing: v.missing }) : t('sync.log.verifyFail', { missing: v.missing }));
    }
  } catch (e) {
    result.error = errMsg(e);
    log(t('sync.log.error', { error: result.error }));
  } finally {
    for (const f of result.folders) {
      result.totals.source += f.sourceCount;
      result.totals.existing += f.existing;
      result.totals.toCopy += f.toCopy;
      result.totals.copied += f.copied;
      result.totals.errors += f.errors;
      result.totals.bytes += f.bytes;
    }
    result.ok = !result.error && !result.cancelled && !result.overLimit && (result.dryRun || !!result.verification?.ok);
    result.durationMs = Date.now() - t0;
    log(t('sync.log.end', { s: (result.durationMs / 1000).toFixed(1), summary: summary(result) }));
  }
  return result;
}

module.exports = { runSync, messageIdentity };
