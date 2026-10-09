'use strict';
// Bajas de listas (List-Unsubscribe): one-click POST (RFC 8058), mailto por SMTP, o GET.
// Las URLs las escribe el remitente: solo https y nunca hacia la red local (evita que un correo
// malicioso haga que esta PC visite el router u otros equipos de la LAN).
const net = require('net');
const dns = require('dns').promises;
const smtp = require('./mail/smtp');

function parseListUnsubscribe(lu) {
  const urls = [...String(lu || '').matchAll(/<([^>]+)>/g)].map(x => x[1].trim());
  return { https: urls.find(u => /^https:/i.test(u)) || null, mailto: urls.find(u => /^mailto:/i.test(u)) || null };
}

function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || /\.(local|localhost|lan|internal|home|corp)$/.test(h) || !h.includes('.') && !net.isIP(h)) return true;
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(h)) return h === '::1' || h === '::' || /^(fc|fd|fe8|fe9|fea|feb)/.test(h) || h.startsWith('::ffff:');
  return false;
}

function safeHttps(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && !isPrivateHost(u.hostname); } catch (_) { return false; }
}

// El nombre no alcanza: un dominio público puede resolver a una IP de la red local
async function resolvesPublic(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) return !isPrivateHost(h);
  try {
    const addrs = await dns.lookup(h, { all: true });
    return addrs.length > 0 && addrs.every(a => !isPrivateHost(a.address));
  } catch (_) { return false; }
}

// Sigue redirecciones a mano, validando cada salto (una redirección no puede llevar a la red local)
async function tryFetch(url, init) {
  let cur = url, opts = init;
  for (let hop = 0; hop < 5; hop++) {
    let u; try { u = new URL(cur); } catch (_) { return 'enlace inválido'; }
    if (!safeHttps(u.href) || !(await resolvesPublic(u.hostname))) return `enlace no seguro o inaccesible (${u.hostname})`;
    let r;
    try { r = await fetch(u, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(20000) }); }
    catch (e) { return `no se pudo abrir el enlace (${e.cause?.code || e.message})`; }
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) { cur = new URL(loc, u).href; opts = { method: 'GET' }; continue; }
    return r.status < 400 ? null : `el enlace respondió HTTP ${r.status}`;
  }
  return 'demasiadas redirecciones';
}

// { lu, luPost, smtpOptions, from } → { ok, method, error }. Prueba cada método en orden y,
// si uno falla, sigue con el siguiente: one-click → correo → enlace.
async function unsubscribe({ lu, luPost, smtpOptions, from }) {
  if (!lu) return { ok: false, error: 'este remitente no ofrece baja (sin List-Unsubscribe)' };
  const { https, mailto } = parseListUnsubscribe(lu);
  const errors = [];
  const okHttps = https && safeHttps(https);
  if (https && !okHttps) errors.push('enlace de baja no seguro (http o red local): no se abre');
  if (okHttps && /one-?click/i.test(luPost || '')) {
    const err = await tryFetch(https, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    if (!err) return { ok: true, method: 'one-click' };
    errors.push(`one-click: ${err}`);
  }
  if (mailto) {
    const m = smtp.parseMailto(mailto);
    if (!smtpOptions) errors.push('la baja es por correo y no hay SMTP configurado');
    else if (!m) errors.push('dirección de baja inválida o con varios destinatarios: no se envía');
    else {
      const r = await smtp.send(smtpOptions, { from, to: m.to, subject: m.subject, text: m.body });
      if (r.ok) return { ok: true, method: `correo a ${m.to}` };
      errors.push(`correo: ${r.error}`);
    }
  }
  if (okHttps && !/one-?click/i.test(luPost || '')) {
    const err = await tryFetch(https, { method: 'GET' });
    if (!err) return { ok: true, method: 'enlace (puede pedir confirmación)' };
    errors.push(err);
  }
  return { ok: false, error: errors.join(' · ') || 'sin enlace ni correo de baja utilizable' };
}

module.exports = { parseListUnsubscribe, isPrivateHost, safeHttps, resolvesPublic, unsubscribe };
