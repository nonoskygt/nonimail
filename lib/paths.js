'use strict';
// Carpeta de datos: config.json, secrets.json, senders.json, progress.json y logs/.
// NONIMAIL_DATA_DIR permite separarla del código (pruebas, instalaciones compartidas).
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.NONIMAIL_DATA_DIR ? path.resolve(process.env.NONIMAIL_DATA_DIR) : ROOT;

module.exports = {
  ROOT,
  DATA_DIR,
  file: (name) => path.join(DATA_DIR, name),
};
