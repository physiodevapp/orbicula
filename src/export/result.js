// JSON público de resultados (fase 7): la interfaz de datos de orbicula. Su esquema está en
// docs/orbicula-result.schema.json y documentado en docs/schema.md. Función pura, sin DOM.
//
// Reglas:
//  - Tiempos en milisegundos desde el inicio de la grabación (el primer fotograma del primer paso = 0).
//  - Lados siempre del paciente: `left` es la izquierda del paciente.
//  - Ningún dato que identifique al paciente: solo `participantCode`, que escribe el clínico.
//  - No se rompe la compatibilidad sin subir `schemaVersion`.
import { summarizeProtocol } from '../protocol/summary.js';
import { provenance } from './provenance.js';

export const SCHEMA_VERSION = '1';
export const SIDES = ['left', 'right'];
/** Señales de la cara que van en `timeseries` (por lado), y de dónde salen en los pasos grabados. */
export const SERIES = { ear: 'ear', aperture: 'aperture', blink: 'blink', smile: 'smile' };

/** Código del participante: letras sin tilde, números, «-» y «_», hasta 24. Cualquier otra cosa se rechaza. */
export const CODE_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;
export const isValidCode = (code) => !code || CODE_PATTERN.test(String(code).trim());
export const cleanCode = (code) => {
  const c = (code ?? '').toString().trim();
  if (!c) return null;
  // No se «limpia» en silencio: «Juan Pérez» no debe convertirse en «JuanPrez».
  if (!CODE_PATTERN.test(c)) throw new Error('participantCode no válido: solo letras sin tilde, números, «-» y «_» (hasta 24).');
  return c;
};

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r4 = (v) => (Number.isFinite(v) ? Number(v.toPrecision(4)) : null);
const median = (a) => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Pasos completados, con su inicio y fin en el tiempo de la grabación (ms). */
export function phaseWindows(results) {
  const done = results.filter((r) => r.status === 'completed' && r.t0 != null);
  const origin = done.length ? Math.min(...done.map((r) => r.t0)) : 0;
  return done.map((r) => {
    const start = Math.round(r.t0 - origin);
    return { id: r.id, step: r, start, end: start + Math.round(r.durationMs ?? r.plannedMs ?? 0) };
  });
}

/** Métricas de una fase: números, booleanos y null; el pico espectral, desplegado. */
function flat(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k === 'spectrum') {
      out.spectrumFreqHz = v?.freq ?? null;
      out.spectrumProminenceDb = v?.prominenceDb ?? null;
      out.spectrumRhythmic = v?.rhythmic ?? null;
    } else if (typeof v === 'number') out[k] = r4(v);
    else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

/** Para cada instante de la cara, la muestra más cercana del flujo (si está a menos de `maxGap` ms). */
function nearest(flowT, flowV, t, maxGap = 40) {
  const out = new Array(t.length).fill(null);
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    while (j + 1 < flowT.length && Math.abs(flowT[j + 1] - t[i]) <= Math.abs(flowT[j] - t[i])) j++;
    if (flowT.length && Math.abs(flowT[j] - t[i]) <= maxGap) out[i] = flowV[j] ?? null;
  }
  return out;
}

/**
 * Series de la cara y del flujo de todas las fases, en un solo eje de tiempo.
 * @returns {{face: {t:number[], phase:string[], frozen:(0|1|null)[], left:object, right:object}, flow: {t:number[], phase:string[], closure:{left:number[],right:number[]}, frozen:number[], head:{u:number[],v:number[]}}}}
 */
export function collectSeries(windows) {
  const face = { t: [], phase: [], frozen: [], left: { ear: [], aperture: [], blink: [], smile: [], closure: [] }, right: { ear: [], aperture: [], blink: [], smile: [], closure: [] } };
  const flow = { t: [], phase: [], closure: { left: [], right: [] }, frozen: [], head: { u: [], v: [] } };
  for (const w of windows) {
    const s = w.step;
    const rel = s.rel ?? s.series?.t ?? [];
    const f = s.flow ?? {};
    const frel = f.rel ?? f.t ?? [];
    const ft = frel.map((x) => w.start + x);
    const t = rel.map((x) => w.start + x);
    for (const side of SIDES) {
      const closure = nearest(ft, f.closure?.[side] ?? [], t);
      for (const [key, src] of Object.entries(SERIES)) face[side][key].push(...rel.map((_, i) => r3(s.series?.[side]?.[src]?.[i])));
      face[side].closure.push(...closure.map(r4));
    }
    face.frozen.push(...nearest(ft, frel.map((_, i) => (f.frozen?.[i] ? 1 : 0)), t));
    face.t.push(...t);
    face.phase.push(...t.map(() => w.id));
    flow.t.push(...ft);
    flow.phase.push(...ft.map(() => w.id));
    for (const side of SIDES) flow.closure[side].push(...frel.map((_, i) => r4(f.closure?.[side]?.[i])));
    flow.frozen.push(...frel.map((_, i) => (f.frozen?.[i] ? 1 : 0)));
    flow.head.u.push(...frel.map((_, i) => r3(f.head?.rU?.[i])));
    flow.head.v.push(...frel.map((_, i) => r3(f.head?.rV?.[i])));
  }
  return { face, flow };
}

