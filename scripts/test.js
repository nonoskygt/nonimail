'use strict';
// Corre todas las pruebas de test/*.test.js (Windows, Linux y Node 18+; sin depender de comodines del shell).
// El idioma de las pruebas es español para que los textos comparados no cambien con el sistema.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join('test', f));
const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: path.join(__dirname, '..'), stdio: 'inherit',
  env: { ...process.env, NMT_LANGUAGE: 'es', NMT_DATA_DIR: '', NMT_TELEMETRY: '0', NMT_FILTRO: '0', NMT_FILTRO_REPUTACION: '0' },
});
process.exit(r.status === null ? 1 : r.status);
