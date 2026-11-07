// Prueba de rendimiento del flujo óptico (paso 4a): plan de pasadas, estadísticas e informe. Sin DOM.
// Con el análisis de la cara en su punto de trabajo (worker, con blendshapes), compara varias
// configuraciones del flujo óptico, que corre a la vez en su propio worker, y una pasada sin flujo
// para ver cuánto frena al análisis de la cara.
//
// Diseño: cada configuración se mide dos veces, la segunda ronda en orden inverso (ABBA), para que
// el calentamiento del móvil o un cambio de luz no favorezcan siempre a la misma.
// La versión 1 del esquema (fase 3) comparaba worker / hilo principal y blendshapes: ver docs/rendimiento.md.
import { FLOW_CONFIGS } from '../flow/config.js';

export const BENCH_SCHEMA = 'orbicula-benchmark/2';

export const COMBOS = ['none', 'farneback-320', 'farneback-640', 'farneback-full', 'lk-640'].map((k) => FLOW_CONFIGS[k]);

/** Lista de pasadas: ronda 1 en un orden y la ronda 2 en el inverso. */
export function buildPlan({ rounds = 2 } = {}) {
  const runs = [];
  for (let r = 0; r < rounds; r++) {
    for (const c of r % 2 ? [...COMBOS].reverse() : COMBOS) {
      runs.push({ index: runs.length + 1, round: r + 1, flow: c.key, method: c.method, maxWidth: c.maxWidth });
    }
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
 *          longTasks:{t:number,d:number}[], flow?: object}} raw
 *   `flow` (si la pasada lleva flujo): ver flowRaw() y summarizeFlow().
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
  // Los callbacks de vídeo y `presentedFrames` se quedan cortos en situaciones distintas: se toma el mayor.
  const cameraFps = Math.max(rate(camT) ?? 0, presentedFps ?? 0) || null;

  return {
    flow: raw.flow ? summarizeFlow(raw.flow, { warmupMs, cameraFps }) : null,
    results: keep.length,
    faceFraction: keep.length ? r2(pick(raw.faces).filter(Boolean).length / keep.length) : null,
    analysisFps: r2(analysisFps),
    // fps de la cámara: el mayor de los dos recuentos de abajo (ambos se quedan cortos, ninguno se pasa).
    cameraFps: r2(cameraFps),
    callbackFps: r2(rate(camT)), // callbacks de vídeo: se pierden con el hilo principal ocupado
    presentedFps: r2(presentedFps), // contador `presentedFrames` del navegador
    // Fracción de los frames de la cámara que se llegan a analizar.
    analysedFraction: cameraFps && analysisFps ? r2(analysisFps / cameraFps) : null,
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

/** Series vacías del flujo de una pasada. */
export function flowRaw() {
  return { t: [], paired: [], flowMs: [], readMs: [], prepMs: [], totalMs: [], cropMs: [], latencyMs: [], roundTripMs: [], dt: [], size: null, strip: null, counts: null };
}

/**
 * Flujo de una pasada, sin el calentamiento.
 * - flowFps: pares de frames con flujo por segundo; flowFraction: qué fracción de los frames de la cámara.
 * - flowMs: lo que tarda el algoritmo; readMs: pasar la franja a la CPU; prepMs: gris y brillo;
 *   totalMs: todo el trabajo del worker por frame; cropMs: recorte en el hilo principal.
 * - latencyMs: de la captura del frame a tener el flujo; dtMs: tiempo entre los dos frames de cada par.
 * - counts: frames mandados, descartados por estar ocupado el worker, sin franja, y recolocaciones de la franja.
 */
export function summarizeFlow(f, { warmupMs, cameraFps = null }) {
  const keep = f.t.map((t, i) => i).filter((i) => f.t[i] >= warmupMs);
  const pick = (arr) => keep.map((i) => arr[i]);
  const pairedIdx = keep.filter((i) => f.paired[i]);
  const pickPaired = (arr) => pairedIdx.map((i) => arr[i]);
  const flowFps = rate(pairedIdx.map((i) => f.t[i]));
  const c = f.counts ?? {};
  return {
    results: keep.length,
    pairs: pairedIdx.length,
    flowFps: r2(flowFps),
    flowFraction: flowFps && cameraFps ? r2(flowFps / cameraFps) : null,
    flowMs: describe(pickPaired(f.flowMs)),
    readMs: describe(pick(f.readMs)),
    prepMs: describe(pick(f.prepMs)),
    totalMs: describe(pick(f.totalMs)),
    cropMs: describe(pick(f.cropMs)),
    latencyMs: describe(pickPaired(f.latencyMs)),
    roundTripMs: describe(pick(f.roundTripMs)),
    dtMs: describe(pickPaired(f.dt)),
    size: f.size, // tamaño de trabajo de la franja (px)
    strip: f.strip, // franja en el frame completo (px)
    counts: { submitted: c.submitted ?? null, busy: c.busy ?? null, noStrip: c.noStrip ?? null, replaced: c.replaced ?? null },
  };
}

const avg = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/** Una fila por configuración, promediando sus pasadas, y cuánto frena cada una al análisis de la cara. */
export function groupSummary(runs) {
  const groups = COMBOS.map((c) => {
    const rs = runs.filter((r) => r.flow === c.key && r.summary);
    const fl = rs.map((r) => r.summary.flow).filter(Boolean);
    return {
      flow: c.key,
      method: c.method,
      maxWidth: c.maxWidth,
      runs: rs.length,
      // Flujo
      flowFps: avg(fl.map((x) => x.flowFps)),
      flowFraction: avg(fl.map((x) => x.flowFraction)),
      flowMsMean: avg(fl.map((x) => x.flowMs.mean)),
      flowMsP90: avg(fl.map((x) => x.flowMs.p90)),
      totalMsMean: avg(fl.map((x) => x.totalMs.mean)),
      readMsMean: avg(fl.map((x) => x.readMs.mean)),
      cropMsMean: avg(fl.map((x) => x.cropMs.mean)),
      flowLatencyMsMean: avg(fl.map((x) => x.latencyMs.mean)),
      size: fl.find((x) => x.size)?.size ?? null,
      // Análisis de la cara (MediaPipe) mientras tanto
      inferMsMean: avg(rs.map((r) => r.summary.inferMs.mean)),
      analysisFps: avg(rs.map((r) => r.summary.analysisFps)),
      cameraFps: avg(rs.map((r) => r.summary.cameraFps)),
      latencyMsMean: avg(rs.map((r) => r.summary.latencyMs.mean)),
      frameMsP99: avg(rs.map((r) => r.summary.ui.frameMs.p99)),
      over50ms: avg(rs.map((r) => r.summary.ui.over50ms)),
    };
  });
  const none = groups.find((g) => g.flow === 'none');
  const diff = (a, b, key) => (a?.[key] != null && b?.[key] != null ? r2(a[key] - b[key]) : null);
  return {
    groups,
    // Análisis de la cara por segundo que se pierden con cada configuración (positivo = frena).
    analysisFpsLoss: Object.fromEntries(groups.filter((g) => g.flow !== 'none').map((g) => [g.flow, diff(none, g, 'analysisFps')])),
  };
}

export function buildBenchmarkReport({ runs, startedAt, runMs, warmupMs, code = null, build, device, capture, analysis, flow = null, includeSeries = true }) {
  return {
    app: 'orbicula',
    kind: 'benchmark',
    schema: BENCH_SCHEMA,
    createdAt: new Date().toISOString(),
    startedAt,
    note: 'Prueba de rendimiento del flujo óptico. Solo tiempos y recuentos: sin imágenes ni identificación.',
    participantCode: code || null,
    build,
    device,
    capture,
    analysis,
    flow,
    plan: { runMs, warmupMs, order: runs.map((r) => r.flow) },
    summary: groupSummary(runs),
    runs: runs.map((r) => ({
      index: r.index,
      round: r.round,
      flow: r.flow,
      method: r.method,
      maxWidth: r.maxWidth,
      status: r.status,
      startedAtMs: r.startedAtMs,
      durationMs: r.durationMs,
      summary: r.summary,
      ...(includeSeries && r.series ? { series: r.series } : {}),
    })),
  };
}
