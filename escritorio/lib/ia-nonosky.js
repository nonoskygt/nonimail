'use strict';
// IA de Nonosky (suscripción): clasifica remitentes en el servidor en vez de en este equipo.
//   POST /api/ia/v1/clasificar {items: [{id, from, subjects: [texto], bulk}]} → {modelo, resultados: [{id, categoria}]}
// Hasta iaNonosky.maxItems ítems por pedido y maxSubjects asuntos de maxChars caracteres. Nunca se manda el cuerpo.
// Ante 402 (sin suscripción), 429 (tope diario), 503 (IA no disponible), sesión vencida o red caída devuelve el
// motivo y quien llama sigue con reglas (heurística) sin cortar la limpieza.
const { t } = require('./i18n');

const CATEGORIAS = ['PERSONAL', 'TRANSACCION', 'SEGURIDAD', 'PROMOCION', 'BOLETIN', 'SOCIAL', 'OTRO'];

// Motivo legible de una respuesta fallida (o de un error de red: status 0)
function motivo(status) {
  if (status === 402) return t('ia.nonosky.402');
  if (status === 429) return t('ia.nonosky.429');
  if (status === 401 || status === 403) return t('ia.nonosky.session');
  if (!status || status === 502) return t('ia.nonosky.network');
  return t('ia.nonosky.503');
}

// Recorta un ítem a lo que acepta el servidor
function recortar(it, o) {
  return {
    id: String(it.id),
    from: String(it.from || '').slice(0, o.maxChars),
    subjects: (it.subjects || []).slice(0, o.maxSubjects).map(s => String(s || '').slice(0, o.maxChars)),
    bulk: !!it.bulk,
  };
}

// items: [{id, from, subjects, bulk}]; call(method, path, body, opts) → {status, ok, body} (ServiceAuth.call)
// → { ok: true, categorias: Map(id → CATEGORIA|null), modelo } | { ok: false, status, motivo, categorias (lo que alcanzó) }
async function clasificar(items, { call, cfg }) {
  const o = cfg.iaNonosky;
  const categorias = new Map();
  let modelo = '';
  for (let i = 0; i < items.length; i += o.maxItems) {
    const lote = items.slice(i, i + o.maxItems).map(it => recortar(it, o));
    let r;
    try { r = await call('POST', o.path, { items: lote }, { timeoutMs: o.timeoutMs }); }
    catch (e) { const status = Number.isInteger(e.code) && e.code !== 502 ? e.code : 0; return { ok: false, status, motivo: motivo(status), categorias }; }
    if (!r.ok || !r.body || !Array.isArray(r.body.resultados)) return { ok: false, status: r.status, motivo: motivo(r.ok ? 503 : r.status), categorias };
    modelo = r.body.modelo || modelo;
    for (const x of r.body.resultados) {
      if (!x || x.id == null) continue;
      const c = String(x.categoria || '').toUpperCase();
      categorias.set(String(x.id), CATEGORIAS.includes(c) ? c : null);
    }
  }
  return { ok: true, categorias, modelo };
}

module.exports = { clasificar, recortar, motivo, CATEGORIAS };
