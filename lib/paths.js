'use strict';
// Carpeta de datos (config.json, secrets.json, senders.json, progress.json, licencias, telemetría y logs/).
// - App de escritorio: la de Electron (app.getPath('userData')), que llega como opción.
// - Modo sin ventana (npm start): %APPDATA%\NoniMail Tools en Windows, $XDG_CONFIG_HOME/nonimail-tools
//   (o ~/.config/nonimail-tools) en Linux y ~/Library/Application Support/NoniMail Tools en macOS.
// NMT_DATA_DIR (o el nombre viejo NONIMAIL_DATA_DIR) la cambia: pruebas, instalaciones portátiles.
const os = require('os');
const path = require('path');
const { ROOT } = require('./defaults');

const PRODUCT = 'NoniMail Tools';
const SLUG = 'nonimail-tools';

function defaultDataDir(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), PRODUCT);
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', PRODUCT);
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), SLUG);
}

function resolveDataDir(explicit, env = process.env) {
  return path.resolve(explicit || env.NMT_DATA_DIR || env.NONIMAIL_DATA_DIR || defaultDataDir(process.platform, env));
}

module.exports = { ROOT, PRODUCT, SLUG, defaultDataDir, resolveDataDir };
