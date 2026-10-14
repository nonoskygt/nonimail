'use strict';
// Arma las opciones de conexión IMAP y SMTP a partir de la configuración y los secretos.
const { PRESETS } = require('./presets');

// cfg: configuración completa; secrets: { get(k) }; tokens: TokenCache (solo para gmail-oauth)
// presets se inyecta solo en pruebas (servidor IMAP local en vez de imap.gmail.com)
async function connectionOptions(cfg, secrets, tokens, { presets = PRESETS } = {}) {
  const a = cfg.account;
  if (a.type === 'none') throw new Error('No hay cuenta configurada. Abrí ⚙ Configuración → Cuenta.');
  const email = a.email;
  if (a.type === 'gmail-oauth') {
    const clientId = cfg.google.clientId, clientSecret = secrets.get('googleClientSecret'), refreshToken = secrets.get('googleRefreshToken');
    if (!clientId || !clientSecret) throw new Error('Faltan el Client ID o el Client Secret de Google.');
    if (!refreshToken) throw new Error('La cuenta de Google no está conectada. Tocá "Conectar con Google".');
    const accessToken = await tokens.get({ clientId, clientSecret, refreshToken });
    return {
      email,
      imap: { ...presets.gmail.imap, auth: { user: email, accessToken } },
      smtp: { ...presets.gmail.smtp, auth: { type: 'OAuth2', user: email, accessToken } },
    };
  }
  const pass = secrets.get('imapPassword');
  if (!pass) throw new Error(a.type === 'gmail-password' ? 'Falta la contraseña de aplicación de Google.' : 'Falta la contraseña de la cuenta.');
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
