// Avisos de calidad por voz durante el protocolo (cara perdida, cara pequeña). Función pura: decide si se puede
// hablar ahora; la voz y los tonos viven en src/ui/assistant.js y el ritmo (cada cuánto repetir) en main.js.
//
// Con la trasera no se mira la pantalla, así que sin voz el clínico no sabe que se ha ido del encuadre.
// Reglas (docs/plan-fase-7.md, «Avisos por voz en todas las fases»):
//  - Cara perdida: en cualquier paso y fase, si lleva perdida 1,5 s. Se repite (main.js, cada 10 s) mientras siga.
//  - Cara pequeña: en el reposo, como antes (decide si la calibración vale); en las demás fases, una sola vez por
//    paso y solo si lleva 3 s pequeña: los datos siguen valiendo, con más ruido.
//  - Nunca durante un gesto: ni entre el «ahora» y el «suelta», ni el segundo y medio siguiente (el gesto llega
//    ~0,5–1 s tarde, ver SUMMARY.repLagMs). El aviso espera a la pausa y, como main.js lo reintenta con cada
//    resultado, sale en cuanto se puede.

/** Tras el «suelta», margen en el que aún se está relajando el gesto. */
export const GESTURE_QUIET_MS = 1500;
export const LOST_AFTER_MS = 1500;
export const SMALL_AFTER_MS = 3000;

/** ¿Hay un gesto en curso? `rep` es snapshot().rep: { holding, sinceMs } (null si el paso no tiene repeticiones). */
export function gestureBusy(rep) {
  if (!rep) return false;
  if (rep.holding) return true;
  return rep.sinceMs != null && rep.sinceMs < GESTURE_QUIET_MS;
}

/**
 * @param {'lost'|'small'} kind
 * @param {{state:string, index:number, step:{calibrates?:boolean}|null, rep:object|null, current?:{attempt?:number}|null}} snap snapshot de la sesión
 * @param {number} sustainedMs cuánto lleva así la condición
 * @param {Set<string>} warned avisos de «cara pequeña» ya dados (uno por paso e intento)
 * @returns {{speak: boolean, key?: string}}
 */
export function qualityVoice(kind, snap, sustainedMs, warned = new Set()) {
  if (!['prep', 'running'].includes(snap?.state)) return { speak: false };
  const calibrating = !!snap.step?.calibrates;
  if (kind === 'lost') return { speak: sustainedMs >= LOST_AFTER_MS && !gestureBusy(snap.rep) };
  if (kind === 'small') {
    if (calibrating) return { speak: true };
    const key = `${snap.index}:${snap.current?.attempt ?? 1}`;
    if (sustainedMs < SMALL_AFTER_MS || gestureBusy(snap.rep) || warned.has(key)) return { speak: false };
    return { speak: true, key };
  }
  return { speak: false };
}
