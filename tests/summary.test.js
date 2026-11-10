import { describe, it, expect } from 'vitest';
import { resample, spectralPeak, FS } from '../src/protocol/spectrum.js';
import { bestCorrelation, summarizeProtocol, repWindows } from '../src/protocol/summary.js';

function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
/** Instantes irregulares a ~30/s, como el flujo y el análisis reales. */
function times(ms, rand = rng(5), from = 0) {
  const t = [];
  for (let x = from; x < from + ms; x += 28 + rand() * 12) t.push(Math.round(x));
  return t;
}

describe('pico espectral', () => {
  it('remuestrea a 20 Hz con la media de cada intervalo y 0 en los huecos', () => {
    expect(resample([0, 10, 60, 160], [1, 3, 5, 7])).toEqual([2, 5, 0, 7]);
    expect(FS).toBe(20);
  });

  it('una oscilación de 3 Hz del párpado sale como actividad rítmica a 3 Hz', () => {
    const r = rng(2);
    const t = times(30000);
    const v = t.map((x) => 0.05 * Math.sin((2 * Math.PI * 3 * x) / 1000) + (r() - 0.5) * 0.04);
    const p = spectralPeak(t, v);
    expect(Math.abs(p.freq - 3)).toBeLessThanOrEqual(0.25);
    expect(p.rhythmic).toBe(true);
    expect(p.prominenceDb).toBeGreaterThan(10);
    expect(p.constancy).toBeGreaterThan(0.8);
  });

  it('el ruido sin ritmo no es actividad rítmica', () => {
    const r = rng(3);
    const t = times(30000);
    const p = spectralPeak(t, t.map(() => (r() - 0.5) * 0.05));
    expect(p.rhythmic).toBe(false);
    expect(p.prominenceDb).toBeLessThan(8);
  });

  it('con menos de una ventana (4 s) no hay pico', () => {
    const t = times(3000);
    expect(spectralPeak(t, t.map(() => 0))).toBeNull();
  });
});

describe('co-activación (correlación con desfase)', () => {
  const t = times(20000);
  const smile = t.map((x) => (Math.floor(x / 4000) % 2 ? 0.9 : 0.05));
  it('el ojo que se cierra con la sonrisa, 200 ms después: r alto y desfase de +200 ms', () => {
    const eye = t.map((x) => (Math.floor((x - 200) / 4000) % 2 ? 0.3 : 0));
    const c = bestCorrelation(t, smile, eye);
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.lagMs).toBe(200);
  });
  it('un ojo que no sigue a la sonrisa: r bajo', () => {
    const r = rng(4);
    const eye = t.map(() => (r() - 0.5) * 0.1);
    expect(Math.abs(bestCorrelation(t, smile, eye).r)).toBeLessThan(0.35);
  });
});

// ── Protocolo sintético: lo justo para comprobar cada métrica ──────────────────────────────────
const BASE = { left: 0.32, right: 0.3 };
const CAL = { valid: true, warning: null, headStill: 0.1, ear: { left: { baseline: BASE.left, noise: 0.007 }, right: { baseline: BASE.right, noise: 0.007 } }, aperture: { left: { baseline: 0.34 }, right: { baseline: 0.33 } }, rise: { left: 0.03, right: 0.03 }, energy: { left: { brow: 0.1, canthus: 0.1 }, right: { brow: 0.1, canthus: 0.1 } } };
const REPS = { count: 3, everyMs: 7000, holdMs: 3000, offsetMs: 2500 };
const marks = () => [0, 1, 2].flatMap((k) => [{ rep: k + 1, kind: 'hold', t: 2500 + 7000 * k }, { rep: k + 1, kind: 'release', t: 5500 + 7000 * k }]);
const inHold = (x) => marks().some((m) => m.kind === 'hold' && x >= m.t + 500 && x <= m.t + 3000);

/** Un paso con series de EAR y sonrisa por lado y flujo plano. */
function step(id, ms, { ear = (x, s) => BASE[s], smile = () => 0.02, events = { left: [], right: [] }, reps = false, detections = [], perf = { analysisFps: 26 } } = {}) {
  const st = times(ms);
  const ft = times(ms, rng(9), 15);
  const flowSide = { upperLid: { dR: ft.map(() => 0), eR: ft.map(() => 0.0001) }, lowerLid: { dR: ft.map(() => 0) }, brow: { dR: ft.map(() => 0), eR: ft.map(() => 0.0001) }, canthus: { eR: ft.map(() => 0.0001) } };
  return {
    id, title: id, status: 'completed', durationMs: ms, perf, events, detections,
    ...(reps ? { reps: REPS, marks: marks() } : { marks: [] }),
    series: { t: st, left: { ear: st.map((x) => ear(x, 'left')), smile: st.map((x) => smile(x, 'left')) }, right: { ear: st.map((x) => ear(x, 'right')), smile: st.map((x) => smile(x, 'right')) } },
    flow: { t: ft, dt: ft.map(() => 33), frozen: ft.map(() => 0), head: { rU: ft.map(() => 0.01), rV: ft.map(() => 0) }, left: flowSide, right: flowSide },
  };
}

