'use strict';
// Cuenta personal (dominio público: Gmail, Hotmail…) o comercial (dominio propio).
// NoniMail Tools es gratis para cuentas personales. Una cuenta de dominio propio es uso
// comercial: se puede simular siempre, pero ejecutar de verdad pide una licencia.
// Es la MISMA lista del servicio web (dominios.py de mt.nonosky.com): si cambia allá, cambia aquí.

const DOMINIOS_PUBLICOS = new Set([
  '126.com', '163.com', 'abv.bg', 'aim.com', 'alice.it', 'aliyun.com', 'aol.com', 'att.net', 'bellsouth.net',
  'bk.ru', 'bol.com.br', 'btinternet.com', 'cantv.net', 'centrum.cz', 'charter.net', 'comcast.net',
  'consultant.com', 'cox.net', 'daum.net', 'earthlink.net', 'email.com', 'fastmail.com', 'fastmail.fm',
  'fibertel.com.ar', 'free.fr', 'freenet.de', 'frontier.com', 'gmail.com', 'gmx.com', 'googlemail.com',
  'hanmail.net', 'hey.com', 'icloud.com', 'ig.com.br', 'inbox.com', 'inbox.ru', 'intelnett.com',
  'interia.pl', 'juno.com', 'keemail.me', 'laposte.net', 'libero.it', 'list.ru', 'mac.com', 'mail.com',
  'mail.ru', 'mailbox.org', 'me.com', 'movistar.es', 'msn.com', 'myself.com', 'naver.com', 'ntlworld.com',
  'o2.pl', 'onet.pl', 'ono.com', 'optonline.net', 'orange.fr', 'passport.com', 'pm.me', 'post.com',
  'posteo.de', 'prodigy.net.mx', 'proton.me', 'protonmail.ch', 'protonmail.com', 'qq.com', 'rambler.ru',
  'rediffmail.com', 'rocketmail.com', 'sbcglobal.net', 'seznam.cz', 'sfr.fr', 'sina.com', 'sky.com',
  'sohu.com', 'speedy.com.ar', 't-online.de', 'talktalk.net', 'telefonica.net', 'terra.com', 'terra.com.br',
  'terra.es', 'tim.it', 'tiscali.it', 'turbonett.com', 'tuta.com', 'tuta.io', 'tutamail.com', 'tutanota.com',
  'tutanota.de', 'uol.com.br', 'usa.com', 'verizon.net', 'virgilio.it', 'virginmedia.com', 'wanadoo.fr',
  'web.de', 'wp.pl', 'ya.ru', 'yandex.com', 'yeah.net', 'ymail.com', 'zohomail.com',
]);

// Familias con dominios de país: hotmail.es, outlook.com.mx, yahoo.com.ar, live.cl, gmx.de…
const FAMILIAS = /^(hotmail|outlook|live|windowslive|yahoo|ymail|gmx|yandex|aol)\.(com|net|org|[a-z]{2}|(com|co|net|org)\.[a-z]{2})$/;
const EMAIL = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/;

function dominioDe(email) {
  const m = String(email || '').trim().toLowerCase().match(EMAIL);
  return m ? m[1].replace(/\.+$/, '') : '';
}

function esCorreo(email) { return !!dominioDe(email); }

function esPersonal(email) {
  const d = dominioDe(email);
  return !!d && (DOMINIOS_PUBLICOS.has(d) || FAMILIAS.test(d));
}

module.exports = { DOMINIOS_PUBLICOS, FAMILIAS, dominioDe, esCorreo, esPersonal };
