#!/usr/bin/env node
'use strict';
// NoniMail Tools sin ventana (servidores Linux, pruebas): `npm start` y abrir la dirección que imprime.
// La app de escritorio usa el mismo servidor desde electron/main.js.
const { createApp } = require('./lib/app');
const { t } = require('./lib/i18n');

let app = null;
process.on('uncaughtException', (e) => { if (app) app.reportError(e, 'app'); else console.error(e); });
process.on('unhandledRejection', (e) => { if (app) app.reportError(e instanceof Error ? e : new Error(String(e)), 'app'); else console.error(e); });

createApp({ echoLog: false }).then((a) => {
  app = a;
  console.log(`NoniMail Tools ${t('cli.listening')} ${a.url}`);
  console.log(`${t('cli.data')}: ${a.dataDir}`);
  const stop = () => { a.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}).catch((e) => {
  console.error(`NoniMail Tools: ${e.message}`);
  process.exit(1);
});
