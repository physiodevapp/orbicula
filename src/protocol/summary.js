// Resumen del protocolo (fase 5c): métricas por fase y por lado del paciente, con su asimetría.
// Sin DOM: recibe los pasos grabados (con la forma del JSON del asistente o de la sesión en curso) y
// la calibración del reposo. Lo usan la pantalla del resumen y scripts/dev/summary.mjs.
//
// Decisiones (docs/plan-fase-5.md):
//  - Repeticiones: ventana [pitido «ahora», pitido «suelta» + 1 s]; el gesto llega ~0,5–1 s tarde.
//  - Cierre de un ojo = 1 − EAR mínimo / EAR del reposo (calibración). En los cierres manda el EAR:
//    con el ojo tapado el flujo no sigue al párpado (y se congela).
//  - Completitud de los parpadeos respecto al CIERRE MÁXIMO del propio paciente (el mayor del cierre suave
//    y del forzado): el EAR no llega a 0 con el ojo cerrado. No vale solo el forzado: al apretar, la malla
//    se deforma y el EAR baja menos que en el suave (protocolo del 2026-11-08). Incompleto: < 80 %
//    (provisional). A ~30 fps el mínimo de un parpadeo de ~180 ms puede caer entre dos frames: la
//    completitud de los parpadeos sale por debajo de la real. Comparar lados y sesiones, no el valor solo.
//  - En las cejas y la sonrisa, el nivel del ojo es la MEDIANA del EAR en la ventana sin los parpadeos
//    (el mínimo lo daría un parpadeo); en los cierres, el mínimo (el cierre es el gesto).
//  - Co-activación ojo–boca: correlación entre la sonrisa de un lado (blendshape mouthSmile) y el cierre
//    del ojo del mismo lado, con el mejor desfase en ±0,3 s. Una sonrisa amplia sana también cierra algo
//    el ojo: lo que informa es la diferencia entre lados y su evolución, no el valor solo.
//  - Sonrisa medida con la COMISURA de la boca (landmarks 61/291 en el sistema de la propia cara, ver
//    src/roi/geometry.js): desplazamiento respecto a la posición de reposo de la propia fase (las muestras fuera
//    de las repeticiones; si no hay bastantes, la mediana del reposo), en distancias intercantales. El
//    blendshape mouthSmile casi satura con una sonrisa amplia y el modelo tiende a darlo simétrico; la
//    comisura da la magnitud de cada lado. `smile` y `coactivation` (blendshape) se mantienen por compatibilidad.
//  - Asimetría = (I − D) / (I + D), solo para magnitudes positivas.
//  - Eventos de ceja y canto: experimentales, no se resumen (demasiados con parpadeos y gestos).
import { asymmetry } from '../metrics/asymmetry.js';
import { headSpeedOf } from './events.js';
import { spectralPeak } from './spectrum.js';
import { medianEyePx, isSmallFace, MIN_EYE_PX } from './face-size.js';

export const SIDES = ['left', 'right'];
export const SUMMARY = {
  repLagMs: 1000, // margen tras el «suelta»
  incompleteRatio: 0.8, // parpadeo incompleto: < 80 % del cierre forzado
  coactLagMs: 300, // desfase máximo de la co-activación
  cornerMinRest: 10, // muestras de reposo (fuera de las repeticiones) para fijar la posición de la comisura
  gridHz: 10, // rejilla común de la co-activación
  minAnalysisFps: 24, // por debajo, nota en la fase (criterio 1)…
  unreliableFps: 20, // …y por debajo de esto, poco fiable
  minFace: 0.9, // cara detectada en al menos este tanto por uno
  maxHeadMoving: 0.2, // cabeza en movimiento como mucho este tanto por uno
};

