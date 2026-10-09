'use strict';
// Envío por SMTP (solo para bajas por correo, "mailto:" de List-Unsubscribe).
const nodemailer = require('nodemailer');

function transport(o) {
  return nodemailer.createTransport({
    host: o.host, port: o.port, secure: o.secure, requireTLS: o.requireTLS ?? !o.secure, auth: o.auth,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
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

// mailto:baja@x.com?subject=..&body=.. → { to, subject, body }
function parseMailto(url) {
  const m = String(url).match(/^mailto:([^?]+)(?:\?(.*))?$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[2] || '');
  return { to: decodeURIComponent(m[1]).trim(), subject: q.get('subject') || 'unsubscribe', body: q.get('body') || 'Please unsubscribe me. Solicito la baja.' };
}

module.exports = { verify, send, parseMailto };
