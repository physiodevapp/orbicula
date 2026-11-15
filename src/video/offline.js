// Procesado de un vídeo grabado fotograma a fotograma (fase 6b, opción A: análisis libre).
//
// Cada fotograma (decodificado y girado) pasa por el análisis de la cara (modo IMAGE) y por el flujo,
// y no se pide el siguiente hasta tener los dos resultados: así se analizan TODOS los fotogramas, sin
// prisa. El registro usa el mismo motor que el protocolo (GuidedSession) con el tiempo del VÍDEO como
// reloj, en dos tramos: el reposo de calibración (los primeros `restSec` segundos) y el resto del vídeo.
// La calibración, los eventos, el resumen y el JSON salen igual que en directo.
import { GuidedSession } from '../assistant/session.js';
import { decodeFrames, rotateFrame } from './decode.js';

/** Tramos del análisis libre de un vídeo de `durationMs`. */
export function videoSteps(durationMs, restSec = 30) {
  const restMs = Math.min(restSec * 1000, Math.max(1000, durationMs - 1000));
  return [
    {
      id: 'rest',
      title: 'Reposo (calibración)',
      instruction: `Los primeros ${Math.round(restMs / 1000)} s del vídeo: la persona quieta, mirando al frente.`,
      durationMs: restMs,
      calibrates: true,
      calibrateOptions: { minValidFraction: 1 / 3 },
    },
    {
      id: 'free',
      title: 'Resto del vídeo',
      instruction: 'Todo lo que sigue al reposo.',
      durationMs: Math.max(1000, durationMs - restMs),
      countable: true,
    },
  ];
}

/**
 * Sesión de registro con el reloj del vídeo. `recorder` tiene la misma interfaz que las tarjetas del
 * asistente y del protocolo (record, recordFlow, recordDetection, interrupt), para que la app le pase
 * las medidas igual que en directo.
 */
export function createVideoSession(steps, { onStepEnd = () => {}, onStepStart = () => {} } = {}) {
  let clock = 0;
  const session = new GuidedSession(steps, { now: () => clock, prepMs: 0, onStepEnd, onStepStart });
  session.autoAdvanceMs = 0; // sin pausa entre tramos
  return {
    session,
    recorder: {
      record: (t, sample, events) => session.record(t, sample, events),
      recordFlow: (s) => session.recordFlow(s),
      recordDetection: (e) => session.recordDetection(e),
      interrupt: (reason) => session.interrupt(reason),
    },
    /** Avanza el reloj al tiempo de un fotograma y deja que la sesión cambie de tramo. */
    advance(t) {
      clock = t;
      // Hasta que la sesión quede estable: al cruzar una frontera hacen falta tres pasos (terminar el tramo, pasar
      // al siguiente y, tras su «cuenta atrás» de 0 ms, empezar a grabar). Con solo dos, el fotograma de la
      // frontera llegaba con la sesión aún en la cuenta atrás y se perdía.
      for (let i = 0; i < 6; i++) {
        const before = `${session.state}:${session.index}`;
        session.tick();
        if (`${session.state}:${session.index}` === before) break;
      }
    },
    /** Cierra el último tramo al acabar el vídeo. */
    finish(t) {
      clock = t;
      if (session.state === 'running') session.finishStep();
      if (session.state === 'review') session.next();
    },
  };
}

/**
 * Ventanas de los pasos de un protocolo ya hecho en directo, en el tiempo del vídeo grabado (ms).
 * @param {object[]} results pasos guardados por la sesión en directo (con `t0`, marca de la cámara de la
 *   primera muestra, y el paso con su duración)
 * @param {number} recStartCam instante (reloj de la cámara) en que arrancó la grabación
 * @returns {{id:string, runStart:number, runEnd:number}[]}
 */
export function protocolWindows(results, recStartCam, map = (ms) => ms) {
  return results
    .filter((r) => r.status === 'completed' && r.t0 != null)
    .map((r) => ({ id: r.id, runStart: map(r.t0 - recStartCam), runEnd: map(r.t0 - recStartCam + r.plannedMs) }));
}