// 'free': el resto de un vídeo grabado tras el reposo (fase 6, análisis libre); se resume como el parpadeo.
const PHASES = ['rest', 'natural', 'soft', 'forced', 'brows', 'smile', 'free'];
const fin = (v) => (Number.isFinite(v) ? v : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const mean = (a) => {
  const v = a.filter(Number.isFinite);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
};
const maxOf = (a) => {
  const v = a.filter(Number.isFinite);
  return v.length ? Math.max(...v) : null;
};
const minOf = (a) => {
  const v = a.filter(Number.isFinite);
  return v.length ? Math.min(...v) : null;
};

/** Series del paso con nombres comunes (JSON: series.t / flow.t; sesión en curso: rel / flow.rel). */
function view(step) {
  const f = step.flow ?? {};
  return {
    st: step.series?.t ?? step.rel ?? [],
    eyePx: step.series?.eyePx ?? step.eyePx ?? [],
    s: step.series ?? { left: {}, right: {} },
    ft: f.t ?? f.rel ?? [],
    f,
  };
}

/** Repeticiones del paso: [{ rep, from, to }] en el reloj de las series. */
export function repWindows(step, lagMs = SUMMARY.repLagMs) {
  const r = {};
  for (const m of step.marks ?? []) {
    r[m.rep] ??= { rep: m.rep };
    r[m.rep][m.kind] = m.t;
  }
  return Object.values(r).filter((x) => x.hold != null && x.release != null).map((x) => ({ rep: x.rep, from: x.hold, to: x.release + lagMs }));
}

const within = (ts, arr, a, b) => ts.map((t, i) => (t >= a && t <= b ? arr?.[i] : NaN)).filter(Number.isFinite);
const median = (a) => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Intervalos de los parpadeos y cierres de verdad (≥ 50 %, cualquier ojo) del paso, con margen. */
function blinkSpans(step) {
  return SIDES.flatMap((side) => (step.events?.[side] ?? []).filter((e) => e.completeness >= 0.5).map((e) => [e.t - e.duration - 150, e.t + e.duration + 300]));
}
/** EAR de un ojo sin los parpadeos (NaN en sus intervalos). */
function earNoBlinks(step, v, side) {
  const spans = blinkSpans(step);
  return (v.s[side]?.ear ?? []).map((e, i) => (spans.some(([a, b]) => v.st[i] >= a && v.st[i] <= b) ? NaN : e));
}

/** Cierre de un ojo (0–1) en una ventana: 1 − EAR mínimo / EAR del reposo (los cierres). */
function closureIn(v, side, base, a, b) {
  const m = minOf(within(v.st, v.s[side]?.ear, a, b));
  return m == null || !(base > 0) ? null : Math.min(1, Math.max(0, 1 - m / base));
}
/** Cambio del nivel del ojo en una ventana: 1 − mediana del EAR sin parpadeos / EAR del reposo (+ = se cierra). */
function levelIn(v, ear, base, a, b) {
  const m = median(within(v.st, ear, a, b));
  return m == null || !(base > 0) ? null : 1 - m / base;
}

/** Pico de la velocidad residual (raíz de la energía, compensada con el dorso nasal) de una ROI en la ventana. */
function energyPeak(v, side, roi, a, b) {
  const e = within(v.ft, v.f[side]?.[roi]?.eR, a, b);
  return e.length ? Math.sqrt(Math.max(...e)) : null;
}

/** Desplazamiento máximo de la ceja hacia ARRIBA en la ventana (DI): ∫ −(componente hacia abajo) dt. */
function browLift(v, side, a, b) {
  const d = v.f[side]?.brow?.dR;
  if (!d) return null;
  let acc = 0;
  let best = 0;
  v.ft.forEach((t, i) => {
    if (t < a || t > b) return;
    const step = (-(d[i] ?? 0) * (v.f.dt?.[i] ?? 0)) / 1000;
    if (Number.isFinite(step)) acc += step;
    best = Math.max(best, acc);
  });
  return best;
}

/** Mediana de la posición de la comisura de un lado en las muestras que cumplen `keep(t)`. */
function cornerRest(v, side, keep) {
  const o = v.s[side]?.cornerOut ?? [];
  const u = v.s[side]?.cornerUp ?? [];
  const idx = v.st.map((t, i) => i).filter((i) => keep(v.st[i]) && Number.isFinite(o[i]) && Number.isFinite(u[i]));
  if (idx.length < SUMMARY.cornerMinRest) return null;
  return { out: median(idx.map((i) => o[i])), up: median(idx.map((i) => u[i])), n: idx.length };
}

/**
 * Desplazamiento de la comisura de un lado respecto a su reposo, muestra a muestra (DI): `dist` es el total y
 * `lift` la subida (+ = hacia arriba). El reposo es el de la propia fase (fuera de las repeticiones) o, si no
 * hay bastantes muestras, el del paso de reposo (`fallback`).
 * @returns {{dist:number[], lift:number[], rest:{out:number, up:number, n:number}, from:'phase'|'rest'} | null}
 */
export function cornerExcursion(v, side, reps, fallback = null) {
  const own = cornerRest(v, side, (t) => !reps.some((r) => t >= r.from && t <= r.to));
  const rest = own ?? fallback;
  if (!rest) return null;
  const o = v.s[side]?.cornerOut ?? [];
  const u = v.s[side]?.cornerUp ?? [];
  const dist = v.st.map((_, i) => (Number.isFinite(o[i]) && Number.isFinite(u[i]) ? Math.hypot(o[i] - rest.out, u[i] - rest.up) : NaN));
  const lift = v.st.map((_, i) => (Number.isFinite(u[i]) ? u[i] - rest.up : NaN));
  return { dist, lift, rest, from: own ? 'phase' : 'rest' };
}

/**
 * Correlación (Pearson) entre dos series del mismo reloj, con el mejor desfase de `b` respecto a `a` en
 * ±maxLagMs. Se pasan a una rejilla de gridHz (media de cada intervalo).
 * @returns {{r:number, lagMs:number} | null}
 */
export function bestCorrelation(t, a, b, { maxLagMs = SUMMARY.coactLagMs, gridHz = SUMMARY.gridHz } = {}) {
  if (t.length < 3) return null;
  const step = 1000 / gridHz;
  const n = Math.floor((t.at(-1) - t[0]) / step) + 1;
  const grid = (x) => {
    const sum = new Float64Array(n);
    const cnt = new Uint16Array(n);
    t.forEach((tt, i) => {
      if (!Number.isFinite(x[i])) return;
      const k = Math.min(n - 1, Math.floor((tt - t[0]) / step));
      sum[k] += x[i];
      cnt[k]++;
    });
    return Array.from(sum, (s, k) => (cnt[k] ? s / cnt[k] : NaN));
  };
  const ga = grid(a);
  const gb = grid(b);
  const maxLag = Math.round(maxLagMs / step);
  let best = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const xs = [];
    const ys = [];
    for (let k = 0; k < n; k++) {
      const j = k + lag;
      if (j < 0 || j >= n || !Number.isFinite(ga[k]) || !Number.isFinite(gb[j])) continue;
      xs.push(ga[k]);
      ys.push(gb[j]);
    }
    if (xs.length < 10) continue;
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let k = 0; k < xs.length; k++) {
      sxy += (xs[k] - mx) * (ys[k] - my);
      sxx += (xs[k] - mx) ** 2;
      syy += (ys[k] - my) ** 2;
    }
    if (!(sxx > 0 && syy > 0)) continue;
    const r = sxy / Math.sqrt(sxx * syy);
    if (!best || r > best.r) best = { r, lagMs: lag * step };
  }
  return best;
}

