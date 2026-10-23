'use strict';
// Filtro colectivo (contrato v1, ver FILTRO.md del servicio):
//  - qué remitentes se reportan y cómo se arma cada decisión (funciones puras);
//  - la reputación firmada que se descarga una vez al día y que el motor consulta SIEMPRE.
// Nunca sale un asunto, un contenido, una dirección ni la cuenta del usuario: solo el dominio registrable.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonfile');
const { esPersonal } = require('./licenses/domains');

const PREFIJO_FIRMA = 'NMTF1.';
const NOREPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|noresponder|no[-_.]?responder|newsletter|news|marketing|promo(s|ciones|tions)?|ofertas|offers|deals|mailer|mailing|notificacion(es)?|notifications?|boletin|info|hello|hola|ventas|campaign|updates?)$/i;
// segundo nivel típico bajo un TLD de país: tienda.com.gt, bbc.co.uk, empresa.gob.mx
const SEGUNDO_NIVEL = new Set(['com', 'net', 'org', 'edu', 'gov', 'gob', 'mil', 'co', 'ac', 'or', 'ne', 'go']);

// JSON canónico: claves ordenadas de forma recursiva, sin espacios y sin escapar lo que no es ASCII
// (igual que json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False) de Python).
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function verificar(doc, pub) {
  if (!doc || typeof doc !== 'object' || typeof doc.firma !== 'string' || !pub) return false;
  const { v, generado, dominios } = doc;
  const firma = Buffer.from(doc.firma, 'base64url');
  try {
    return crypto.verify(null, Buffer.from(PREFIJO_FIRMA + canonico({ v, generado, dominios }), 'utf8'), pub, firma);
  } catch (_) { return false; }
}

// Dominio registrable (sin lista pública de sufijos: dos etiquetas, o tres bajo un TLD de país con segundo nivel típico)
function dominioRegistrable(email) {
  const m = String(email || '').trim().toLowerCase().match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/);
  if (!m) return '';
  const p = m[1].replace(/\.+$/, '').split('.');
  if (p.length <= 2) return p.join('.');
  const n = p.length;
  return (p[n - 1].length === 2 && SEGUNDO_NIVEL.has(p[n - 2]) ? p.slice(-3) : p.slice(-2)).join('.');
}

const esNoreply = (email) => NOREPLY.test(String(email || '').split('@')[0]);

// ¿Se reporta este remitente? Masivo (baja o patrón noreply/marketing) y de dominio propio (no Gmail, Hotmail…)
function califica(g) {
  if (!g || !g.email) return false;
  const dominio = dominioRegistrable(g.email);
  if (!dominio || esPersonal(`x@${dominio}`)) return false;
  return !!g.lu || esNoreply(g.email);
}

// ¿Contradice el usuario al motor? Motor ≥70 y el usuario conserva, o motor ≤30 y el usuario elimina.
function corrigio(decision, puntaje) {
  if (!Number.isFinite(puntaje)) return false;
  if (decision === 'eliminar' || decision === 'baja') return puntaje <= 30;
  return puntaje >= 70; // conservar | nunca
}

const PRIORIDAD = ['baja', 'eliminar', 'nunca', 'conservar'];

// Una decisión por dominio (si varios remitentes del mismo dominio, gana la más fuerte). Máx. n filas.
// remitentes: [{ g: grupo del escaneo, decision }]
function armarDecisiones(remitentes, max = 500) {
  const por = new Map();
  for (const { g, decision } of remitentes) {
    if (!califica(g)) continue;
    const dominio = dominioRegistrable(g.email);
    const llm = typeof g.reason === 'string' && g.reason.startsWith('llm') && Number.isFinite(g.score) ? g.score : null;
    const fila = {
      dominio,
      senales: { baja: !!g.lu, noreply: esNoreply(g.email), reglas: [...(g.reglas || [])], llm, correos: g.count || 0 },
      decision, corrigio: corrigio(decision, g.score),
    };
    const prev = por.get(dominio);
    if (!prev) { por.set(dominio, fila); continue; }
    const s = prev.senales;
    s.baja = s.baja || fila.senales.baja; s.noreply = s.noreply || fila.senales.noreply;
    s.reglas = [...new Set([...s.reglas, ...fila.senales.reglas])];
    if (fila.senales.llm != null && (s.llm == null || fila.senales.llm > s.llm)) s.llm = fila.senales.llm;
    s.correos += fila.senales.correos;
    if (PRIORIDAD.indexOf(fila.decision) < PRIORIDAD.indexOf(prev.decision)) { prev.decision = fila.decision; prev.corrigio = fila.corrigio; }
  }
  return [...por.values()].slice(0, max).map(f => { if (f.senales.llm == null) delete f.senales.llm; return f; });
}

// Reputación descargada: se verifica al bajarla y al leer la caché; si la firma no vale, se ignora y se registra.
class Reputacion {
  // o: { dir, getConfig(), publicKey(), fetch?, log? }
  constructor(o) {
    this.o = o;
    this.fetch = o.fetch || ((...a) => fetch(...a));
    this.file = path.join(o.dir, 'reputacion.json');
    this.doc = null; this.fetchedAt = 0; this.timer = null; this.busy = null;
    const c = readJson(this.file, null);
    if (c && c.doc && this._valida(c.doc)) { this.doc = c.doc; this.fetchedAt = Number(c.fetchedAt) || 0; }
  }

  get cfg() { return this.o.getConfig().filtro; }
  _valida(doc) { return verificar(doc, this.o.publicKey()) && doc.dominios && typeof doc.dominios === 'object'; }
  _log(m) { if (this.o.log) this.o.log.warn(`filtro: ${m}`); }

  // { eliminar_pct, n } del dominio, o null. Solo cuenta con n suficiente.
  buscar(email) {
    if (!this.doc) return null;
    const r = this.doc.dominios[dominioRegistrable(email)];
    return r && Number.isInteger(r.eliminar_pct) && Number.isFinite(r.n) && r.n >= this.cfg.minN ? r : null;
  }

  vencida() { return !this.doc || Date.now() - this.fetchedAt >= this.cfg.intervalMs; }

  async actualizar() {
    if (this.busy) return this.busy;
    this.busy = (async () => {
      try {
        const c = this.o.getConfig();
        const r = await this.fetch(new URL(this.cfg.reputacionPath, c.service.url), { signal: AbortSignal.timeout(this.cfg.timeoutMs), headers: { Accept: 'application/json' } });
        if (!r.ok) { this._log(`reputación: respuesta ${r.status}`); return false; }
        const doc = await r.json();
        if (!this._valida(doc)) { this._log('reputación ignorada: firma no válida'); return false; }
        this.doc = doc; this.fetchedAt = Date.now();
        try { writeJsonAtomic(this.file, { fetchedAt: this.fetchedAt, doc }); } catch (_) {}
        return true;
      } catch (e) { this._log(`reputación: no se pudo descargar (${e.cause?.code || e.name || e.message})`); return false; }
      finally { this.busy = null; }
    })();
    return this.busy;
  }

  // Al arrancar: baja si la copia tiene más de 24 h; después, una vez al día
  start() {
    if (this.timer) return;
    const c = this.o.getConfig();
    const on = c.filtro.reputacion && c.setup && c.setup.done && /^https?:\/\//i.test(String(c.service.url || ''));
    if (!on) return;
    if (this.vencida()) this.actualizar().catch(() => {});
    this.timer = setInterval(() => { this.actualizar().catch(() => {}); }, this.cfg.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}

module.exports = { canonico, verificar, dominioRegistrable, esNoreply, califica, corrigio, armarDecisiones, Reputacion, PREFIJO_FIRMA };
