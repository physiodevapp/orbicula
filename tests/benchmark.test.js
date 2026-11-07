import { describe as suite, it, expect } from 'vitest';
import { buildPlan, describe, summarizeRun, summarizeFlow, flowRaw, groupSummary, buildBenchmarkReport, COMBOS, BENCH_SCHEMA } from '../src/assistant/benchmark.js';

suite('plan de pasadas', () => {
  it('cada configuración dos veces, la segunda ronda en orden inverso, empezando y acabando sin flujo', () => {
    const plan = buildPlan();
    expect(plan).toHaveLength(2 * COMBOS.length);
    expect(plan.map((p) => p.index)).toEqual(plan.map((p, i) => i + 1));
    const keys = plan.map((p) => p.flow);
    expect(keys.slice(0, COMBOS.length)).toEqual(COMBOS.map((c) => c.key));
    expect(keys.slice(COMBOS.length)).toEqual(COMBOS.map((c) => c.key).reverse());
    expect(keys[0]).toBe('none');
    expect(keys.at(-1)).toBe('none');
    for (const c of COMBOS) expect(plan.filter((p) => p.flow === c.key)).toHaveLength(2);
    expect(plan.find((p) => p.flow === 'lk-640')).toMatchObject({ method: 'lk', maxWidth: 640 });
  });
  it('compara Farnebäck a varios tamaños y Lucas-Kanade', () => {
    expect(COMBOS.filter((c) => c.method === 'farneback').length).toBeGreaterThanOrEqual(3);
    expect(COMBOS.some((c) => c.method === 'lk')).toBe(true);
  });
  it('se pueden pedir más rondas', () => {
    expect(buildPlan({ rounds: 4 })).toHaveLength(4 * COMBOS.length);
  });
});

suite('describe', () => {
  it('estadísticos y percentiles sin contar null ni NaN', () => {
    const d = describe([10, 20, 30, 40, 50, null, NaN]);
    expect(d).toMatchObject({ n: 5, mean: 30, p50: 30, min: 10, max: 50 });
    expect(d.p90).toBeCloseTo(46, 5);
    expect(describe([])).toMatchObject({ n: 0, mean: null });
  });
});

// Pasada sintética: resultados cada `step` ms durante `seconds` s, con `ms` de inferencia.
function raw({ seconds = 10, step = 40, ms = 30, camFps = 30, withFace = 1 }) {
  const r = { tRel: [], inferMs: [], latencyMs: [], bitmapMs: [], roundTripMs: [], faces: [], camT: [], camPresented: [], rafMs: [], longTasks: [] };
  for (let t = 0; t <= seconds * 1000; t += step) {
    r.tRel.push(t);
    r.inferMs.push(ms);
    r.latencyMs.push(ms + 20);
    r.bitmapMs.push(null);
    r.roundTripMs.push(null);
    r.faces.push(Math.random() < withFace);
  }
  for (let t = 0; t <= seconds * 1000; t += 1000 / camFps) {
    r.camT.push(t);
    r.camPresented.push(Math.round((t * camFps) / 1000));
  }
  for (let t = 0; t <= seconds * 1000; t += 16.7) r.rafMs.push({ t, d: 16.7 });
  return r;
}

