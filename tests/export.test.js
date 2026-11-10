import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildPublicResult, phaseWindows, collectSeries, SCHEMA_VERSION } from '../src/export/result.js';
import { faceCsv, flowCsv } from '../src/export/csv.js';

const schema = JSON.parse(readFileSync(new URL('../docs/orbicula-result.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const check = (doc) => { const ok = validate(doc); return { ok, errors: validate.errors }; };

/** Series de un paso con la forma de las sesiones: rel (ms desde t0) y valores por lado. */
function step(id, { t0, ms, hz = 30, ear = { left: 0.3, right: 0.3 }, smile = 0.02, events = { left: [], right: [] }, detections = [], marks = [], perf = { analysisFps: 26, cameraFps: 30 }, flowHz = 28, calibration = null }) {
  const n = Math.floor((ms / 1000) * hz);
  const rel = Array.from({ length: n }, (_, i) => Math.round((i * 1000) / hz));
  const frel = Array.from({ length: Math.floor((ms / 1000) * flowHz) }, (_, i) => Math.round((i * 1000) / flowHz) + 5);
  const side = (s) => ({ ear: rel.map(() => ear[s]), aperture: rel.map(() => 0.1), blink: rel.map(() => 0.05), smile: rel.map(() => smile) });
  const flowSide = { upperLid: {}, lowerLid: {}, brow: { eR: frel.map(() => 0.0001) }, canthus: { eR: frel.map(() => 0.0001) } };
  return {
    id, title: id, status: 'completed', t0, durationMs: ms, plannedMs: ms, perf, events, detections, marks, calibration,
    rel, series: { left: side('left'), right: side('right') },
    flow: { rel: frel, dt: frel.map(() => 36), closure: { left: frel.map((_, i) => i * 0.0001), right: frel.map(() => 0) }, frozen: frel.map((_, i) => (i === 3 ? 1 : 0)), head: { rU: frel.map(() => 0.01), rV: frel.map(() => 0.02) }, left: flowSide, right: flowSide },
  };
}
const CAL = { valid: true, warning: null, headStill: 0.1, ear: { left: { baseline: 0.3, noise: 0.007 }, right: { baseline: 0.3, noise: 0.007 } }, aperture: { left: { baseline: 0.1 }, right: { baseline: 0.1 } }, rise: { left: 0.04, right: 0.05 }, energy: { left: { brow: 0.1, canthus: 0.1 }, right: { brow: 0.1, canthus: 0.1 } } };
const capture = { source: 'live', analysis: 'live', camera: 'rear', fps: 29.97, width: 720, height: 1280, mirrored: false };

// Reposo desde t = 10 s (la cámara lleva 10 s encendida), parpadeo 8 s después.
const results = [
  step('rest', { t0: 10000, ms: 6000, calibration: CAL }),
  step('natural', { t0: 24000, ms: 9000, events: { left: [{ kind: 'blink', t: 2000, duration: 180, completeness: 0.7 }], right: [{ kind: 'blink', t: 2000, duration: 190, completeness: 0.4 }] }, detections: [{ kind: 'contraction', side: 'left', t: 5000, duration: 900, peak: 2.31, tPeak: 5400, status: 'ok' }, { kind: 'brow', side: 'right', t: 100, duration: 50, peak: 3, tPeak: 120, status: 'ok' }] }),
  step('smile', { t0: 40000, ms: 9000, smile: 0.9, ear: { left: 0.2, right: 0.3 }, marks: [{ rep: 1, kind: 'hold', t: 1000 }, { rep: 1, kind: 'release', t: 4000 }] }),
];

describe('JSON público', () => {
  const doc = buildPublicResult({ results, capture, appVersion: '0.1.0', participantCode: 'P01', createdAt: '2026-11-10T13:00:00.000Z' });

  it('valida contra el esquema documentado (criterio de aceptación 5)', () => {
    const r = check(doc);
    expect(r.errors).toBeNull();
    expect(r.ok).toBe(true);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc).toMatchObject({ app: 'orbicula', appVersion: '0.1.0', participantCode: 'P01' });
  });

  it('el esquema rechaza lo que no debe: campos de más, fases desconocidas, versiones y fechas mal', () => {
    expect(check({ ...doc, extra: 1 }).ok).toBe(false);
    expect(check({ ...doc, schemaVersion: '2' }).ok).toBe(false);
    expect(check({ ...doc, createdAt: 'ayer' }).ok).toBe(false);
    expect(check({ ...doc, protocol: [{ phase: 'otra', start: 0, end: 1 }] }).ok).toBe(false);
    expect(check({ ...doc, capture: { ...doc.capture, source: 'cloud' } }).ok).toBe(false);
    expect(check({ ...doc, participantCode: 'x'.repeat(25) }).ok).toBe(false);
    const { app, ...sinApp } = doc;
    expect(check(sinApp).ok).toBe(false);
  });

  it('los tiempos van en ms desde el primer fotograma del primer paso, con huecos entre fases', () => {
    expect(doc.protocol).toEqual([{ phase: 'rest', start: 0, end: 6000 }, { phase: 'natural', start: 14000, end: 23000 }, { phase: 'smile', start: 30000, end: 39000 }]);
    const ts = doc.timeseries;
    expect(ts.t[0]).toBe(0);
    expect(ts.t.every((t, i) => i === 0 || t >= ts.t[i - 1])).toBe(true);
    expect(ts.phase[ts.t.findIndex((t) => t >= 14000)]).toBe('natural');
    for (const side of ['left', 'right']) for (const k of Object.keys(ts[side])) expect(ts[side][k]).toHaveLength(ts.t.length);
  });

  it('lados del paciente: el ojo izquierdo cierra más en la sonrisa, y su EAR baja en la serie y en la asimetría', () => {
    const smileSamples = doc.timeseries.t.map((t, i) => [t, i]).filter(([t]) => t >= 30000 && t < 39000).map(([, i]) => i);
    expect(doc.timeseries.left.ear[smileSamples[0]]).toBe(0.2);
    expect(doc.timeseries.right.ear[smileSamples[0]]).toBe(0.3);
    expect(doc.metrics.left.smile.closure).toBeGreaterThan(doc.metrics.right.smile.closure);
    expect(doc.metrics.asymmetry.smile.closure).toBeGreaterThan(0);
  });

  it('el cierre por flujo se une a la muestra de la cara más cercana (≤ 40 ms)', () => {
    const closure = doc.timeseries.left.closure;
    expect(closure.slice(0, 5).every((v) => v !== null)).toBe(true);
    expect(closure[2]).toBeGreaterThanOrEqual(closure[1]);
  });

  it('eventos: contracciones con su estado y parpadeos, en orden; los de ceja y canto no se exportan', () => {
    expect(doc.events.map((e) => [e.kind, e.side, e.phase])).toEqual([['blink', 'left', 'natural'], ['blink', 'right', 'natural'], ['contraction', 'left', 'natural']]);
    expect(doc.events[0]).toMatchObject({ t: 16000, status: 'ok', completeness: 0.7 });
    expect(doc.events[2]).toMatchObject({ t: 19000, status: 'ok', duration: 900, peak: 2.31 });
  });

  it('calibración y calidad: umbrales por lado, referencia del EAR y avisos', () => {
    expect(doc.calibration).toMatchObject({ valid: true, thresholds: { left: 0.04, right: 0.05 }, earBaseline: { left: 0.3, right: 0.3 }, warnings: [] });
    expect(doc.quality.natural).toMatchObject({ reliable: true, faceFraction: 1 });
  });

  it('sin ninguna identificación del paciente: ni nombres, ni archivos, ni imágenes', () => {
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/userAgent|fileName|nombre|\.mp4|data:image/i);
    expect(Object.keys(doc).sort()).toEqual(['app', 'appVersion', 'calibration', 'capture', 'createdAt', 'events', 'metrics', 'participantCode', 'protocol', 'quality', 'schemaVersion', 'timeseries']);
    expect(buildPublicResult({ results, capture, appVersion: '0.1.0' }).participantCode).toBeNull();
  });

  it('sin reposo: calibración null y sigue validando', () => {
    const d = buildPublicResult({ results: results.slice(1), capture, appVersion: '0.1.0' });
    expect(d.calibration).toBeNull();
    expect(check(d).errors).toBeNull();
  });

  it('un resultado vacío también valida', () => {
    expect(check(buildPublicResult({ results: [], capture, appVersion: '0.1.0' })).errors).toBeNull();
  });

  it('un vídeo grabado (source file, frame-by-frame, espejo) valida', () => {
    const d = buildPublicResult({ results: [results[0], { ...results[1], id: 'free' }], capture: { source: 'file', analysis: 'frame-by-frame', camera: 'front', fps: 30.01, width: 1080, height: 1920, mirrored: true }, appVersion: '0.1.0' });
    expect(check(d).errors).toBeNull();
    expect(d.capture).toMatchObject({ source: 'file', camera: 'front', mirrored: true });
    expect(d.protocol.map((p) => p.phase)).toEqual(['rest', 'free']);
  });
});

describe('CSV', () => {
  it('cara: cabecera, una fila por muestra, tiempos en ms, vacíos para los null y sin texto del paciente', () => {
    const lines = faceCsv(results).trimEnd().split('\n');
    expect(lines[0]).toBe('t_ms,phase,left_ear,left_aperture,left_blink,left_smile,left_closure,right_ear,right_aperture,right_blink,right_smile,right_closure');
    expect(lines).toHaveLength(1 + collectSeries(phaseWindows(results)).face.t.length);
    expect(lines[1].split(',')).toHaveLength(12);
    expect(lines[1].startsWith('0,rest,0.3,0.1,0.05,0.02,')).toBe(true);
    expect(faceCsv(results)).not.toMatch(/undefined|NaN|null/);
  });

  it('flujo: cierre de cada ojo, congelado y cabeza', () => {
    const lines = flowCsv(results).trimEnd().split('\n');
    expect(lines[0]).toBe('t_ms,phase,left_closure,right_closure,closure_frozen,head_u,head_v');
    expect(lines[1]).toBe('5,rest,0,0,0,0.01,0.02');
    expect(lines[4].split(',')[4]).toBe('1'); // el cuarto par estaba congelado
  });
});