/**
 * Reloj del vídeo grabado frente al de la sesión. Las marcas del protocolo se colocaban en el vídeo suponiendo
 * que su reloj avanza igual que el de la sesión, pero el MP4 de MediaRecorder en Android se va quedando atrás: en
 * el protocolo del 2026-11-10, 1,0 s al llegar a la sonrisa (~0,5 %, a tirones), medido correlando el EAR del
 * directo con el del vídeo. Las marcas caían tarde y, por ejemplo, la subida de la ceja empezaba antes de la
 * ventana de la repetición (docs/plan-fase-6.md, «Deriva del reloj del vídeo grabado»).
 *
 * Con cada trozo que entrega MediaRecorder se anota cuándo llegó y cuántos bytes iban: el último fotograma
 * entero de esos bytes dice hasta qué tiempo del vídeo se había grabado en ese instante de la sesión. La
 * diferencia (sesión − vídeo), suavizada con una mediana de 5 trozos, es la deriva; se corrige solo lo que
 * crece desde el principio (el desfase inicial se deja como estaba, que es lo que se ha medido bien).
 * @param {{at:number, bytes:number}[]} timeline llegada de cada trozo (performance.now) y bytes acumulados
 * @param {{byte?:number, size:number, t:number, durationMs:number}[]} samples muestras del MP4
 * @param {number} recStart performance.now() al arrancar la grabación
 * @returns {{map:(ms:number)=>number, method:'chunks'|'identity', reason?:string, points?:number, driftMs?:number}}
 */
export function mediaClock(timeline, samples, recStart) {
  const identity = (reason) => ({ map: (ms) => ms, method: 'identity', reason });
  if (!Array.isArray(timeline) || timeline.length < 3 || !Number.isFinite(recStart)) return identity('sin tiempos de los trozos');
  const byByte = samples.filter((s) => Number.isFinite(s.byte)).map((s) => ({ end: s.byte + s.size, m: s.t + s.durationMs })).sort((a, b) => a.end - b.end);
  if (byByte.length < 3) return identity('las muestras no dicen su posición en el archivo');
  // Tiempo del vídeo alcanzado con los bytes de cada trozo (el último fotograma entero, el mayor tiempo visto).
  const pts = [];
  let j = -1;
  let reached = -Infinity;
  for (const c of timeline) {
    while (j + 1 < byByte.length && byByte[j + 1].end <= c.bytes) reached = Math.max(reached, byByte[++j].m);
    if (Number.isFinite(reached)) pts.push({ w: c.at - recStart, d: c.at - recStart - reached });
  }
  if (pts.length < 3) return identity('pocos trozos con fotogramas');
  // Mediana móvil de 5 de la diferencia.
  const sm = pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - 2), i + 3).map((q) => q.d).sort((a, b) => a - b);
    return { w: p.w, d: win[Math.floor(win.length / 2)] };
  });
  const d0 = sm[0].d;
  const span = sm.at(-1).w - sm[0].w;
  const driftMs = sm.at(-1).d - d0;
  // Más de un 5 % no es una deriva de reloj: algo no cuadra con los trozos, mejor no tocar nada.
  if (!(span > 0) || Math.abs(driftMs) > 0.05 * span) return identity(`deriva fuera de rango (${Math.round(driftMs)} ms en ${Math.round(span)} ms)`);
  const driftAt = (w) => {
    if (w <= sm[0].w) return 0;
    if (w >= sm.at(-1).w) return driftMs;
    let i = 1;
    while (sm[i].w < w) i++;
    const a = sm[i - 1];
    const b = sm[i];
    return a.d + ((b.d - a.d) * (w - a.w)) / (b.w - a.w || 1) - d0;
  };
  return { map: (ms) => ms - driftAt(ms), method: 'chunks', points: pts.length, driftMs: Math.round(driftMs) };
}

/**
 * Desfase que queda entre el directo y el vídeo en un paso, correlando su EAR (izquierdo + derecho) en una
 * rejilla de 10 ms, hasta ±maxLagMs. lagMs > 0: lo que pasa en el directo aparece en el vídeo más tarde de lo
 * que lo coloca la ventana del paso (lo ideal, ~0); null si la correlación es menor que minR. Para comprobar
 * la corrección de mediaClock en cada análisis.
 * @returns {{lagMs:number, r:number} | null}
 */