/** Calidad de una fase: cara, cabeza en movimiento, ritmo del análisis. */
function quality(step, v, cal) {
  const n = v.st.length;
  const face = n ? v.st.filter((_, i) => Number.isFinite(v.s.left?.ear?.[i]) || Number.isFinite(v.s.right?.ear?.[i])).length / n : 0;
  const speeds = v.ft.map((_, i) => headSpeedOf(v.f.head?.rU?.[i], v.f.head?.rV?.[i]));
  const known = speeds.filter(Number.isFinite);
  const moving = known.length && cal?.headStill ? known.filter((s) => s > cal.headStill).length / known.length : null;
  const fps = step.perf?.analysisFps ?? null;
  // `notes` (texto, para la pantalla) y `noteCodes` (para el JSON y el hub) van en paralelo.
  const notes = [];
  const noteCodes = [];
  const note = (code, text) => { noteCodes.push(code); notes.push(text); };
  if (face < SUMMARY.minFace) note('face-lost', 'se ha perdido la cara');
  if (moving != null && moving > SUMMARY.maxHeadMoving) note('head-moving', 'la cabeza se ha movido');
  // Tamaño del ojo: solo una nota (no cambia si la fase es fiable); el umbral es provisional (face-size.js).
  const eyePx = medianEyePx(v.eyePx);
  if (isSmallFace(eyePx)) note('small-face', `cara pequeña (el ojo mide ${eyePx} px; conviene más de ${MIN_EYE_PX})`);
  const slow = fps != null && fps < SUMMARY.unreliableFps;
  if (fps != null && fps < SUMMARY.minAnalysisFps) note('low-fps', `análisis a ${String(fps).replace('.', ',')}/s (< ${SUMMARY.minAnalysisFps})`);
  const reliable = face >= SUMMARY.minFace && !(moving > SUMMARY.maxHeadMoving) && !slow;
  return { face: r3(face), headMoving: r3(moving), analysisFps: fps, eyePx, reliable, notes, noteCodes };
}

