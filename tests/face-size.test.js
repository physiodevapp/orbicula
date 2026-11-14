import { describe, it, expect } from 'vitest';
import { MIN_EYE_PX, EYE_HYSTERESIS_PX, isSmallFace, medianEyePx, smallFaceText, SMALL_FACE_SAY } from '../src/protocol/face-size.js';
import { calibrate } from '../src/protocol/events.js';
import { summarizeProtocol } from '../src/protocol/summary.js';
import { sampleOf } from '../src/landmarks/process.js';
import { GuidedSession } from '../src/assistant/session.js';
import { protocolSteps } from '../src/protocol/steps.js';

describe('cara pequeña (por píxeles del ojo)', () => {
  it('los dos casos del autor: 50 px es pequeña (el reposo fallaba siempre) y 70 px no (calibró)', () => {
    expect(isSmallFace(50)).toBe(true);
    expect(isSmallFace(70)).toBe(false);
    expect(isSmallFace(MIN_EYE_PX)).toBe(false);
    expect(isSmallFace(MIN_EYE_PX - 0.1)).toBe(true);
  });
  it('con histéresis: una vez pequeña, el aviso no se quita hasta pasar el umbral con margen', () => {
    expect(isSmallFace(MIN_EYE_PX + 1, true)).toBe(true);
    expect(isSmallFace(MIN_EYE_PX + EYE_HYSTERESIS_PX, true)).toBe(false);
    expect(isSmallFace(MIN_EYE_PX + 1, false)).toBe(false);
    // Rondando el umbral no parpadea.
    let small = false;
    const states = [58, 61, 59, 62, 61, 60.5].map((px) => (small = isSmallFace(px, small)));
    expect(states).toEqual([true, true, true, true, true, true]);
  });
  it('sin cara o sin dato no es pequeña', () => {
    for (const v of [NaN, null, undefined]) expect(isSmallFace(v)).toBe(false);
    expect(isSmallFace(NaN, true)).toBe(false);
  });
  it('mediana en píxeles, ignorando los huecos', () => {
    expect(medianEyePx([50, 52, null, NaN, 51])).toBe(51);
    expect(medianEyePx([])).toBeNull();
    expect(medianEyePx([null, NaN])).toBeNull();
    expect(medianEyePx(undefined)).toBeNull();
  });
  it('el texto dice cuánto mide y cuánto conviene; la voz habla de «tú»', () => {
    expect(smallFaceText(50.4)).toMatch(/el ojo mide 50 px; conviene más de 60/);
    expect(SMALL_FACE_SAY).toMatch(/Acércate/);
  });
});

/** Un reposo sintético con la cabeza moviéndose casi todo el tiempo (no vale) y `eyePx` de tamaño del ojo. */
function movingRest(ms, eyePx) {
  const n = Math.floor(ms / 33);
  const rel = Array.from({ length: n }, (_, i) => i * 33);
  const side = { ear: rel.map(() => 0.3), aperture: rel.map(() => 0.1) };
  const flowSide = { brow: { eR: rel.map(() => 0.0025) }, canthus: { eR: rel.map(() => 0.0025) } };
  return {
    series: { t: rel, eyePx: rel.map(() => eyePx), left: side, right: side },
    events: { left: [], right: [] },
    flow: { t: rel, dt: rel.map(() => 33), closure: { left: rel.map(() => 0), right: rel.map(() => 0) }, head: { rU: rel.map((x) => (x % 4000 < 3000 ? 0.5 : 0.02)), rV: rel.map(() => 0) }, left: flowSide, right: flowSide },
  };
}

describe('reposo que falla por movimiento', () => {
  it('con la cara pequeña lo dice: se confunde con movimiento, acércate', () => {
    const cal = calibrate(movingRest(20000, 50));
    expect(cal.valid).toBe(false);
    expect(cal.reasonCode).toBe('head'); // el código no cambia (el esquema público no se toca)
    expect(cal.smallFace).toBe(true);
    expect(cal.eyePx).toBe(50);
    expect(cal.reason).toMatch(/la cabeza se ha movido/);
    expect(cal.reason).toMatch(/la cara es pequeña \(el ojo mide 50 px\) y eso se confunde con movimiento: acércate/);
    expect(cal.diagnosis.eyePx).toBe(50);
  });
  it('con la cara de tamaño normal no se menciona', () => {
    const cal = calibrate(movingRest(20000, 80));
    expect(cal.reasonCode).toBe('head');
    expect(cal.smallFace).toBe(false);
    expect(cal.reason).not.toMatch(/pequeña/);
  });
  it('sin datos del tamaño (JSON antiguos) no se menciona', () => {
    const step = movingRest(20000, 50);
    delete step.series.eyePx;
    const cal = calibrate(step);
    expect(cal.reasonCode).toBe('head');
    expect(cal.eyePx).toBeNull();
    expect(cal.reason).not.toMatch(/pequeña/);
  });
});

describe('calidad de la fase', () => {
  const stepOf = (eyePx) => ({ id: 'rest', title: 'Reposo', status: 'completed', durationMs: 3000, perf: { analysisFps: 26 }, events: { left: [], right: [] }, detections: [], marks: [], ...movingRest(3000, eyePx), flow: { ...movingRest(3000, eyePx).flow, head: { rU: [], rV: [] } } });
  it('guarda el tamaño del ojo y, si es pequeño, lo anota sin quitar la fiabilidad de la fase', () => {
    const small = summarizeProtocol([stepOf(50)]).phases.rest.quality;
    expect(small.eyePx).toBe(50);
    expect(small.noteCodes).toContain('small-face');
    expect(small.notes.join(' ')).toMatch(/cara pequeña \(el ojo mide 50 px/);
    expect(small.reliable).toBe(true);
    const big = summarizeProtocol([stepOf(75)]).phases.rest.quality;
    expect(big.eyePx).toBe(75);
    expect(big.noteCodes).not.toContain('small-face');
  });
});

describe('registro del tamaño del ojo', () => {
  it('sampleOf da la media de los dos ojos en píxeles, y NaN si no hay cara', () => {
    const face = { face: true, rois: { left: { eyeWidth: 48, ear: 0.3, aperture: 0.1 }, right: { eyeWidth: 52, ear: 0.3, aperture: 0.1 } }, blend: { left: {}, right: {} } };
    expect(sampleOf(face).eyePx).toBe(50);
    expect(sampleOf({ face: false })).toBeNull();
  });
  it('la sesión lo guarda en cada muestra del paso, paralelo a rel', () => {
    let clock = 0;
    const session = new GuidedSession(protocolSteps(), { now: () => clock, prepMs: 0 });
    session.start();
    session.tick(); session.tick();
    const sample = (px) => ({ left: { ear: 0.3 }, right: { ear: 0.3 }, eyePx: px });
    clock = 100; session.record(100, sample(51.26), {});
    clock = 133; session.record(133, sample(NaN), {});
    const c = session.cur;
    expect(c.eyePx).toEqual([51.3, null]);
    expect(c.eyePx).toHaveLength(c.rel.length);
  });
});
