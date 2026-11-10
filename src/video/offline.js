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
      // Dos ticks: de la revisión pasa al siguiente tramo y de su «cuenta atrás» (0 ms) a grabar.
      session.tick();
      session.tick();
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
export function protocolWindows(results, recStartCam) {
  return results
    .filter((r) => r.status === 'completed' && r.t0 != null)
    .map((r) => ({ id: r.id, runStart: r.t0 - recStartCam, runEnd: r.t0 - recStartCam + r.plannedMs }));
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
 *   signal?: AbortSignal,
 *   onProgress?: (p: {done:number, total:number, t:number, durationMs:number, elapsedMs:number, etaMs:number|null}) => void,
 * }} o
 */
export async function processVideo({ mp4, analysis, flow, video, maxFps = 0, every: fixedEvery = 0, pipeline = 2, fromMs = 0, toMs = Infinity, signal, onProgress = () => {} }) {
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
  const full = () => analysis.inflight >= depth || (flow && flow.inflight >= depth);
  video.session.start();
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
      video.advance(t);
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
  video.finish(lastT + 1);
  const wall = performance.now() - t0;
  const per = (ms) => (done ? Math.round((ms / done) * 100) / 100 : null);
  return {
    frames: done, every, pipeline: depth, elapsedMs: Math.round(wall), framesPerSecond: Math.round((done / (wall / 1000)) * 10) / 10,
    msPerFrame: per(wall), decodeWaitMsPerFrame: per(spent.decodeWait), prepareMsPerFrame: per(spent.prepare), workerWaitMsPerFrame: per(spent.workerWait),
    analysisMs: Math.round((analysis.ms ?? 0) * 10) / 10, flowMs: Math.round((flow?.ms ?? 0) * 10) / 10,
  };
}
