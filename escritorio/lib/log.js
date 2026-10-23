'use strict';
// Registro de la app en <datos>/logs/nonimail-tools.log, rotado por tamaño (.1 … .N).
// Las contraseñas y tokens se tachan también aquí; las direcciones de correo se dejan (es un archivo local).
const fs = require('fs');
const path = require('path');
const { scrub } = require('./scrub');

class Logger {
  constructor({ dir, file = 'nonimail-tools.log', maxBytes = 1048576, files = 5, echo = false }) {
    this.dir = dir; this.path = path.join(dir, file); this.maxBytes = maxBytes; this.files = files; this.echo = echo;
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }

  _rotate() {
    let size = 0;
    try { size = fs.statSync(this.path).size; } catch (_) { return; }
    if (size < this.maxBytes) return;
    for (let i = this.files - 1; i >= 1; i--) {
      const from = `${this.path}.${i}`, to = `${this.path}.${i + 1}`;
      try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (_) {}
    }
    try { fs.renameSync(this.path, `${this.path}.1`); } catch (_) {}
    try { fs.unlinkSync(`${this.path}.${this.files + 1}`); } catch (_) {}
  }

  write(level, msg, extra) {
    let line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
    if (extra !== undefined) {
      const x = extra instanceof Error ? (extra.stack || extra.message) : (typeof extra === 'string' ? extra : JSON.stringify(extra));
      line += ` ${x}`;
    }
    line = scrub(line, { emails: false, home: '' });
    try { this._rotate(); fs.appendFileSync(this.path, line + '\n'); } catch (_) {}
    if (this.echo) (level === 'error' ? console.error : console.log)(line);
  }
  info(msg, extra) { this.write('info', msg, extra); }
  warn(msg, extra) { this.write('warn', msg, extra); }
  error(msg, extra) { this.write('error', msg, extra); }
}

// Registros por corrida (logs/runs/<tipo>-<fecha>.log): asuntos y remitentes reales, solo en esta PC.
// Se conservan los últimos `keep`.
function pruneRuns(dir, keep) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.log')).map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) fs.unlinkSync(path.join(dir, f));
  } catch (_) {}
}

module.exports = { Logger, pruneRuns };