/** Eventos del paso por lado: contracciones que cuentan, breves y parpadeos/cierres. */
function eventCounts(step, side) {
  const d = (step.detections ?? []).filter((e) => e.side === side);
  return {
    contractions: d.filter((e) => e.kind === 'contraction' && e.status === 'ok').length,
    brief: d.filter((e) => e.kind === 'contraction' && e.status === 'brief').length,
  };
}

/** Métricas de un lado en una fase. */
function sideMetrics(phase, step, v, side, cal, ctx) {
  const base = cal?.ear?.[side]?.baseline;
  const reps = repWindows(step);
  // En el reposo no se cuentan eventos: es la calibración.
  const out = phase === 'rest' ? {} : { ...eventCounts(step, side) };
  if (phase === 'rest' || phase === 'natural' || phase === 'free') {
    // Pico espectral del párpado superior (velocidad vertical); los pares congelados valen 0.
    const d = v.f[side]?.upperLid?.dR ?? [];
    const sig = v.ft.map((_, i) => (v.f.frozen?.[i] ? 0 : d[i]));
    out.spectrum = spectralPeak(v.ft, sig);
  }
  if (phase === 'rest') {
    out.ear = fin(base);
    out.earNoise = fin(cal?.ear?.[side]?.noise);
    out.aperture = fin(cal?.aperture?.[side]?.baseline);
    out.threshold = fin(cal?.rise?.[side]);
  }
  if (phase === 'natural' || phase === 'free') {
    const blinks = (step.events?.[side] ?? []).filter((e) => e.kind === 'blink');
    const minutes = (step.durationMs ?? (v.st.at(-1) ?? 0)) / 60000;
    out.blinksPerMin = minutes > 0 ? r3(blinks.length / minutes) : null;
    out.blinkMs = r3(mean(blinks.map((e) => e.duration)));
    out.blinkCompleteness = r3(mean(blinks.map((e) => e.completeness)));
    const maxClosure = ctx.maxClosure?.[side];
    if (maxClosure > 0 && blinks.length) {
      const rel = blinks.map((e) => e.completeness / maxClosure);
      out.blinkVsMax = r3(Math.min(1.5, mean(rel)));
      out.incompletePct = r3((100 * rel.filter((x) => x < SUMMARY.incompleteRatio).length) / blinks.length);
    }
  }
  if (phase === 'soft' || phase === 'forced') out.closure = r3(mean(reps.map((r) => closureIn(v, side, base, r.from, r.to))));
  if (phase === 'brows' || phase === 'smile') {
    const ear = earNoBlinks(step, v, side);
    const level = mean(reps.map((r) => levelIn(v, ear, base, r.from, r.to)));
    // Cejas: cuánto se ABRE el ojo (+); sonrisa: cuánto se cierra (+).
    if (phase === 'brows') out.eyeOpening = r3(level == null ? null : -level);
    else out.closure = r3(level == null ? null : Math.max(0, level));
  }
  if (phase === 'soft' || phase === 'forced') {
    // Reclutamiento: pico de la ceja y del canto en las repeticiones, en veces su p99 del reposo.
    for (const roi of ['brow', 'canthus']) {
      const p99 = cal?.energy?.[side]?.[roi];
      out[`${roi}Recruit`] = p99 > 0 ? r3(mean(reps.map((r) => energyPeak(v, side, roi, r.from, r.to))) / p99) : null;
    }
  }
  if (phase === 'brows') {
    out.browLift = r3(mean(reps.map((r) => browLift(v, side, r.from, r.to))));
    const p99 = cal?.energy?.[side]?.brow;
    out.browPeak = p99 > 0 ? r3(mean(reps.map((r) => energyPeak(v, side, 'brow', r.from, r.to))) / p99) : null;
  }
  if (phase === 'smile') {
    out.smile = r3(mean(reps.map((r) => maxOf(within(v.st, v.s[side]?.smile, r.from, r.to)))));
    const eyeClosure = earNoBlinks(step, v, side).map((e) => (Number.isFinite(e) && base > 0 ? 1 - e / base : NaN));
    const c = bestCorrelation(v.st, v.s[side]?.smile ?? [], eyeClosure);
    out.coactivation = c ? r3(c.r) : null;
    out.coactivationLagMs = c ? c.lagMs : null;
    // Con la comisura: cuánto se desplaza (total y hacia arriba) y su correlación con el cierre del ojo.
    const ex = cornerExcursion(v, side, reps, ctx.cornerRest?.[side]);
    if (ex) {
      out.commissure = r3(mean(reps.map((r) => maxOf(within(v.st, ex.dist, r.from, r.to)))));
      out.commissureLift = r3(mean(reps.map((r) => maxOf(within(v.st, ex.lift, r.from, r.to)))));
      const cc = bestCorrelation(v.st, ex.dist, eyeClosure);
      out.coactivationCorner = cc ? r3(cc.r) : null;
      out.coactivationCornerLagMs = cc ? cc.lagMs : null;
    }
  }
  return out;
}

