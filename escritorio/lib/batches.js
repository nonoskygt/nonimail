'use strict';
// Lotes por fecha: el rango "últimos N días" se parte en ventanas [since, before) de días UTC,
// de la más nueva a la más vieja. IMAP SINCE es inclusivo y BEFORE exclusivo, así que no hay huecos ni solapes.
const { readJson, writeJsonAtomic } = require('./jsonfile');

const DAY = 86400000;
function toDay(d) { return new Date(d).toISOString().slice(0, 10); }
function addDays(day, n) { return toDay(Date.parse(day + 'T00:00:00Z') + n * DAY); }
function dayToDate(day) { return new Date(day + 'T00:00:00Z'); }
function diffDays(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY); }

// daysBack = 0 significa "todo": desde el correo más viejo (oldest) o 1990-01-01
function makeWindows({ daysBack, windowDays, today = toDay(Date.now()), oldest = null }) {
  const end = addDays(today, 1);
  let start = daysBack > 0 ? addDays(end, -daysBack) : (oldest ? toDay(oldest) : '1990-01-01');
  if (start >= end) start = addDays(end, -1);
  const out = [];
  for (let before = end; before > start;) {
    const since = diffDays(start, before) > windowDays ? addDays(before, -windowDays) : start;
    out.push({ since, before, label: `${since} → ${addDays(before, -1)}` });
    before = since;
  }
  return out;
}

function jobKey({ kind, account, folder, daysBack, windowDays, dryRun }) {
  return [kind, account, folder, daysBack, windowDays, dryRun ? 'dry' : 'real'].join('|');
}

// Trabajos sin terminar, para "Continuar". Un trabajo terminado se borra.
class ProgressStore {
  constructor(file) { this.file = file; this.data = readJson(file, { jobs: {} }); if (!this.data.jobs) this.data.jobs = {}; }
  get(key) { return this.data.jobs[key] || null; }
  list() { return Object.values(this.data.jobs); }
  put(job) { job.updatedAt = new Date().toISOString(); this.data.jobs[job.key] = job; this._save(); }
  remove(key) { if (this.data.jobs[key]) { delete this.data.jobs[key]; this._save(); } }
  _save() { writeJsonAtomic(this.file, this.data); }
}

module.exports = { makeWindows, jobKey, ProgressStore, toDay, addDays, dayToDate, diffDays };
