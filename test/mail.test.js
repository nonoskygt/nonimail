'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ImapFlow } = require('imapflow');
const { MailClient, parseHeaders } = require('../lib/mail/imap');
const smtp = require('../lib/mail/smtp');
const oauth = require('../lib/mail/google-oauth');
const { connectionOptions } = require('../lib/mail/account');
const S = require('./helpers/servers');

async function flagsOf(port) {
  const c = new ImapFlow({ ...S.imapOpts(port), logger: false }); await c.connect();
  const lock = await c.getMailboxLock('INBOX', { readOnly: true });
  const out = {}; try { for await (const m of c.fetch('1:*', { uid: true, flags: true }, { uid: true })) out[m.uid] = [...m.flags]; } finally { lock.release(); }
  await c.logout(); return out;
}
async function count(port, box) { const c = new ImapFlow({ ...S.imapOpts(port), logger: false }); await c.connect(); const s = await c.status(box, { messages: true }); await c.logout(); return s.messages; }

test('MailClient: carpetas, rango por fecha, metadatos, cuerpo y NO marca como leído', async () => {
  const srv = await S.startImap({ inbox: [
    S.msg({ from: 'Tienda <promo@tienda.com>', subject: '50% off', day: '2026-09-05', body: 'Compra ya', unsub: '<https://t.com/u>, <mailto:baja@t.com>', unsubPost: 'List-Unsubscribe=One-Click' }),
    S.msg({ from: 'Ana <ana@c.com>', subject: 'Re: cotización', day: '2026-08-20', inReplyTo: '<s1@yo>', references: '<s1@yo>' }),
    S.msg({ from: 'News <news@n.com>', subject: 'Boletín', day: '2025-01-01', html: true, body: '<h1>Hola</h1><p>Lee &amp; compra</p>' }),
  ] });
  const mc = await new MailClient(S.imapOpts(srv.port)).connect();
  try {
    const info = await mc.info();
    assert.equal(info.inbox, 'INBOX'); assert.equal(info.trash, 'Papelera'); assert.equal(info.sent, 'Enviados');
    assert.equal(info.canMove, true); assert.equal(info.inboxCount, 3);
    assert.deepEqual(await mc.searchRange('2026-08-01', '2026-10-01'), [2, 1]);
    assert.deepEqual(await mc.searchRange('2026-09-05', '2026-09-06'), [1], 'SINCE inclusivo, BEFORE exclusivo');
    const metas = await mc.fetchMeta([1, 2, 3]);
    const promo = metas.find(m => m.uid === 1);
    assert.equal(promo.email, 'promo@tienda.com'); assert.equal(promo.name, 'Tienda');
    assert.match(promo.listUnsubscribe, /mailto:baja@t\.com/); assert.match(promo.listUnsubscribePost, /One-Click/);
    assert.equal(metas.find(m => m.uid === 2).inReplyTo, '<s1@yo>');
    assert.equal(await mc.bodyText(promo, 100), 'Compra ya');
    assert.equal(await mc.bodyText(metas.find(m => m.uid === 3), 100), 'Hola Lee & compra');
    assert.equal((await mc.oldestDate()).toISOString().slice(0, 10), '2025-01-01', 'encuentra el más viejo aunque no sea el primero');
    const latest = await mc.latestFrom('promo@tienda.com'); assert.equal(latest.uid, 1);
  } finally { await mc.close(); }
  const flags = await flagsOf(srv.port);
  for (const uid of [1, 2, 3]) assert.equal(flags[uid].includes('\\Seen'), false, `uid ${uid} quedó como leído`);
  await srv.close();
});