suite('summarizeRun', () => {
  it('no cuenta el calentamiento y calcula fps, intervalos y fracción analizada', () => {
    const data = raw({ seconds: 10, step: 40, ms: 30, camFps: 30 });
    data.inferMs = data.inferMs.map((v, i) => (data.tRel[i] < 3000 ? 200 : v)); // el calentamiento es lento
    const s = summarizeRun(data, { warmupMs: 3000 });
    expect(s.inferMs.mean).toBeCloseTo(30, 1); // sin los 200 ms del calentamiento
    expect(s.analysisFps).toBeCloseTo(25, 0);
    expect(s.cameraFps).toBeCloseTo(30, 0);
    expect(s.presentedFps).toBeCloseTo(30, 0);
    expect(s.analysedFraction).toBeCloseTo(25 / 30, 1);
    expect(s.intervalMs.mean).toBeCloseTo(40, 1);
    expect(s.faceFraction).toBe(1);
    expect(s.ui.over50ms).toBe(0);
    expect(s.ui.frameMs.p50).toBeCloseTo(16.7, 1);
  });

  it('si los callbacks de vídeo se pierden (hilo ocupado), la cámara se mide con presentedFrames', () => {
    const data = raw({ seconds: 10, camFps: 53 });
    // Hilo principal ocupado: solo llega un callback cada ~48 ms, pero el contador sigue a 53 por segundo.
    data.camT = [];
    data.camPresented = [];
    for (let t = 0; t <= 10000; t += 48) {
      data.camT.push(t);
      data.camPresented.push(Math.round((t * 53) / 1000));
    }
    const s = summarizeRun(data, { warmupMs: 3000 });
    expect(s.callbackFps).toBeCloseTo(20.8, 0);
    expect(s.presentedFps).toBeCloseTo(53, 0);
    expect(s.cameraFps).toBeCloseTo(53, 0);
  });

  it('cuenta los repintados lentos y las tareas largas del hilo principal', () => {
    const data = raw({});
    data.rafMs.push({ t: 5000, d: 120 }, { t: 6000, d: 70 }, { t: 1000, d: 500 }); // el último cae en el calentamiento
    data.longTasks.push({ t: 5000, d: 120 }, { t: 6000, d: 60 }, { t: 500, d: 300 });
    const s = summarizeRun(data, { warmupMs: 3000 });
    expect(s.ui.over50ms).toBe(2);
    expect(s.ui.over100ms).toBe(1);
    expect(s.ui.longTasks).toEqual({ n: 2, totalMs: 180, maxMs: 120 });
  });

  it('con una pasada vacía no revienta', () => {
    const s = summarizeRun({ tRel: [], inferMs: [], latencyMs: [], bitmapMs: [], roundTripMs: [], faces: [], camT: [], camPresented: [], rafMs: [], longTasks: [] }, { warmupMs: 3000 });
    expect(s.results).toBe(0);
    expect(s.analysisFps).toBeNull();
  });
});

// Flujo sintético: un frame cada `step` ms; el primero de cada franja no hace par.
function flow({ seconds = 10, step = 1000 / 60, ms = 12, total = 18 }) {
  const f = flowRaw();
  for (let t = 0, k = 0; t <= seconds * 1000; t += step, k++) {
    const paired = k > 0;
    f.t.push(t);
    f.paired.push(paired);
    f.flowMs.push(paired ? ms : null);
    f.readMs.push(3);
    f.prepMs.push(1);
    f.totalMs.push(total);
    f.cropMs.push(0.5);
    f.latencyMs.push(40);
    f.roundTripMs.push(30);
    f.dt.push(paired ? step : null);
  }
  f.size = { width: 320, height: 110 };
  f.counts = { submitted: 420, busy: 0, noStrip: 0, replaced: 0 };
  return f;
}