/** Métricas en las que tiene sentido la asimetría (magnitudes positivas). */
const ASYM_KEYS = ['ear', 'aperture', 'blinksPerMin', 'blinkCompleteness', 'blinkVsMax', 'closure', 'eyeOpening', 'browRecruit', 'canthusRecruit', 'browLift', 'browPeak', 'smile', 'commissure', 'commissureLift'];
// (los recuentos de contracciones no llevan asimetría: con 1 o 2 eventos, 2 frente a 1 sería +0,33 sin significar nada)

/**
 * Resumen del protocolo.
 * @param {object[]} steps pasos grabados (results de la sesión o steps del JSON)
 * @returns {{calibration: object|null, phases: object, warnings: string[], warningCodes: string[]}}
 */
export function summarizeProtocol(steps) {
  const byId = Object.fromEntries(steps.filter((s) => s.status === 'completed').map((s) => [s.id, s]));
  const cal = byId.rest?.calibration ?? null;
  // El cierre máximo de cada ojo (el mayor del suave y del forzado) hace falta antes, para los parpadeos.
  const maxClosure = {};
  for (const side of SIDES) {
    const c = ['soft', 'forced'].filter((id) => byId[id]).map((id) => {
      const v = view(byId[id]);
      return mean(repWindows(byId[id]).map((r) => closureIn(v, side, cal?.ear?.[side]?.baseline, r.from, r.to)));
    });
    maxClosure[side] = maxOf(c);
  }
  // Posición de reposo de las comisuras (todo el paso de reposo): respaldo si la fase de sonrisa no tiene bastante.
  const cornerRestOf = {};
  if (byId.rest) {
    const v = view(byId.rest);
    for (const side of SIDES) cornerRestOf[side] = cornerRest(v, side, () => true);
  }
  const phases = {};
  for (const id of PHASES) {
    const step = byId[id];
    if (!step) continue;
    const v = view(step);
    const left = sideMetrics(id, step, v, 'left', cal, { maxClosure, cornerRest: cornerRestOf });
    const right = sideMetrics(id, step, v, 'right', cal, { maxClosure, cornerRest: cornerRestOf });
    const asym = {};
    for (const k of ASYM_KEYS) {
      if (Number.isFinite(left[k]) && Number.isFinite(right[k]) && left[k] >= 0 && right[k] >= 0) asym[k] = r3(asymmetry(left[k], right[k]));
    }
    phases[id] = { title: step.title, left, right, asymmetry: asym, quality: quality(step, v, cal) };
  }
  // `warnings` (texto) y `warningCodes` (no-calibration, invalid-rest, high-threshold) van en paralelo.
  const warnings = [];
  const warningCodes = [];
  const warn = (code, text) => { warningCodes.push(code); warnings.push(text); };
  if (!cal) warn('no-calibration', 'Sin calibración: falta el reposo.');
  else if (!cal.valid) warn('invalid-rest', `Reposo no válido: ${cal.reason}.`);
  if (cal?.warning) warn('high-threshold', cal.warning);
  return { calibration: cal, phases, warnings, warningCodes };
}
