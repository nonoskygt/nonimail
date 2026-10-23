'use strict';
// JSON en disco: lectura tolerante y escritura atómica (tmp + rename) para no dejar archivos a medias.
const fs = require('fs');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJsonAtomic(file, obj, { mode } = {}) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode });
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); break; }
    catch (e) {
      // Windows: un antivirus o el indexador pueden tener el archivo abierto un instante
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
    }
  }
  if (mode) { try { fs.chmodSync(file, mode); } catch (_) {} }
}

module.exports = { readJson, writeJsonAtomic };
