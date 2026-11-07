import { describe, it, expect } from 'vitest';
import { GuidedSession } from '../src/assistant/session.js';
import { PHASE3_STEPS } from '../src/assistant/steps.js';
import { stats, summarizeStep, buildReport, describeSummary, REPORT_SCHEMA } from '../src/assistant/report.js';

const STEPS = [
  { id: 'a', title: 'A', instruction: 'hazA', durationMs: 1000, expect: { left: 1, right: 0 } },
  { id: 'b', title: 'B', instruction: 'hazB', durationMs: 500 },
];

function make(extra = {}) {
  let t = 0;
  const cues = [];
  const s = new GuidedSession(STEPS, { now: () => t, prepMs: 300, onCue: (c) => cues.push(c), getPerf: () => ({ analysisFps: 24 }), ...extra });
  return { s, cues, at: (v) => { t = v; s.tick(); } };
}
const sample = (l, r) => ({ left: { ear: l, aperture: 0.2, blink: 0.1 }, right: { ear: r, aperture: 0.2, blink: 0.1 } });
const ev = (t, kind = 'blink') => ({ kind, t, duration: 120.4, min: 0.1234, baseline: 0.3, completeness: 0.6 });

describe('GuidedSession', () => {
  it('recorre los estados por tiempo: prep → running → review → siguiente → done', () => {
    const { s, cues, at } = make();
    expect(s.state).toBe('idle');
    s.start();
    expect(s.state).toBe('prep');
    at(299);
    expect(s.state).toBe('prep');
    at(300);
    expect(s.state).toBe('running');
    at(1299);
    expect(s.state).toBe('running');
    at(1300);
    expect(s.state).toBe('review');
    expect(s.cur.status).toBe('completed');
    expect(s.cur.perf).toEqual({ analysisFps: 24 });
    s.next();
    expect(s.state).toBe('prep');
    expect(s.index).toBe(1);
    at(1600);
    at(2100);
    expect(s.state).toBe('review');
    s.next();
    expect(s.state).toBe('done');
    expect(s.results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(cues).toEqual(['prep', 'go', 'end', 'prep', 'go', 'end', 'done']);
  });

  it('solo registra mientras se graba y guarda tiempos relativos y eventos compactos', () => {
    const { s, at } = make();
    s.start();
    s.record(5000, sample(0.3, 0.3)); // en la cuenta atrás: se ignora
    at(300);
    s.record(10000, sample(0.31, 0.29));
    s.record(10040, sample(0.1, 0.29), { left: [ev(10020)] });
    s.record(10080, null);
    at(1300);
    s.record(10120, sample(0.3, 0.3)); // en la revisión: se ignora
    const c = s.cur;
    expect(c.rel).toEqual([0, 40, 80]);
    expect(c.series.left.ear).toEqual([0.31, 0.1, null]);
    expect(c.series.right.ear).toEqual([0.29, 0.29, null]);
    expect(c.events.left).toEqual([{ kind: 'blink', t: 20, duration: 120, min: 0.123, baseline: 0.3, completeness: 0.6 }]);
    expect(c.events.right).toEqual([]);
  });

  it('terminar antes de tiempo pasa a la revisión; setUser guarda lo anotado', () => {
    const { s, at } = make();
    s.start();
    at(300);
    at(700);
    s.finishStep();
    expect(s.state).toBe('review');
    expect(s.cur.durationMs).toBe(400);
    s.setUser({ counted: 4, notes: 'el ojo no cerraba' });
    s.next();
    expect(s.results[0].user).toEqual({ counted: 4, notes: 'el ojo no cerraba' });
  });

  it('saltar marca el paso y avanza; repetir descarta lo grabado', () => {
    const { s, at } = make();
    s.start();
    at(300);
    s.record(1, sample(0.3, 0.3));
    s.repeat();
    expect(s.state).toBe('prep');
    expect(s.index).toBe(0);
    expect(s.cur.rel).toEqual([]);
    s.skip();
    expect(s.results[0].status).toBe('skipped');
    expect(s.index).toBe(1);
    s.skip();
    expect(s.state).toBe('done');
    expect(s.results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
  });

  it('interrumpir (p. ej. la cámara se reinicia) deja el paso en revisión como interrumpido', () => {
    const { s, at } = make();
    s.start();
    at(300);
    s.interrupt('cámara reiniciada');
    expect(s.state).toBe('review');
    expect(s.cur.status).toBe('interrupted');
    expect(s.cur.interruptReason).toBe('cámara reiniciada');
    s.interrupt('otra vez'); // ya no está grabando: no hace nada
    expect(s.cur.interruptReason).toBe('cámara reiniciada');
  });

  it('snapshot da el tiempo restante y el progreso', () => {
    const { s, at } = make();
    s.start();
    at(150);
    expect(s.snapshot().remainingMs).toBe(150);
    at(300);
    at(800);
    const snap = s.snapshot();
    expect(snap.remainingMs).toBe(500);
    expect(snap.progress).toBeCloseTo(0.5);
    expect(snap.index).toBe(0);
    expect(snap.total).toBe(2);
    expect(snap.completed).toBe(0);
  });

  it('abort conserva lo ya revisado', () => {
    const { s, at } = make();
    s.start();
    at(300);
    at(1300);
    s.next();
    s.abort();
    expect(s.state).toBe('aborted');
    expect(s.results).toHaveLength(1);
  });

  // Tres pasos para poder volver atrás desde el segundo.
  const THREE = [...STEPS, { id: 'c', title: 'C', instruction: 'hazC', durationMs: 400 }];
  function make3() {
    let t = 0;
    const s = new GuidedSession(THREE, { now: () => t, prepMs: 100 });
    const at = (v) => { t = v; s.tick(); };
    // Completa los pasos que se pidan, de principio a fin, anotando una muestra distinta en cada uno.
    const doStep = (marker) => {
      at(t + 100); // fin de la cuenta atrás
      s.record(t, sample(marker, marker));
      at(t + s.step.durationMs);
      s.next();
    };
    return { s, at, doStep };
  }

  it('repetir el paso en curso conserva los anteriores y sube el nº de intento', () => {
    const { s, at, doStep } = make3();
    s.start();
    doStep(0.31); // paso a, guardado
    at(1000);
    expect(s.step.id).toBe('b');
    s.record(1000, sample(0.2, 0.2)); // algo ocurre durante el paso b…
    s.repeat(); // …y se repite
    expect(s.state).toBe('prep');
    expect(s.step.id).toBe('b');
    expect(s.cur.attempt).toBe(2);
    expect(s.cur.rel).toEqual([]);
    expect(s.results.map((r) => r.id)).toEqual(['a']);
    expect(s.results[0].series.left.ear).toEqual([0.31]);
  });

  it('paso anterior: vuelve al paso previo, descarta su resultado y deja los demás', () => {
    const { s, doStep } = make3();
    s.start();
    doStep(0.31); // a
    doStep(0.32); // b
    expect(s.step.id).toBe('c');
    expect(s.previous()).toBe(true);
    expect(s.step.id).toBe('b');
    expect(s.state).toBe('prep');
    expect(s.cur.attempt).toBe(2);
    expect(s.results.map((r) => r.id)).toEqual(['a']);
    doStep(0.4); // b rehecho
    doStep(0.5); // c
    expect(s.state).toBe('done');
    expect(s.results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(s.results[1].series.left.ear).toEqual([0.4]); // el rehecho, no el primero
    expect(s.results[1].attempt).toBe(2);
    expect(s.results[0].attempt).toBe(1);
  });

  it('paso anterior no hace nada en el primer paso', () => {
    const { s } = make3();
    s.start();
    expect(s.previous()).toBe(false);
    expect(s.index).toBe(0);
    expect(s.cur.attempt).toBe(1);
  });

  it('con la sesión terminada se puede rehacer el último paso', () => {
    const { s, doStep } = make3();
    s.start();
    doStep(0.1);
    doStep(0.2);
    doStep(0.3);
    expect(s.state).toBe('done');
    expect(s.previous()).toBe(true);
    expect(s.step.id).toBe('c');
    expect(s.results.map((r) => r.id)).toEqual(['a', 'b']);
    doStep(0.9);
    expect(s.state).toBe('done');
    expect(s.results[2].series.left.ear).toEqual([0.9]);
  });

  it('detener y retomar: se continúa en el paso que se estaba haciendo, con lo hecho intacto', () => {
    const { s, at, doStep } = make3();
    s.start();
    doStep(0.31); // a
    at(1000);
    s.record(1000, sample(0.2, 0.2));
    s.abort();
    expect(s.state).toBe('aborted');
    expect(s.results.map((r) => r.id)).toEqual(['a']);
    s.resume();
    expect(s.state).toBe('prep');
    expect(s.step.id).toBe('b');
    expect(s.cur.attempt).toBe(2);
    expect(s.cur.rel).toEqual([]);
    doStep(0.4);
    doStep(0.5);
    expect(s.state).toBe('done');
    expect(s.results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('una sesión detenida también permite rehacer el último paso guardado', () => {
    const { s, doStep } = make3();
    s.start();
    doStep(0.31);
    doStep(0.32); // ahora en c
    s.abort();
    expect(s.previous()).toBe(true);
    expect(s.step.id).toBe('b');
    expect(s.results.map((r) => r.id)).toEqual(['a']);
  });

  it('abort y resume no hacen nada fuera de su estado', () => {
    const { s } = make3();
    s.abort();
    expect(s.state).toBe('idle');
    s.resume();
    expect(s.state).toBe('idle');
  });

  it('empezar de nuevo reinicia los intentos', () => {
    const { s, doStep } = make3();
    s.start();
    doStep(0.1);
    s.abort();
    s.reset();
    s.start();
    expect(s.cur.attempt).toBe(1);
  });

  it('la lista de pasos del asistente es coherente', () => {
    const ids = PHASE3_STEPS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PHASE3_STEPS) {
      expect(p.title && p.instruction).toBeTruthy();
      expect(p.durationMs).toBeGreaterThan(0);
    }
  });
});

describe('informe', () => {
  it('stats ignora null y NaN', () => {
    expect(stats([1, 2, 3, null, NaN])).toEqual({ n: 3, mean: 2, sd: 0.816, min: 1, max: 3 });
    expect(stats([])).toEqual({ n: 0, mean: null, sd: null, min: null, max: null });
  });

  function recorded() {
    let t = 0;
    const s = new GuidedSession(STEPS, { now: () => t, prepMs: 100 });
    s.start();
    t = 100;
    s.tick();
    for (let i = 0; i < 10; i++) s.record(1000 + i * 40, i === 9 ? null : sample(0.3, 0.3), i === 4 ? { left: [ev(1150), ev(1160, 'closure')] } : {});
    t = 1100;
    s.tick();
    s.setUser({ counted: 1 });
    s.next();
    return s;
  }

  it('resume por lado: parpadeos, cierres, estadísticas y fracción con cara', () => {
    const s = recorded();
    const sum = summarizeStep(s.results[0]);
    expect(sum.samples).toBe(10);
    expect(sum.faceFraction).toBeCloseTo(0.9);
    expect(sum.left.blinks).toBe(1);
    expect(sum.left.closures).toBe(1);
    expect(sum.right.blinks).toBe(0);
    expect(sum.left.ear.mean).toBeCloseTo(0.3);
    expect(describeSummary(s.results[0])).toMatch(/I: 1 parpadeo/);
  });

  it('buildReport: esquema, series opcionales y sin datos de identificación', () => {
    const s = recorded();
    const base = {
      results: s.results,
      startedAt: s.startedAt,
      code: 'P01',
      build: { version: '0.1.0' },
      device: { userAgent: 'x' },
      capture: {},
      analysis: {},
      detector: {},
    };
    const full = buildReport(base);
    expect(full.schema).toBe(REPORT_SCHEMA);
    expect(full.kind).toBe('test-session');
    expect(full.participantCode).toBe('P01');
    expect(full.steps[0].series.t).toHaveLength(10);
    expect(full.steps[0].series.left.ear).toHaveLength(10);
    expect(full.steps[0].user.counted).toBe(1);
    expect(full.steps[0].attempt).toBe(1);
    expect(JSON.parse(JSON.stringify(full))).toEqual(full); // JSON válido y sin undefined
    const light = buildReport({ ...base, includeSeries: false });
    expect(light.steps[0].series).toBeUndefined();
    expect(light.steps[0].summary.left.blinks).toBe(1);
    expect(Object.keys(full).some((k) => /name|patient|nombre/i.test(k))).toBe(false);
  });
});
