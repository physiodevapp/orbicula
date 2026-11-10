// Sesiones guardadas en el dispositivo (IndexedDB, ver idb.js), para no perder un protocolo o un análisis
// de vídeo de varios minutos al recargar la página. Sin DOM ni red. Solo se guardan las medidas
// (los pasos de la sesión y la ficha de la captura): nunca el vídeo ni imágenes ni el nombre del archivo.
//
// Dos almacenes, como en dualkinema: `sessions` (cabecera ligera, que es lo que se lista) y `data` (los
// resultados, como TEXTO JSON: se copia de una vez y se lee solo al abrir). Los datos se escriben antes
// que la cabecera, así una cabecera nunca se queda sin datos.
//
// Caducan a los 30 días y solo se conservan las 5 últimas. `adapter` se inyecta: IndexedDB en el navegador
// y una versión en memoria en los tests.
import { isValidCode } from '../export/result.js';

export const SCHEMA = 1;
export const MAX_ITEMS = 5;
export const TTL_DAYS = 30;
const DAY = 86400000;

/** Almacén en memoria con la misma interfaz que idbAdapter (para los tests). */
export function memoryAdapter() {
  const m = { sessions: new Map(), data: new Map() };
  return {
    async get(s, k) { const v = m[s].get(k); return v === undefined ? undefined : structuredClone(v); },
    async put(s, v) { m[s].set(v.id, structuredClone(v)); },
    async delete(s, k) { m[s].delete(k); },
    async all(s) { return [...m[s].values()].map((v) => structuredClone(v)); },
  };
}

export function createStore(adapter, { now = () => Date.now(), maxItems = MAX_ITEMS, ttlDays = TTL_DAYS } = {}) {
  async function remove(id) {
    await adapter.delete('sessions', id);
    await adapter.delete('data', id);
  }

  /** Quita lo caducado y lo que pasa del máximo; devuelve las cabeceras que quedan, de la más nueva a la más vieja. */
  async function prune() {
    const t = now();
    const all = (await adapter.all('sessions')).sort((a, b) => b.savedAt - a.savedAt);
    const alive = all.filter((h) => h.expiresAt > t);
    const drop = [...all.filter((h) => h.expiresAt <= t), ...alive.slice(maxItems)];
    for (const h of drop) await remove(h.id);
    return alive.slice(0, maxItems).map((h) => ({ ...h, readable: h.schema <= SCHEMA }));
  }

  return {
    /**
     * Guarda (o reemplaza, si el id ya existe) una sesión.
     * @param {{id:string, kind:'protocol'|'protocol-video'|'video', code?:string|null, appVersion:string, build?:string|null,
     *          fingerprintKey?:string|null, meta?:object, results:object[], capture:object, flowConfig?:string|null,
     *          analysis?:object|null, extra?:object|null}} r
     */
    async save({ id, kind, code = null, appVersion, build = null, fingerprintKey = null, meta = {}, results, capture, flowConfig = null, analysis = null, extra = null }) {
      const json = JSON.stringify({ results, capture, flowConfig, analysis, extra });
      const t = now();
      const header = {
        id, schema: SCHEMA, kind, savedAt: t, expiresAt: t + ttlDays * DAY,
        code: code && isValidCode(code) ? code : null, appVersion, build, fingerprintKey,
        meta: { ...meta, kb: Math.max(1, Math.round(json.length / 1024)) },
      };
      await adapter.put('data', { id, json });
      await adapter.put('sessions', header);
      await prune();
      return header;
    },
    /** Cabeceras de las sesiones guardadas (la más nueva primero). `readable: false` si son de una versión más nueva. */
    list: prune,
    async find(fingerprint) {
      return (await prune()).find((h) => h.readable && h.fingerprintKey === fingerprint) ?? null;
    },
    /** @returns {Promise<{header: object, data: {results:object[], capture:object, flowConfig:string|null, analysis:object|null, extra:object|null}}|null>} */
    async load(id) {
      const header = await adapter.get('sessions', id);
      if (!header || header.schema > SCHEMA || header.expiresAt <= now()) return null;
      const row = await adapter.get('data', id);
      try {
        const data = JSON.parse(row?.json ?? 'null');
        return data && Array.isArray(data.results) ? { header, data } : null;
      } catch {
        return null;
      }
    },
    /** Cambia el código anónimo de una sesión guardada (solo si es válido). */
    async patchCode(id, code) {
      const header = await adapter.get('sessions', id);
      if (!header || header.schema > SCHEMA || !isValidCode(code)) return false;
      await adapter.put('sessions', { ...header, code: (code ?? '').trim() || null });
      return true;
    },
    remove,
    async clear() {
      for (const h of await adapter.all('sessions')) await remove(h.id);
      for (const d of await adapter.all('data')) await adapter.delete('data', d.id);
    },
  };
}
