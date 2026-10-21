'use strict';
// Envío por SMTP (solo para bajas por correo, "mailto:" de List-Unsubscribe).
const nodemailer = require('nodemailer');
const { pick } = require('../defaults');

// o: { host, port, secure, requireTLS?, auth, tls?, timeouts? (smtp.* en la configuración) }
function transport(o) {
  const to = { ...pick({}, 'smtp'), ...(o.timeouts || {}) };
  return nodemailer.createTransport({
    host: o.host, port: o.port, secure: o.secure, requireTLS: o.requireTLS ?? !o.secure, auth: o.auth,
    connectionTimeout: to.connectionTimeoutMs, greetingTimeout: to.greetingTimeoutMs, socketTimeout: to.socketTimeoutMs,
    tls: o.tls,
  });
}

async function verify(o) {
  const t = transport(o);
  try { await t.verify(); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { t.close(); }
}

async function send(o, msg) {
  const t = transport(o);
  try { const info = await t.sendMail(msg); return { ok: true, id: info.messageId }; }
  catch (e) { return { ok: false, error: e.message }; }
  finally { t.close(); }
}

// mailto:baja@x.com?subject=.. → { to, subject, body }
// La URL la escribe el remitente y el correo sale de TU cuenta: un solo destinatario, cuerpo fijo,
// y el asunto solo si es una palabra de baja (los ESP a veces lo exigen). Así un correo malicioso
// no puede usar la baja para mandar phishing desde tu dirección a otras personas.
const FIXED_BODY = 'Please unsubscribe me from this list. / Por favor, denme de baja de esta lista.';
const SINGLE_ADDR = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const UNSUB_SUBJECT = /^\s*(unsubscribe|unsub|remove|opt[- ]?out|cancel(ar)?( suscripci[oó]n)?|baja|darme de baja|leave|signoff)\b[\w\s.:#=+@-]{0,60}$/i;
function parseMailto(url) {
  const m = String(url).match(/^mailto:([^?]+)(?:\?(.*))?$/i);
  if (!m) return null;
  let to;
  try { to = decodeURIComponent(m[1]).trim(); } catch (_) { return null; }
  if (!SINGLE_ADDR.test(to)) return null; // nada de listas (",", ";"), espacios ni nombres
  const subj = new URLSearchParams(m[2] || '').get('subject') || '';
  return { to, subject: UNSUB_SUBJECT.test(subj) && !/https?:|www\./i.test(subj) ? subj.trim() : 'unsubscribe', body: FIXED_BODY };
}

module.exports = { verify, send, parseMailto };