export function alignmentLag(live, video, { maxLagMs = 1500, stepMs = 10, minR = 0.5 } = {}) {
  const grid = (s) => {
    const t = s?.series?.t ?? s?.rel ?? [];
    if (t.length < 10) return null;
    const v = t.map((_, i) => {
      const l = s.series?.left?.ear?.[i];
      const r = s.series?.right?.ear?.[i];
      return Number.isFinite(l) && Number.isFinite(r) ? (l + r) / 2 : NaN;
    });
    const out = [];
    let k = 0;
    for (let x = 0; x <= t.at(-1); x += stepMs) {
      while (k + 1 < t.length && t[k + 1] <= x) k++;
      const a = v[k];
      const b = v[Math.min(k + 1, t.length - 1)];
      const ta = t[k];
      const tb = t[Math.min(k + 1, t.length - 1)];
      out.push(Number.isFinite(a) && Number.isFinite(b) && tb > ta ? a + ((b - a) * (x - ta)) / (tb - ta) : Number.isFinite(a) ? a : NaN);
    }
    return out;
  };
  const a = grid(live);
  const b = grid(video);
  if (!a || !b) return null;
  const n = Math.min(a.length, b.length);
  const maxLag = Math.round(maxLagMs / stepMs);
  let best = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    // Vídeo en x frente al directo en x − lag: si el vídeo va «tarde», casa con lag > 0.
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
    for (let x = Math.max(0, lag); x < Math.min(n, n + lag); x++) {
      const p = a[x - lag];
      const q = b[x];
      if (!Number.isFinite(p) || !Number.isFinite(q)) continue;
      sx += p; sy += q; sxx += p * p; syy += q * q; sxy += p * q; m++;
    }
    if (m < 50) continue;
    const cov = sxy - (sx * sy) / m;
    const den = Math.sqrt((sxx - (sx * sx) / m) * (syy - (sy * sy) / m));
    const r = den > 0 ? cov / den : NaN;
    if (Number.isFinite(r) && (!best || r > best.r)) best = { lagMs: lag * stepMs, r: Math.round(r * 1000) / 1000 };
  }
  // Con poca correlación (p. ej., una fase sin parpadeos ni cierres) el desfase no dice nada: se da solo r.
  if (best && best.r < minR) best.lagMs = null;
  return best;
}

/**
 * Pasos del protocolo con los tiempos reales de cada uno en el vídeo: el reloj del vídeo arranca en 0, el
 * primer paso empieza en su `runStart` (cuenta atrás = ese tiempo) y la pausa tras cada paso lleva hasta
 * el `runStart` del siguiente. Así los marcas de las repeticiones y las fases caen donde cayeron en directo.
 * El reposo no repite si no vale (el vídeo ya está grabado): la calibración avisa.
 */
