'use strict';
// Servidores locales para pruebas: IMAP en memoria (hoodiecrow), SMTP (smtp-server) y un Google OAuth falso.
const http = require('http');
const hoodiecrow = require('hoodiecrow-imap');
const { SMTPServer } = require('smtp-server');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function imapDate(day) { const [y, m, d] = day.split('-'); return `${d}-${MONTHS[+m - 1]}-${y} 12:00:00 +0000`; }

// cabeceras con acentos codificadas como en el correo real (RFC 2047)
const enc = (s) => /[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=` : s;

// msg({ from, subject, day, body, html, id, inReplyTo, references, unsub, unsubPost })
function msg(o) {
  const from = o.from.replace(/^(.*?)\s*<([^>]+)>$/, (m, n, a) => `${enc(n)} <${a}>`);
  const h = [`From: ${from}`, 'To: yo@test.local', `Subject: ${enc(o.subject)}`, `Message-ID: ${o.id || `<${Math.random().toString(36).slice(2)}@test>`}`];
  if (o.inReplyTo) h.push(`In-Reply-To: ${o.inReplyTo}`);
  if (o.references) h.push(`References: ${o.references}`);
  if (o.unsub) h.push(`List-Unsubscribe: ${o.unsub}`);
  if (o.unsubPost) h.push(`List-Unsubscribe-Post: ${o.unsubPost}`);
  h.push(`Content-Type: text/${o.html ? 'html' : 'plain'}; charset=utf-8`);
  return { raw: `${h.join('\r\n')}\r\n\r\n${o.body || o.subject}`, internaldate: imapDate(o.day || '2026-10-01') };
}

const ALL_PLUGINS = ['SPECIAL-USE', 'MOVE', 'UIDPLUS', 'ENABLE', 'SASL-IR', 'XOAUTH2', 'AUTH-PLAIN'];

function startImap({ inbox = [], sent = [], trash = true, plugins = ALL_PLUGINS } = {}) {
  const folders = {};
  if (trash) folders.Papelera = { 'special-use': '\\Trash', messages: [] };
  folders.Enviados = { 'special-use': '\\Sent', messages: sent };
  const server = hoodiecrow({ plugins, storage: { INBOX: { messages: inbox }, '': { separator: '/', folders } } });
  return new Promise(res => server.listen(0, '127.0.0.1', () => {
    const port = server.server ? server.server.address().port : server.address().port;
    const socks = new Set(), raw = server.server || server;
    if (raw.on) raw.on('connection', (c) => { socks.add(c); c.on('close', () => socks.delete(c)); });
    // se cierran también las conexiones que hayan quedado abiertas, para que la prueba termine
    res({ port, server, storage: server.storage || null, close: () => new Promise(r => { for (const c of socks) c.destroy(); server.close(r); setTimeout(r, 1500).unref(); }) });
  }));
}

const imapOpts = (port, auth = { user: 'testuser', pass: 'testpass' }) => ({ host: '127.0.0.1', port, secure: false, auth });

function startSmtp() {
  const messages = [];
  const srv = new SMTPServer({
    secure: false, disabledCommands: ['STARTTLS'], authOptional: false, logger: false,
    onAuth(auth, session, cb) { return auth.username === 'smtpuser' && auth.password === 'smtppass' ? cb(null, { user: 1 }) : cb(new Error('auth')); },
    onData(stream, session, cb) { let d = ''; stream.on('data', c => d += c); stream.on('end', () => { messages.push({ to: session.envelope.rcptTo.map(r => r.address), data: d }); cb(); }); },
  });
  return new Promise(res => srv.listen(0, '127.0.0.1', () => res({ port: srv.server.address().port, messages, close: () => new Promise(r => srv.close(r)) })));
}

// Google OAuth falso: /token (authorization_code y refresh_token) y /revoke
function startFakeGoogle({ scope = 'https://mail.google.com/ openid email', email = 'testuser@gmail.com' } = {}) {
  const calls = [];
  const idToken = `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(b)); calls.push({ url: req.url, params: p });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (p.grant_type === 'authorization_code') return res.end(JSON.stringify({ access_token: 'testtoken', expires_in: 3600, refresh_token: 'refresh-1', id_token: idToken, scope }));
      if (p.grant_type === 'refresh_token') return res.end(JSON.stringify({ access_token: 'testtoken', expires_in: 3600 }));
      res.end('{}');
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    r({ tokenUrl: `${base}/token`, revokeUrl: `${base}/revoke`, calls, close: () => new Promise(x => srv.close(x)) });
  }));
}

module.exports = { msg, imapDate, startImap, imapOpts, startSmtp, startFakeGoogle, ALL_PLUGINS };