describe('resumen del protocolo', () => {
  const blink = (t, c) => ({ kind: 'blink', t, duration: 180, completeness: c, baseline: 0.3, min: 0.1 });
  const steps = [
    { ...step('rest', 30000, { detections: [{ kind: 'contraction', side: 'left', status: 'ok' }] }), calibration: CAL },
    // Parpadeos: el izquierdo cierra la mitad que el derecho.
    step('natural', 60000, { events: { left: [blink(5000, 0.3), blink(9000, 0.3)], right: [blink(5000, 0.6), blink(9000, 0.6)] } }),
    // Cierre suave: cierra un 90 % (I) y un 60 % (D); forzado: un 80 % en los dos (la malla se deforma).
    step('soft', 23500, { reps: true, ear: (x, s) => (inHold(x) ? BASE[s] * (s === 'left' ? 0.1 : 0.4) : BASE[s]) }),
    step('forced', 23500, { reps: true, ear: (x, s) => (inHold(x) ? BASE[s] * 0.2 : BASE[s]) }),
    // Cejas: el ojo se abre un 20 %.
    step('brows', 23500, { reps: true, ear: (x, s) => (inHold(x) ? BASE[s] * 1.2 : BASE[s]) }),
    // Sonrisa: la boca sube igual en los dos lados; el ojo izquierdo se cierra un 30 % con ella y el derecho, nada.
    step('smile', 23500, { reps: true, smile: (x) => (inHold(x) ? 0.95 : 0.02), ear: (x, s) => (s === 'left' && inHold(x) ? BASE[s] * 0.7 : BASE[s]), perf: { analysisFps: 21.5 } }),
  ];
  const sum = summarizeProtocol(steps);
  const P = sum.phases;

  it('las ventanas de las repeticiones van del «ahora» al «suelta» + 1 s', () => {
    expect(repWindows(steps[2])).toEqual([{ rep: 1, from: 2500, to: 6500 }, { rep: 2, from: 9500, to: 13500 }, { rep: 3, from: 16500, to: 20500 }]);
  });

  it('el reposo da la referencia y no cuenta eventos', () => {
    expect(P.rest.left.ear).toBe(0.32);
    expect(P.rest.left.contractions).toBeUndefined();
    expect(P.rest.asymmetry.ear).toBeCloseTo((0.32 - 0.3) / 0.62, 3);
  });

  it('cierres: el mínimo del EAR; el suave del lado derecho se queda corto (asimetría +)', () => {
    expect(P.soft.left.closure).toBeCloseTo(0.9, 2);
    expect(P.soft.right.closure).toBeCloseTo(0.6, 2);
    expect(P.soft.asymmetry.closure).toBeGreaterThan(0);
    expect(P.forced.left.closure).toBeCloseTo(0.8, 2);
  });

  it('parpadeos: frecuencia y completitud respecto al cierre MÁXIMO de cada ojo (el mayor de suave y forzado)', () => {
    expect(P.natural.left.blinksPerMin).toBe(2);
    expect(P.natural.left.blinkVsMax).toBeCloseTo(0.3 / 0.9, 2); // izquierdo: el suave (0,9) es su máximo
    expect(P.natural.right.blinkVsMax).toBeCloseTo(0.6 / 0.8, 2); // derecho: el forzado (0,8)
    expect(P.natural.left.incompletePct).toBe(100);
    expect(P.natural.right.incompletePct).toBe(100);
    expect(P.natural.asymmetry.blinkVsMax).toBeLessThan(0);
  });

  it('cejas: cuánto se abre el ojo (+)', () => {
    expect(P.brows.left.eyeOpening).toBeGreaterThan(0.1);
    expect(P.brows.left.eyeOpening).toBeLessThanOrEqual(0.2);
  });

  it('sonrisa: misma sonrisa, el ojo izquierdo se cierra con ella (co-activación alta) y el derecho no', () => {
    expect(P.smile.left.smile).toBeCloseTo(0.95, 2);
    expect(P.smile.asymmetry.smile).toBeCloseTo(0, 2);
    expect(P.smile.left.closure).toBeGreaterThan(0.15);
    expect(P.smile.right.closure).toBeCloseTo(0, 2);
    expect(P.smile.left.coactivation).toBeGreaterThan(0.8);
    expect(P.smile.right.coactivation ?? 0).toBeLessThan(0.3);
  });

  it('calidad: análisis por debajo de 24/s es una nota; por debajo de 20, poco fiable', () => {
    expect(P.smile.quality.notes.join()).toMatch(/21,5\/s/);
    expect(P.smile.quality.reliable).toBe(true);
    const slow = summarizeProtocol([{ ...steps[0] }, step('natural', 20000, { perf: { analysisFps: 18 } })]);
    expect(slow.phases.natural.quality.reliable).toBe(false);
  });

  it('avisa si falta la calibración o no vale', () => {
    expect(summarizeProtocol([steps[1]]).warnings[0]).toMatch(/Sin calibración/);
    expect(summarizeProtocol([{ ...steps[0], calibration: { ...CAL, valid: false, reason: 'x' } }]).warnings[0]).toMatch(/no válido/);
  });
});