export function windowedSteps(steps, windows) {
  const byId = new Map(windows.map((w) => [w.id, w]));
  const used = steps.filter((s) => byId.has(s.id));
  return used.map((s, i) => {
    const w = byId.get(s.id);
    const next = byId.get(used[i + 1]?.id);
    return {
      ...s,
      requireValid: false,
      prepMs: i === 0 ? Math.max(0, w.runStart) : 0,
      durationMs: w.runEnd - w.runStart,
      ...(next ? { pauseAfterMs: Math.max(0, next.runStart - w.runEnd) } : {}),
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Procesa el vídeo.
 * @param {{
 *   mp4: Awaited<ReturnType<import('./mp4.js').openMp4>>,
 *   analysis: {submit: Function, inflight: number},
 *   flow: {submit: Function, inflight: number} | null,
 *   video: ReturnType<typeof createVideoSession>,
 *   maxFps?: number,            // procesar como mucho a este ritmo (salta fotogramas si el vídeo va más rápido)
 *   every?: number,             // o procesar uno de cada N fotogramas (manda sobre maxFps)
 *   pipeline?: number,          // fotogramas en vuelo a la vez (1 = de uno en uno; 2 = se solapan el análisis y la preparación del siguiente)
 *   fromMs?: number, toMs?: number, // solo los fotogramas de este tramo del vídeo
 *   beforeFinish?: () => void,   // al acabar, antes de cerrar el último tramo (vaciar lo que espera, p. ej. el flujo)
 *   signal?: AbortSignal,
 *   onProgress?: (p: {done:number, total:number, t:number, durationMs:number, elapsedMs:number, etaMs:number|null}) => void,
 * }} o
 */
export async function processVideo({ mp4, analysis, flow, video, maxFps = 0, every: fixedEvery = 0, pipeline = 2, fromMs = 0, toMs = Infinity, signal, onProgress = () => {}, beforeFinish = () => {} }) {
  const fps = mp4.timing.fps || 30;
  // `every` (uno de cada N) manda sobre `maxFps`: con ~34 fps reales, «como mucho 30» no salta ninguno.
  const every = fixedEvery > 1 ? fixedEvery : maxFps > 0 && fps > maxFps * 1.3 ? Math.round(fps / maxFps) : 1;
  const inRange = mp4.samples.filter((s) => s.t >= fromMs && s.t <= toMs).length;
  const total = Math.ceil(inRange / every);
  const rotation = mp4.track.rotation;
  let canvas = null;
  let index = 0;
  let done = 0;
  let lastT = 0;
  const t0 = performance.now();
  // Dónde se va el tiempo (ms en total): esperar al decodificador, preparar y mandar el fotograma, y
  // esperar a que los workers tengan hueco. Se guarda en el JSON para saber qué optimizar.
  const spent = { decodeWait: 0, prepare: 0, workerWait: 0 };
  const depth = Math.max(1, Math.min(2, pipeline)); // los dos clientes admiten 2 en vuelo
  // Con varios análisis de la cara en paralelo (AnalysisPool), cada uno puede tener los suyos en vuelo; el
  // flujo sigue siendo uno solo.
  const lanes = analysis.lanes ?? 1;
  const full = () => analysis.inflight >= depth * lanes || (flow && flow.inflight >= depth);
  // El reloj de la sesión avanza con los RESULTADOS de la cara (que llegan en orden), no con los envíos. Con
  // varios fotogramas en vuelo, los resultados llegan algo después; si el reloj avanzara al enviar, los últimos
  // de un paso se guardarían en el siguiente (se vio con dos análisis: 2 muestras del reposo en el tramo libre).
  // Las muestras del flujo salen cuando hay resultados de la cara alrededor, así que siguen al mismo reloj.
  const deliver = analysis.onResult;
  analysis.onResult = (m) => {
    if (Number.isFinite(m?.t)) video.advance(m.t);
    deliver?.(m);
  };
  video.session.start();
  try {
    const it = decodeFrames(mp4, { signal, toMs })[Symbol.asyncIterator]();
    while (true) {
      const w0 = performance.now();
      const next = await it.next();
      spent.decodeWait += performance.now() - w0;
      if (next.done) break;
      const { frame, t } = next.value;
      // Antes de `fromMs` se decodifica (hace falta para llegar al fotograma clave) pero no se analiza.
      const take = t >= fromMs && index++ % every === 0;
      if (!take) {
        frame.close();
        continue;
      }
      let upright = frame;
      try {
        // Esperar a que los workers tengan hueco (con pipeline 1, a que terminen el anterior).
        const q0 = performance.now();
        while (full()) {
          if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
          await sleep(1);
        }
        spent.workerWait += performance.now() - q0;
        const p0 = performance.now();
        if (rotation) {
          const r = rotateFrame(frame, rotation, canvas);
          canvas = r.canvas;
          upright = r.frame;
        }
        analysis.submit(upright, t);
        flow?.submit(upright, t);
        spent.prepare += performance.now() - p0;
      } finally {
        if (upright !== frame) upright.close();
        frame.close();
      }
      done++;
      lastT = t;
      if (done % 5 === 0 || done === total) {
        const elapsedMs = performance.now() - t0;
        onProgress({ done, total, t, durationMs: mp4.timing.durationMs, elapsedMs, etaMs: done > 10 ? (elapsedMs / done) * (total - done) : null });
      }
    }
    // Esperar a los últimos resultados antes de cerrar el último tramo.
    while (analysis.inflight > 0 || (flow && flow.inflight > 0)) {
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      await sleep(1);
    }
    // Los últimos pares de flujo esperan la pose de la cara de después, que ya no llegará: se registran ahora, en
    // el último tramo (antes se perdían).
    beforeFinish();
    video.finish(lastT + 1);
  } finally {
    analysis.onResult = deliver;
  }
  const wall = performance.now() - t0;
  const per = (ms) => (done ? Math.round((ms / done) * 100) / 100 : null);
  return {
    frames: done, every, pipeline: depth, elapsedMs: Math.round(wall), framesPerSecond: Math.round((done / (wall / 1000)) * 10) / 10,
    msPerFrame: per(wall), decodeWaitMsPerFrame: per(spent.decodeWait), prepareMsPerFrame: per(spent.prepare), workerWaitMsPerFrame: per(spent.workerWait),
    analysisMs: Math.round((analysis.ms ?? 0) * 10) / 10, flowMs: Math.round((flow?.ms ?? 0) * 10) / 10,
    // Análisis de la cara: cuántos a la vez y, de cada uno, el acelerador, su tiempo y cuántos fotogramas hizo.
    face: analysis.describe?.() ?? { lanes: 1, workers: [{ delegate: analysis.delegate ?? null, ms: Math.round((analysis.ms ?? 0) * 10) / 10, frames: done }] },
  };
}
