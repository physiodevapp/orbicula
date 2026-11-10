// Orígenes que pueden hablar con orbicula por postMessage y a los que orbicula puede contestar.
// La lista NUNCA se amplía por la dirección (`?allow=…`): quien incrusta la página elige su dirección, así
// que cualquiera se saltaría la lista. Se amplía al construir (VITE_ORBICULA_ORIGINS, separados por comas)
// o editando DEFAULT_ORIGINS. Sin DOM ni red.

/** Además del propio origen: el hub PhysiQ en GitHub Pages. */
export const DEFAULT_ORIGINS = ['https://physiodevapp.github.io'];

/** Origen (`https://host[:puerto]`) de una dirección, o null si no es http(s) o no es una dirección. */
export function originOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {{self?: string, extra?: string}} [o] self: el origen de esta página; extra: orígenes añadidos
 *   al construir, separados por comas. Los que no sean un origen válido se descartan.
 * @returns {Set<string>}
 */
export function allowedOrigins({ self = typeof location !== 'undefined' ? location.origin : '', extra = '' } = {}) {
  const list = [self, ...DEFAULT_ORIGINS, ...String(extra || '').split(',')];
  return new Set(list.map((o) => originOf(o.trim())).filter(Boolean));
}
