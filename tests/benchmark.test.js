import { describe as suite, it, expect } from 'vitest';
import { buildPlan, describe, summarizeRun, groupSummary, buildBenchmarkReport, COMBOS, BENCH_SCHEMA } from '../src/assistant/benchmark.js';

suite('plan de pasadas', () => {
  it('cada combinación dos veces, la segunda ronda en orden inverso, con solo dos cambios de modo', () => {
    const plan = buildPlan();
    expect(plan).toHaveLength(8);
    expect(plan.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const key = (p) => `${p.mode}${p.blendshapes ? '+' : '-'}`;
    expect(plan.slice(0, 4).map(key)).toEqual(['worker+', 'worker-', 'main-', 'main+']);
    expect(plan.slice(4).map(key)).toEqual(['main+', 'main-', 'worker-', 'worker+']);
    for (const c of COMBOS) expect(plan.filter((p) => p.mode === c.mode && p.blendshapes === c.blendshapes)).toHaveLength(2);
    const switches = plan.slice(1).filter((p, i) => p.mode !== plan[i].mode).length;
    expect(switches).toBe(2);
    expect(plan.filter((p) => p.round === 1)).toHaveLength(4);
  });
  it('se pueden pedir más rondas', () => {
    expect(buildPlan({ rounds: 4 })).toHaveLength(16);
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

suite('informe', () => {
  const mkRuns = () =>
    buildPlan().map((p) => {
      const ms = (p.mode === 'worker' ? 40 : 32) + (p.blendshapes ? 8 : 0); // worker +8 ms, blendshapes +8 ms
      return { ...p, status: 'completed', startedAtMs: p.index * 15000, durationMs: 12000, summary: summarizeRun(raw({ ms }), { warmupMs: 3000 }), series: { tRel: [1], inferMs: [ms] } };
    });

  it('agrupa las dos rondas y calcula las diferencias entre combinaciones', () => {
    const g = groupSummary(mkRuns());
    expect(g.groups).toHaveLength(4);
    expect(g.groups.every((x) => x.runs === 2)).toBe(true);
    expect(g.effects.workerMinusMain_withBlendshapes).toBeCloseTo(8, 1);
    expect(g.effects.workerMinusMain_withoutBlendshapes).toBeCloseTo(8, 1);
    expect(g.effects.blendshapesOnMinusOff_worker).toBeCloseTo(8, 1);
    expect(g.effects.blendshapesOnMinusOff_main).toBeCloseTo(8, 1);
  });

  it('buildBenchmarkReport: esquema, series opcionales y JSON válido', () => {
    const base = { runs: mkRuns(), startedAt: 'x', runMs: 12000, warmupMs: 3000, code: 'P01', build: {}, device: {}, capture: {}, analysis: {} };
    const full = buildBenchmarkReport(base);
    expect(full.schema).toBe(BENCH_SCHEMA);
    expect(full.kind).toBe('benchmark');
    expect(full.plan.order).toEqual(['worker+blend', 'worker-blend', 'main-blend', 'main+blend', 'main+blend', 'main-blend', 'worker-blend', 'worker+blend']);
    expect(full.runs).toHaveLength(8);
    expect(full.runs[0].series).toBeDefined();
    expect(JSON.parse(JSON.stringify(full))).toEqual(full);
    expect(buildBenchmarkReport({ ...base, includeSeries: false }).runs[0].series).toBeUndefined();
  });
});