test('moveToTrash mueve a la Papelera; sin Papelera o sin MOVE/UIDPLUS se niega', async () => {
  const inbox = [S.msg({ from: 'a@a.com', subject: 'x' }), S.msg({ from: 'b@b.com', subject: 'y' })];
  const ok = await S.startImap({ inbox });
  const mc = await new MailClient(S.imapOpts(ok.port)).connect();
  assert.equal(await mc.moveToTrash([1]), 1);
  await mc.close();
  assert.equal(await count(ok.port, 'Papelera'), 1); assert.equal(await count(ok.port, 'INBOX'), 1);
  await ok.close();

  const noTrash = await S.startImap({ inbox, trash: false });
  const m2 = await new MailClient(S.imapOpts(noTrash.port)).connect();
  await assert.rejects(m2.moveToTrash([1]), /Papelera/);
  await m2.close(); await noTrash.close();

  const noMove = await S.startImap({ inbox, plugins: ['SPECIAL-USE'] });
  const m3 = await new MailClient(S.imapOpts(noMove.port)).connect();
  await assert.rejects(m3.moveToTrash([1]), /MOVE ni UIDPLUS/);
  await m3.close();
  assert.equal(await count(noMove.port, 'INBOX'), 2, 'no se tocó nada');
  await noMove.close();
});

test('repliedMessageIds encuentra mis respuestas en Enviados', async () => {
  const srv = await S.startImap({
    inbox: [S.msg({ from: 'prov@p.com', subject: 'Cotización servidores', id: '<cot1@p>' }), S.msg({ from: 'x@x.com', subject: 'otro', id: '<otro@x>' })],
    sent: [S.msg({ from: 'yo@test.local', subject: 'Re: Cotización servidores', inReplyTo: '<cot1@p>', references: '<cot1@p>' })],
  });
  const mc = await new MailClient(S.imapOpts(srv.port)).connect();
  try { assert.deepEqual([...await mc.repliedMessageIds(['<cot1@p>', '<otro@x>'])], ['<cot1@p>']); }
  finally { await mc.close(); await srv.close(); }
});

test('parseHeaders desdobla cabeceras multilínea', () => {
  assert.deepEqual(parseHeaders('List-Unsubscribe: <https://a>,\r\n <mailto:b@c>\r\nReferences: <1@a>\r\n\r\n'), { 'list-unsubscribe': '<https://a>, <mailto:b@c>', references: '<1@a>' });
});

