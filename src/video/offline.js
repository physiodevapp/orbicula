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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Procesa el vídeo.
 * @param {{
 *   mp4: Awaited<ReturnType<import('./mp4.js').openMp4>>,
 *   analysis: {submit: Function, inflight: number},
 *   flow: {submit: Function, inflight: number} | null,
 *   video: ReturnType<typeof createVideoSession>,
 *   maxFps?: number,            // procesar como mucho a este ritmo (salta fotogramas si el vídeo va más rápido)
 *   signal?: AbortSignal,
 *   onProgress?: (p: {done:number, total:number, t:number, durationMs:number, elapsedMs:number, etaMs:number|null}) => void,
 * }} o
 */
export async function processVideo({ mp4, analysis, flow, video, maxFps = 0, signal, onProgress = () => {} }) {
  const fps = mp4.timing.fps || 30;
  const every = maxFps > 0 && fps > maxFps * 1.3 ? Math.round(fps / maxFps) : 1;
  const total = Math.ceil(mp4.samples.length / every);
  const rotation = mp4.track.rotation;
  let canvas = null;
  let index = 0;
  let done = 0;
  let lastT = 0;
  const t0 = performance.now();
  video.session.start();
  for await (const { frame, t } of decodeFrames(mp4, { signal })) {
    const take = index++ % every === 0;
    if (!take) {
      frame.close();
      continue;
    }
    let upright = frame;
    try {
      video.advance(t);
      if (rotation) {
        const r = rotateFrame(frame, rotation, canvas);
        canvas = r.canvas;
        upright = r.frame;
      }
      analysis.submit(upright, t);
      flow?.submit(upright, t);
      // Esperar a los dos resultados antes del siguiente fotograma.
      while (analysis.inflight > 0 || (flow && flow.inflight > 0)) {
        if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
        await sleep(1);
      }
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
  video.finish(lastT + 1);
  return { frames: done, every, elapsedMs: Math.round(performance.now() - t0), framesPerSecond: Math.round((done / ((performance.now() - t0) / 1000)) * 10) / 10 };
}
