'use strict';
// Clasificación pura (sin E/S): remitentes, reglas, protecciones y decisión por dureza.

function parseFrom(from) {
  if (!from) return { email: '(desconocido)', name: '' };
  const m = from.match(/<([^>]+)>/);
  const email = (m ? m[1] : from).trim().toLowerCase();
  let name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  if (!name) name = email;
  return { email, name };
}

// Dominio con el que se agrupa un remitente: los dos últimos tramos (empresa.com), tres si es del tipo
// empresa.com.gt / empresa.co.uk. Quien llama lo guarda en minúsculas.
const SEGUNDO_NIVEL = new Set(['com', 'net', 'org', 'co', 'gov', 'gob', 'edu', 'mil', 'ac', 'go']);
function dominio(email) {
  const at = String(email || '').lastIndexOf('@');
  if (at < 0) return '';
  const p = String(email).slice(at + 1).trim().toLowerCase().split('.').filter(Boolean);
  if (p.length <= 2) return p.join('.');
  const n = p[p.length - 1].length === 2 && SEGUNDO_NIVEL.has(p[p.length - 2]) ? 3 : 2;
  return p.slice(-n).join('.');
}

// Reglas por remitente con herencia: la del remitente manda (excepción) y, si no tiene, vale la de su dominio ('@empresa.com').
function reglaDe(reglas, email) {
  return reglas[email] || reglas['@' + dominio(email)] || undefined;
}

function shortSubj(s, n = 55) { s = s || '–'; return s.length > n ? s.slice(0, n) + '...' : s; }

// Un patrón vacío NUNCA coincide: new RegExp('') coincidiría con todo y borraría la bandeja entera.
function compilePattern(src) {
  const s = String(src || '').trim();
  return s ? new RegExp(s, 'i') : null;
}
function compileRules(h = {}) {
  return {
    keep: compilePattern(h.keepOverride),
    subject: compilePattern(h.subject),
    from: compilePattern(h.from),
    body: compilePattern(h.body),
  };
}
const test = (rx, s) => !!rx && rx.test(s || '');

// regla 'delete' DESPROTEGE (gana sobre el regex financiero); 'protect' siempre conserva
function isProtected(rules, senderRules, email, subject, from) {
  const r = reglaDe(senderRules, email);
  if (r === 'delete') return false;
  if (r === 'protect') return true;
  return test(rules.keep, subject) || test(rules.keep, from);
}

const REPLY_SUBJ = /^\s*(re|rv|res|fw|fwd|tr|aw|wg|sv|vs)\s*(\[\d+\])?\s*:/i;
// ¿parece parte de una conversación por sus cabeceras?
function looksLikeReply(meta) {
  return !!(meta.inReplyTo || (meta.references && meta.references.trim()) || REPLY_SUBJ.test(meta.subject || ''));
}

// Hilo con algún mensaje mío, o ida y vuelta entre 2+ remitentes distintos
function isConversation(fromAddresses, myAddresses) {
  const senders = new Set();
  for (const a of fromAddresses) {
    const e = String(a || '').trim().toLowerCase();
    if (!e) continue;
    if (myAddresses.has(e)) return true;
    senders.add(e);
  }
  return senders.size >= 2;
}

// Puntaje de ruido 0-100 contra la dureza: borra solo lo claro, en el medio queda la duda
function decide(score, dureza, band) {
  if (score == null) return null;
  const T = 100 - dureza;
  if (score >= T + band) return 'delete';
  if (score <= T - band) return 'keep';
  return 'duda';
}

// Sin IA: puntaje 0-100 por señales (envío masivo y los patrones de ruido de asunto, remitente y cuerpo).
// Los pesos vienen de heuristicScore en la configuración.
function heuristicScore(rules, w, { subjects = [], from = '', bulk = false, body = '' }) {
  let s = w.base;
  if (bulk) s += w.bulk;
  if (subjects.some(x => test(rules.subject, x))) s += w.subject;
  if (test(rules.from, from)) s += w.from;
  if (test(rules.body, body)) s += w.body;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Nombres de las reglas de ruido que coinciden (para el filtro colectivo; no se envía su texto)
function matchedRules(rules, { subjects = [], from = '', body = '' }) {
  const r = [];
  if (subjects.some(x => test(rules.subject, x))) r.push('subject');
  if (test(rules.from, from)) r.push('from');
  if (test(rules.body, body)) r.push('body');
  return r;
}

// Capa de reputación colectiva: { score, kind: 'eliminar'|'conservar', pct } o null. Solo con n suficiente.
function reputationVerdict(rep, { minN = 10, alto = 90, bajo = 10 } = {}) {
  if (!rep || !Number.isFinite(rep.eliminar_pct) || !Number.isFinite(rep.n) || rep.n < minN) return null;
  if (rep.eliminar_pct >= alto) return { score: 95, kind: 'eliminar', pct: rep.eliminar_pct };
  if (rep.eliminar_pct <= bajo) return { score: 5, kind: 'conservar', pct: rep.eliminar_pct };
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

module.exports = { dominio, reglaDe, parseFrom, shortSubj, compilePattern, compileRules, isProtected, looksLikeReply, isConversation, decide, htmlToText, heuristicScore, matchedRules, reputationVerdict };