test('Google OAuth: URL con PKCE, intercambio, refresco y login IMAP por XOAUTH2', async () => {
  const { verifier, challenge } = oauth.createPkce();
  const url = new URL(oauth.buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:8765/oauth/google/callback', state: 'st', challenge }));
  for (const [k, v] of [['client_id', 'cid'], ['code_challenge_method', 'S256'], ['access_type', 'offline'], ['prompt', 'consent'], ['state', 'st']]) assert.equal(url.searchParams.get(k), v);
  assert.match(url.searchParams.get('scope'), /https:\/\/mail\.google\.com\//);

  const g = await S.startFakeGoogle();
  const t = await oauth.exchangeCode({ clientId: 'cid', clientSecret: 'sec', code: 'c', verifier, redirectUri: 'r', tokenUrl: g.tokenUrl });
  assert.equal(t.refreshToken, 'refresh-1'); assert.equal(t.email, 'testuser@gmail.com');
  assert.equal(g.calls[0].params.code_verifier, verifier);

  const tokens = new oauth.TokenCache({ tokenUrl: g.tokenUrl });
  const imap = await S.startImap({ inbox: [S.msg({ from: 'a@a.com', subject: 'hola' })] });
  const cfg = { account: { type: 'gmail-oauth', email: 'testuser' }, google: { clientId: 'cid' } };
  const secrets = { get: (k) => ({ googleClientSecret: 'sec', googleRefreshToken: 'refresh-1' })[k] || '' };
  const presets = { gmail: { imap: { host: '127.0.0.1', port: imap.port, secure: false }, smtp: { host: '127.0.0.1', port: 1, secure: false } } };
  const conn = await connectionOptions(cfg, secrets, tokens, { presets });
  assert.deepEqual(conn.imap.auth, { user: 'testuser', accessToken: 'testtoken' });
  const mc = await new MailClient(conn.imap).connect();
  assert.equal((await mc.info()).inboxCount, 1);
  await mc.close(); await imap.close();
  assert.equal(g.calls.filter(c => c.params.grant_type === 'refresh_token').length, 1);
  await tokens.get({ clientId: 'cid', clientSecret: 'sec', refreshToken: 'refresh-1' });
  assert.equal(g.calls.filter(c => c.params.grant_type === 'refresh_token').length, 1, 'usa el token en caché');
  await g.close();
});

test('Google OAuth: sin permiso de Gmail se rechaza', async () => {
  const g = await S.startFakeGoogle({ scope: 'openid email' });
  await assert.rejects(oauth.exchangeCode({ clientId: 'c', clientSecret: 's', code: 'x', verifier: 'v', redirectUri: 'r', tokenUrl: g.tokenUrl }), /permiso de Gmail/);
  await g.close();
});

test('connectionOptions explica qué falta', async () => {
  const sec = (o) => ({ get: (k) => o[k] || '' });
  await assert.rejects(connectionOptions({ account: { type: 'none' } }, sec({})), /No hay cuenta/);
  await assert.rejects(connectionOptions({ account: { type: 'gmail-password', email: 'a@gmail.com' } }, sec({})), /contraseña de aplicación/);
  await assert.rejects(connectionOptions({ account: { type: 'gmail-oauth', email: 'a@gmail.com' }, google: { clientId: '' } }, sec({})), /Client ID/);
  const c = await connectionOptions({ account: { type: 'imap', email: 'a@x.com', username: '', imap: { host: 'mail.x.com', port: 993, secure: true }, smtp: { host: '', port: 465, secure: true } } }, sec({ imapPassword: 'p' }));
  assert.deepEqual(c.imap, { host: 'mail.x.com', port: 993, secure: true, auth: { user: 'a@x.com', pass: 'p' } });
  assert.equal(c.smtp, null);
});

test('mailto malicioso: no puede usar tu cuenta para mandar phishing', () => {
  // varios destinatarios (coma, coma codificada, punto y coma) → se rechaza
  for (const u of ['mailto:ceo@victima.com,finanzas@victima.com', 'mailto:a@x.com%2Cb@y.com', 'mailto:a@x.com;b@y.com', 'mailto:Juan <a@x.com>', 'mailto:a@x.com%20b@y.com'])
    assert.equal(smtp.parseMailto(u), null, u);
  // asunto y cuerpo del atacante se ignoran
  const m = smtp.parseMailto('mailto:baja@lista.com?subject=Factura%20vencida%20-%20urgente&body=Pag%C3%A1%20en%20https%3A%2F%2Fevil.example');
  assert.equal(m.to, 'baja@lista.com');
  assert.equal(m.subject, 'unsubscribe');
  assert.doesNotMatch(m.body, /evil|Pag/);
  assert.equal(smtp.parseMailto('mailto:baja@lista.com?subject=unsubscribe%20https%3A%2F%2Fevil.example').subject, 'unsubscribe');
  assert.equal(smtp.parseMailto('mailto:u-123@lista.com?subject=unsubscribe%20%23A9F2').subject, 'unsubscribe #A9F2', 'tokens de baja legítimos se respetan');
});

test('SMTP: verify, envío de baja y parseo de mailto', async () => {
  const s = await S.startSmtp();
  const o = { host: '127.0.0.1', port: s.port, secure: false, requireTLS: false, auth: { user: 'smtpuser', pass: 'smtppass' } };
  assert.deepEqual(await smtp.verify(o), { ok: true });
  assert.equal((await smtp.verify({ ...o, auth: { user: 'smtpuser', pass: 'mal' } })).ok, false);
  const m = smtp.parseMailto('mailto:baja%40t.com?subject=unsubscribe%20me&body=x');
  assert.equal(m.to, 'baja@t.com'); assert.equal(m.subject, 'unsubscribe me');
  assert.doesNotMatch(m.body, /^x$/, 'el cuerpo es siempre fijo');
  const r = await smtp.send(o, { from: 'yo@test.local', to: m.to, subject: m.subject, text: m.body });
  assert.equal(r.ok, true);
  assert.deepEqual(s.messages[0].to, ['baja@t.com']);
  assert.match(s.messages[0].data, /Subject: unsubscribe me/);
  await s.close();
});
