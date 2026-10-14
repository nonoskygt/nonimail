'use strict';
// Servidores conocidos. Outlook/Hotmail no está: Microsoft ya no acepta contraseña en IMAP/SMTP.
const PRESETS = {
  gmail: { label: 'Gmail', imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
  yahoo: { label: 'Yahoo', imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } },
  icloud: { label: 'iCloud', imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
  zoho: { label: 'Zoho', imap: { host: 'imap.zoho.com', port: 993, secure: true }, smtp: { host: 'smtp.zoho.com', port: 465, secure: true } },
  custom: { label: 'Otro (manual)' },
};

module.exports = { PRESETS };
