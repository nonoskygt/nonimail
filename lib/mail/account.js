'use strict';
// Arma las opciones de conexión IMAP y SMTP a partir de la configuración y los secretos.
const { PRESETS } = require('./presets');
const { t } = require('../i18n');
const { clientFor } = require('./google-oauth');
// Errores de configuración (falta algo): el motor no los reintenta
const cfgErr = (key) => Object.assign(new Error(t(key)), { config: true });

// cfg: configuración completa; secrets: { get(k) }; tokens: TokenCache (solo para gmail-oauth)
// presets se inyecta solo en pruebas (servidor IMAP local en vez de imap.gmail.com)
async function connectionOptions(cfg, secrets, tokens, { presets = PRESETS } = {}) {
  const a = cfg.account;
  if (!a || !a.type || a.type === 'none') throw cfgErr('acct.none');
  const email = a.email;
  if (a.type === 'gmail-oauth') {
    const { clientId, clientSecret } = clientFor(cfg, secrets), refreshToken = secrets.get('googleRefreshToken');
    if (!clientId || !clientSecret) throw cfgErr('acct.googleMissingClient');
    if (!refreshToken) throw cfgErr('acct.googleNotConnected');
    const accessToken = await tokens.get({ clientId, clientSecret, refreshToken });
    return {
      email,
      imap: { ...presets.gmail.imap, auth: { user: email, accessToken } },
      smtp: { ...presets.gmail.smtp, auth: { type: 'OAuth2', user: email, accessToken } },
    };
  }
  const pass = secrets.get('imapPassword');
  if (!pass) throw cfgErr(a.type === 'gmail-password' ? 'acct.missingAppPassword' : 'acct.missingPassword');
  if (a.type === 'gmail-password') {
    return { email, imap: { ...presets.gmail.imap, auth: { user: email, pass } }, smtp: { ...presets.gmail.smtp, auth: { user: email, pass } } };
  }
  const user = a.username || email;
  return {
    email,
    imap: { host: a.imap.host, port: a.imap.port, secure: a.imap.secure, auth: { user, pass } },
    smtp: a.smtp.host ? { host: a.smtp.host, port: a.smtp.port, secure: a.smtp.secure, auth: { user, pass } } : null,
  };
}

module.exports = { connectionOptions };