/** Eventos de todas las fases: contracciones (con su estado) y parpadeos / cierres del EAR. */
export function collectEvents(windows) {
  const out = [];
  for (const w of windows) {
    const s = w.step;
    for (const e of s.detections ?? []) {
      if (e.kind !== 'contraction') continue; // los de ceja y canto son experimentales y no se exportan
      out.push({ phase: w.id, side: e.side, kind: 'contraction', status: e.status, t: w.start + e.t, tPeak: e.tPeak == null ? null : w.start + e.tPeak, duration: e.duration, peak: r3(e.peak) });
    }
    for (const side of SIDES) {
      for (const e of s.events?.[side] ?? []) {
        out.push({ phase: w.id, side, kind: e.kind, status: 'ok', t: w.start + e.t, duration: e.duration, completeness: r3(e.completeness) });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Construye el JSON público.
 * @param {{
 *   results: object[],                    pasos grabados (sesión del protocolo o del análisis del vídeo)
 *   capture: {source: 'live'|'file', analysis: 'live'|'frame-by-frame', camera: 'rear'|'front'|null,
 *             fps: number|null, width: number|null, height: number|null, mirrored: boolean},
 *   appVersion: string,
 *   participantCode?: string|null,
 *   createdAt?: string,
 *   flowConfig?: string,                  clave de la configuración del flujo usada (FLOW_CONFIGS)
 *   analysis?: object,                    procedencia guardada con la sesión (si se exporta una sesión recuperada de otra versión)
 * }} o
 */
export function buildPublicResult({ results, capture, appVersion, participantCode = null, createdAt = new Date().toISOString(), flowConfig, analysis: analysisAtSave = null }) {
  const windows = phaseWindows(results);
  const summary = summarizeProtocol(windows.map((w) => w.step));
  const cal = summary.calibration;
  const metrics = { left: {}, right: {}, asymmetry: {} };
  const quality = {};
  for (const [id, p] of Object.entries(summary.phases)) {
    metrics.left[id] = flat(p.left);
    metrics.right[id] = flat(p.right);
    metrics.asymmetry[id] = flat(p.asymmetry);
    quality[id] = { reliable: p.quality.reliable, faceFraction: p.quality.face, headMoving: p.quality.headMoving, analysisFps: p.quality.analysisFps, notes: p.quality.notes.map((text, i) => ({ code: p.quality.noteCodes?.[i] ?? 'other', text })) };
  }
  const { face, flow } = collectSeries(windows);
  const timeseries = { t: face.t, phase: face.phase, frozen: face.frozen, left: face.left, right: face.right };
  return {
    app: 'orbicula',
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    participantCode: cleanCode(participantCode),
    capture: {
      source: capture.source,
      analysis: capture.analysis,
      camera: capture.camera ?? null,
      fps: r3(capture.fps),
      width: capture.width ?? null,
      height: capture.height ?? null,
      mirrored: !!capture.mirrored,
    },
    analysis: provenance({ flowConfig, snapshot: analysisAtSave }),
    protocol: windows.map((w) => ({ phase: w.id, start: w.start, end: w.end })),
    calibration: cal
      ? {
          valid: !!cal.valid,
          reason: cal.reason ?? null,
          reasonCode: cal.valid ? null : (cal.reasonCode ?? null),
          thresholds: { left: r4(cal.rise?.left), right: r4(cal.rise?.right) },
          earBaseline: { left: r4(cal.ear?.left?.baseline), right: r4(cal.ear?.right?.baseline) },
          headStill: r4(cal.headStill),
          warnings: summary.warnings.map((text, i) => ({ code: summary.warningCodes?.[i] ?? 'other', text })),
        }
      : null,
    metrics,
    quality,
    events: collectEvents(windows),
    timeseries, // las series del flujo no van aquí: están en el CSV de flujo (src/export/csv.js)
  };
}

/** Atajo para el CSV: las series de la cara y del flujo de los mismos pasos. */
export function seriesOf(results) {
  return collectSeries(phaseWindows(results));
}

/** Mediana de los fps de cámara registrados en los pasos (para `capture.fps` en directo). */
export function medianCameraFps(results) {
  return median(results.map((r) => r.perf?.cameraFps));
}