suite('summarizeFlow', () => {
  it('pares por segundo, fracción de la cámara y tiempos sin el calentamiento', () => {
    const f = flow({});
    f.flowMs = f.flowMs.map((v, i) => (f.t[i] < 3000 && v != null ? 100 : v)); // el calentamiento es lento
    const s = summarizeFlow(f, { warmupMs: 3000, cameraFps: 60 });
    expect(s.flowFps).toBeCloseTo(60, 0);
    expect(s.flowFraction).toBeCloseTo(1, 1);
    expect(s.flowMs.mean).toBeCloseTo(12, 5);
    expect(s.totalMs.mean).toBeCloseTo(18, 5);
    expect(s.dtMs.mean).toBeCloseTo(16.67, 1);
    expect(s.size).toEqual({ width: 320, height: 110 });
    expect(s.counts.submitted).toBe(420);
  });
  it('los frames sin par (franja nueva) no cuentan en los ms del flujo', () => {
    const f = flow({ step: 50 });
    f.paired = f.paired.map((p, i) => p && i % 2 === 0); // la mitad sin par
    const s = summarizeFlow(f, { warmupMs: 0, cameraFps: 20 });
    expect(s.flowFps).toBeCloseTo(10, 0);
    expect(s.pairs).toBeLessThan(s.results);
  });
  it('summarizeRun incluye el flujo solo si la pasada lo lleva', () => {
    expect(summarizeRun(raw({}), { warmupMs: 3000 }).flow).toBeNull();
    const r = { ...raw({ camFps: 60 }), flow: flow({}) };
    const s = summarizeRun(r, { warmupMs: 3000 });
    expect(s.flow.flowFps).toBeCloseTo(60, 0);
    expect(s.flow.flowFraction).toBeCloseTo(1, 1);
  });
  it('con un flujo vacío no revienta', () => {
    const s = summarizeFlow(flowRaw(), { warmupMs: 3000 });
    expect(s.flowFps).toBeNull();
    expect(s.flowMs.n).toBe(0);
  });
});

suite('informe', () => {
  // Análisis de la cara: 25/s sin flujo; cada configuración con flujo lo frena según su coste.
  const COST = { none: 0, 'farneback-320': 1, 'farneback-640': 3, 'farneback-full': 5, 'lk-640': 2 };
  const mkRuns = () =>
    buildPlan().map((p) => {
      const step = 40 + 4 * COST[p.flow];
      const data = { ...raw({ step, camFps: 60 }), ...(p.method !== 'none' ? { flow: flow({ ms: 10 + 10 * COST[p.flow] }) } : {}) };
      return { ...p, status: 'completed', startedAtMs: p.index * 15000, durationMs: 12000, summary: summarizeRun(data, { warmupMs: 3000 }), series: { tRel: [1], inferMs: [30] } };
    });

  it('agrupa las dos rondas y calcula cuánto frena cada configuración al análisis de la cara', () => {
    const g = groupSummary(mkRuns());
    expect(g.groups).toHaveLength(COMBOS.length);
    expect(g.groups.every((x) => x.runs === 2)).toBe(true);
    const by = Object.fromEntries(g.groups.map((x) => [x.flow, x]));
    expect(by.none.flowFps).toBeNull();
    expect(by['farneback-640'].flowMsMean).toBeCloseTo(40, 5);
    expect(by['farneback-640'].size).toEqual({ width: 320, height: 110 });
    expect(by.none.analysisFps).toBeCloseTo(25, 0);
    expect(Object.keys(g.analysisFpsLoss)).not.toContain('none');
    expect(g.analysisFpsLoss['farneback-full']).toBeGreaterThan(g.analysisFpsLoss['farneback-320']);
    expect(g.analysisFpsLoss['farneback-320']).toBeGreaterThan(0);
  });

  it('buildBenchmarkReport: esquema, series opcionales y JSON válido', () => {
    const base = { runs: mkRuns(), startedAt: 'x', runMs: 12000, warmupMs: 3000, code: 'P01', build: {}, device: {}, capture: {}, analysis: {}, flow: { library: 'OpenCV.js' } };
    const full = buildBenchmarkReport(base);
    expect(full.schema).toBe(BENCH_SCHEMA);
    expect(BENCH_SCHEMA).toBe('orbicula-benchmark/2');
    expect(full.kind).toBe('benchmark');
    expect(full.flow.library).toBe('OpenCV.js');
    expect(full.plan.order).toEqual(buildPlan().map((p) => p.flow));
    expect(full.runs).toHaveLength(2 * COMBOS.length);
    expect(full.runs[1]).toMatchObject({ flow: COMBOS[1].key, method: COMBOS[1].method });
    expect(full.runs[0].series).toBeDefined();
    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
    expect(buildBenchmarkReport({ ...base, includeSeries: false }).runs[0].series).toBeUndefined();
  });
});
