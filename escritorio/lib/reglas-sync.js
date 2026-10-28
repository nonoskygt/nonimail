'use strict';
// Reglas por remitente (Nunca eliminar / Siempre eliminar) sincronizadas con el perfil en línea
// (mt.nonosky.com) cuando hay sesión. Cada regla lleva su fecha; al fusionar gana la más reciente y
// quitar una regla también se sincroniza (fecha con regla 'none'). Sin sesión o sin servicio todo
// sigue funcionando en local: la sincronización solo se reintenta en el siguiente cambio o sesión.
const PATH = '/api/reglas-remitentes';
const VALIDAS = new Set(['delete', 'protect', 'none']);

// Fusión pura. local y remoto: { [email]: { regla, ts } }. Devuelve el resultado y qué cambió en cada lado.
function fusionar(local, remoto) {
  const out = {}, cambiaLocal = [], cambiaRemoto = [];
  for (const email of new Set([...Object.keys(local || {}), ...Object.keys(remoto || {})])) {
    const l = local && local[email], r = remoto && remoto[email];
    const lv = l && VALIDAS.has(l.regla) ? l : null, rv = r && VALIDAS.has(r.regla) ? r : null;
    const ganadora = !rv ? lv : !lv ? rv : (rv.ts > lv.ts ? rv : lv);
    if (!ganadora) continue;
    out[email] = { regla: ganadora.regla, ts: ganadora.ts };
    if (!lv || lv.regla !== ganadora.regla || lv.ts !== ganadora.ts) cambiaLocal.push(email);
    if (!rv || rv.regla !== ganadora.regla || rv.ts !== ganadora.ts) cambiaRemoto.push(email);
  }
  return { out, cambiaLocal, cambiaRemoto };
}

class ReglasSync {
  // o: { auth, senders (objeto con rules y rulesAt), save(), log?, onChange?(), delayMs? }
  constructor(o) { this.o = o; this.timer = null; this.running = false; this.pending = false; this.state = { ok: null, at: 0, error: '' }; }

  // Registro local de una regla ('none' = quitada). Lo llama la ruta de la API.
  set(email, regla) { this.lote({ [email]: regla }); }

  // Varias reglas a la vez (una guardada y una sincronización). Las claves '@dominio' valen para todo el dominio.
  lote(cambios) {
    const S = this.o.senders;
    if (!S.rulesAt) S.rulesAt = {};
    const ts = Date.now();
    for (const [email, regla] of Object.entries(cambios)) {
      if (regla === 'none' || regla == null) delete S.rules[email]; else S.rules[email] = regla;
      S.rulesAt[email] = ts;
    }
    this.o.save();
    this.soon();
  }

  _local() {
    const S = this.o.senders, out = {};
    for (const email of new Set([...Object.keys(S.rules), ...Object.keys(S.rulesAt || {})])) {
      out[email] = { regla: S.rules[email] || 'none', ts: (S.rulesAt && S.rulesAt[email]) || 0 };
    }
    return out;
  }

  soon(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.sync().catch(() => {}); }, ms != null ? ms : (this.o.delayMs != null ? this.o.delayMs : 2000));
    if (this.timer.unref) this.timer.unref();
  }

  stop() { clearTimeout(this.timer); }

  async sync() {
    const a = this.o.auth;
    if (!a.token) return { skipped: 'sin-sesion' };
    if (this.running) { this.pending = true; return { skipped: 'en-curso' }; }
    this.running = true;
    try {
      const got = await a.reglasRemitentes('GET');
      // 404 {codigo: 'requiere_compra'}: la cuenta nunca compró; las reglas se quedan en este equipo
      const b = got.body || {};
      if (got.status === 404 && (b.codigo === 'requiere_compra' || (b.detail && b.detail.codigo === 'requiere_compra'))) { this.state = { ok: false, at: Date.now(), error: 'requiere-compra' }; return { skipped: 'requiere-compra' }; }
      if (got.status === 404 || got.status === 501) { this.state = { ok: false, at: Date.now(), error: 'sin-servicio' }; return { skipped: 'sin-servicio' }; }
      if (got.status === 401 || got.status === 403) { this.state = { ok: false, at: Date.now(), error: 'sesion' }; return { skipped: 'sesion' }; }
      if (!got.ok) throw new Error(`servicio ${got.status}`);
      const remoto = {};
      const src = got.body && got.body.reglas && typeof got.body.reglas === 'object' ? got.body.reglas : {};
      for (const [email, v] of Object.entries(src)) if (v && VALIDAS.has(v.regla)) remoto[String(email).toLowerCase()] = { regla: v.regla, ts: Number(v.ts) || 0 };
      const { out, cambiaLocal, cambiaRemoto } = fusionar(this._local(), remoto);
      if (cambiaLocal.length) {
        const S = this.o.senders;
        if (!S.rulesAt) S.rulesAt = {};
        for (const email of cambiaLocal) {
          if (out[email].regla === 'none') delete S.rules[email]; else S.rules[email] = out[email].regla;
          S.rulesAt[email] = out[email].ts;
        }
        this.o.save();
        if (this.o.onChange) this.o.onChange(cambiaLocal);
      }
      if (cambiaRemoto.length) {
        const put = await a.reglasRemitentes('PUT', { reglas: out });
        if (!put.ok) throw new Error(`servicio ${put.status}`);
      }
      this.state = { ok: true, at: Date.now(), error: '' };
      if (this.o.log) this.o.log.info(`reglas: sincronizadas (${cambiaLocal.length} traídas, ${cambiaRemoto.length} enviadas)`);
      return { traidas: cambiaLocal.length, enviadas: cambiaRemoto.length };
    } catch (e) {
      this.state = { ok: false, at: Date.now(), error: e.message };
      if (this.o.log) this.o.log.warn ? this.o.log.warn(`reglas: no se sincronizó (${e.message})`) : this.o.log.info(`reglas: no se sincronizó (${e.message})`);
      return { error: e.message };
    } finally {
      this.running = false;
      if (this.pending) { this.pending = false; this.soon(); }
    }
  }
}

module.exports = { ReglasSync, fusionar, PATH };
