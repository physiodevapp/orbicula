// Prueba de rendimiento del análisis: plan de pasadas, estadísticas y informe. Sin DOM.
// Compara el análisis en worker y en el hilo principal, con y sin blendshapes.
//
// Diseño: cada combinación se mide dos veces, la segunda ronda en orden inverso (ABBA), para que
// el calentamiento del móvil o un cambio de luz no favorezcan siempre a la misma combinación.

export const BENCH_SCHEMA = 'orbicula-benchmark/1';

export const COMBOS = [
  { mode: 'worker', blendshapes: true },
  { mode: 'worker', blendshapes: false },
  { mode: 'main', blendshapes: false },
  { mode: 'main', blendshapes: true },
];

/** Lista de pasadas: ronda 1 en un orden y la ronda 2 en el inverso. Solo hay dos cambios de modo. */
export function buildPlan({ rounds = 2 } = {}) {
  const runs = [];
  for (let r = 0; r < rounds; r++) {
    for (const c of r % 2 ? [...COMBOS].reverse() : COMBOS) runs.push({ index: runs.length + 1, round: r + 1, ...c });
  }
  return runs;
}

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/** n, media, desviación, mínimo, mediana, p90, p99 y máximo, sin contar null ni NaN. */
export function describe(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, sd: null, min: null, p50: null, p90: null, p99: null, max: null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const q = (p) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
  };
  return { n: v.length, mean: r2(mean), sd: r2(sd), min: r2(v[0]), p50: r2(q(0.5)), p90: r2(q(0.9)), p99: r2(q(0.99)), max: r2(v[v.length - 1]) };
}

const rate = (times) => (times.length > 1 && times.at(-1) > times[0] ? ((times.length - 1) * 1000) / (times.at(-1) - times[0]) : null);

/**
 * Resume una pasada sin contar el calentamiento (los primeros `warmupMs`).
 * @param {{tRel:number[], inferMs:number[], latencyMs:number[], bitmapMs:(number|null)[], roundTripMs:(number|null)[],
 *          faces:boolean[], camT:number[], camPresented:(number|null)[], rafMs:{t:number,d:number}[],
 *          longTasks:{t:number,d:number}[]}} raw
 */
export function summarizeRun(raw, { warmupMs }) {
  const keep = raw.tRel.map((t, i) => i).filter((i) => raw.tRel[i] >= warmupMs);
  const pick = (arr) => keep.map((i) => arr[i]);
  const t = pick(raw.tRel);
  const intervals = t.slice(1).map((x, i) => x - t[i]);

  const camIdx = raw.camT.map((x, i) => i).filter((i) => raw.camT[i] >= warmupMs);
  const camT = camIdx.map((i) => raw.camT[i]);
  const pres = camIdx.map((i) => raw.camPresented[i]).filter((p) => p != null);
  const presentedFps = pres.length > 1 && camT.at(-1) > camT[0] ? ((pres.at(-1) - pres[0]) * 1000) / (camT.at(-1) - camT[0]) : null;

  const raf = raw.rafMs.filter((x) => x.t >= warmupMs).map((x) => x.d);
  const tasks = raw.longTasks.filter((x) => x.t >= warmupMs);
  const analysisFps = rate(t);

  return {
    results: keep.length,
    faceFraction: keep.length ? r2(pick(raw.faces).filter(Boolean).length / keep.length) : null,
    analysisFps: r2(analysisFps),
    cameraFps: r2(presentedFps ?? rate(camT)),
    // Fracción de los frames de la cámara que se llegan a analizar.
    analysedFraction: presentedFps && analysisFps ? r2(analysisFps / presentedFps) : null,
    inferMs: describe(pick(raw.inferMs)), // lo que tarda MediaPipe en cada frame
    intervalMs: describe(intervals), // tiempo entre resultados
    latencyMs: describe(pick(raw.latencyMs)), // de la captura del frame a tener el resultado
    bitmapMs: describe(pick(raw.bitmapMs)), // worker: copia del frame en el hilo principal
    roundTripMs: describe(pick(raw.roundTripMs)), // worker: ida y vuelta completa
    ui: {
      // Fluidez del hilo principal: intervalo entre repintados de pantalla (16,7 ms = 60 Hz).
      frameMs: describe(raf),
      over50ms: raf.filter((d) => d > 50).length,
      over100ms: raf.filter((d) => d > 100).length,
      longTasks: { n: tasks.length, totalMs: r2(tasks.reduce((a, b) => a + b.d, 0)), maxMs: r2(Math.max(0, ...tasks.map((x) => x.d))) },
    },
  };
}

const avg = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/** Una fila por combinación, promediando sus pasadas, y las diferencias que importan. */
export function groupSummary(runs) {
  const groups = COMBOS.map((c) => {
    const rs = runs.filter((r) => r.mode === c.mode && r.blendshapes === c.blendshapes && r.summary);
    return {
      mode: c.mode,
      blendshapes: c.blendshapes,
      runs: rs.length,
      inferMsMean: avg(rs.map((r) => r.summary.inferMs.mean)),
      inferMsP90: avg(rs.map((r) => r.summary.inferMs.p90)),
      analysisFps: avg(rs.map((r) => r.summary.analysisFps)),
      cameraFps: avg(rs.map((r) => r.summary.cameraFps)),
      latencyMsMean: avg(rs.map((r) => r.summary.latencyMs.mean)),
      frameMsP99: avg(rs.map((r) => r.summary.ui.frameMs.p99)),
      longTaskMs: avg(rs.map((r) => r.summary.ui.longTasks.totalMs)),
      over50ms: avg(rs.map((r) => r.summary.ui.over50ms)),
      bitmapMsMean: avg(rs.map((r) => r.summary.bitmapMs.mean)),
    };
  });
  const g = (mode, blendshapes) => groups.find((x) => x.mode === mode && x.blendshapes === blendshapes);
  const diff = (a, b, key) => (a?.[key] != null && b?.[key] != null ? r2(a[key] - b[key]) : null);
  return {
    groups,
    // Diferencia de ms por análisis (positivo = la primera opción es más lenta).
    effects: {
      workerMinusMain_withBlendshapes: diff(g('worker', true), g('main', true), 'inferMsMean'),
      workerMinusMain_withoutBlendshapes: diff(g('worker', false), g('main', false), 'inferMsMean'),
      blendshapesOnMinusOff_worker: diff(g('worker', true), g('worker', false), 'inferMsMean'),
      blendshapesOnMinusOff_main: diff(g('main', true), g('main', false), 'inferMsMean'),
    },
  };
}

export function buildBenchmarkReport({ runs, startedAt, runMs, warmupMs, code = null, build, device, capture, analysis, includeSeries = true }) {
  return {
    app: 'orbicula',
    kind: 'benchmark',
    schema: BENCH_SCHEMA,
    createdAt: new Date().toISOString(),
    startedAt,
    note: 'Prueba de rendimiento del análisis. Solo tiempos y recuentos: sin imágenes ni identificación.',
    participantCode: code || null,
    build,
    device,
    capture,
    analysis,
    plan: { runMs, warmupMs, order: runs.map((r) => `${r.mode}${r.blendshapes ? '+blend' : '-blend'}`) },
    summary: groupSummary(runs),
    runs: runs.map((r) => ({
      index: r.index,
      round: r.round,
      mode: r.mode,
      blendshapes: r.blendshapes,
      status: r.status,
      startedAtMs: r.startedAtMs,
      durationMs: r.durationMs,
      summary: r.summary,
      ...(includeSeries && r.series ? { series: r.series } : {}),
    })),
  };
}
