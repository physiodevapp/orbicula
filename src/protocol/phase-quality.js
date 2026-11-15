// ¿Ha salido bien una fase? Se mira al terminarla, con lo grabado (sin DOM). Solo la cara perdida: es lo que el
// clínico puede corregir y lo que invalida la medida. La cara pequeña o la cabeza en movimiento dejan datos
// utilizables con más ruido (el resumen las anota) y no hacen repetir. Decisiones en docs/plan-fase-7.md,
// «Qué hacer cuando una fase sale mal».
//  - Fase sin repeticiones (parpadeo espontáneo): vale si la cara se vio al menos el 90 % del tiempo.
//  - Fase con repeticiones: una repetición vale si la cara se vio el 90 % de su ventana (del «ahora» al «suelta»
//    + 1 s, la misma del resumen). La fase vale si valen 2 de 3 (con otro número, dos tercios; con 1 o 2, todas).
export const PHASE_QUALITY = {
  minFace: 0.9, // fracción de la ventana con la cara detectada
  repLagMs: 1000, // margen tras el «suelta» (el mismo que SUMMARY.repLagMs)
};

/** Repeticiones que tienen que valer: 2 de 3, dos tercios de las demás y todas si son 1 o 2. */
export const neededReps = (count) => (count <= 2 ? count : Math.ceil((count * 2) / 3));

const faceIn = (t, ear, a, b) => {
  let n = 0;
  let ok = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < a || t[i] > b) continue;
    n++;
    if (Number.isFinite(ear.left[i]) || Number.isFinite(ear.right[i])) ok++;
  }
  return n ? ok / n : 0;
};

/**
 * @param {{rel?: number[], series?: {t?: number[], left?: {ear?: number[]}, right?: {ear?: number[]}}, marks?: {rep:number,kind:string,t:number}[], reps?: {count:number}|null}} step
 *        paso grabado (de la sesión en curso o del JSON)
 * @returns {{ok: boolean, code: 'face-lost'|null, text: string|null, face: number, reps?: {rep:number, ok:boolean, face:number}[], valid?: number, needed?: number}}
 */
export function assessPhase(step) {
  const t = step.series?.t ?? step.rel ?? [];
  const ear = { left: step.series?.left?.ear ?? [], right: step.series?.right?.ear ?? [] };
  const face = faceIn(t, ear, -Infinity, Infinity);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const by = {};
  for (const m of step.marks ?? []) (by[m.rep] ??= { rep: m.rep })[m.kind] = m.t;
  const wins = Object.values(by).filter((w) => w.hold != null && w.release != null);
  if (!step.reps || !wins.length) {
    const ok = face >= PHASE_QUALITY.minFace;
    return { ok, code: ok ? null : 'face-lost', text: ok ? null : `la cara estuvo ${Math.round(face * 100)} % del tiempo en el encuadre`, face: r3(face) };
  }
  const reps = wins.map((w) => {
    const f = faceIn(t, ear, w.hold, w.release + PHASE_QUALITY.repLagMs);
    return { rep: w.rep, ok: f >= PHASE_QUALITY.minFace, face: r3(f) };
  });
  const valid = reps.filter((r) => r.ok).length;
  const needed = neededReps(step.reps.count ?? reps.length);
  const ok = valid >= needed;
  return {
    ok, code: ok ? null : 'face-lost',
    text: ok ? null : `se perdió la cara en ${reps.length - valid} de ${reps.length} repeticiones`,
    face: r3(face), reps, valid, needed,
  };
}
