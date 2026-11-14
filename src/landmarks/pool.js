// Varios análisis de la cara a la vez, para el vídeo grabado (fase 6, propuesta tras la fase 7).
//
// Solo para el modo IMAGE: ahí cada fotograma se analiza por separado, así que dos análisis pueden repartirse
// los fotogramas. En directo (modo VIDEO) no: MediaPipe suaviza entre fotogramas y exige un solo análisis con
// marcas de tiempo crecientes.
//
// Tiene la misma interfaz que WorkerAnalysis (submit, onResult, inflight, ready, setImageMode…), así que
// processVideo y el resto de la app no cambian. Los resultados llegan desordenados (un análisis puede ir más
// rápido que otro) y se reordenan (in-order.js) antes de entregarlos.
import { InOrder } from './in-order.js';
import { FpsMeter } from '../capture/camera-logic.js';

export class AnalysisPool {
  /** @param {import('./worker-client.js').WorkerAnalysis[]} workers ya cargados */
  constructor(workers) {
    this.workers = workers;
    this.mode = 'pool';
    this.onResult = null;
    this.seq = 0;
    this.meter = new FpsMeter(1000);
    this.order = new InOrder((m) => {
      this.meter.push(performance.now());
      this.onResult?.(m);
    });
    this.sent = workers.map(() => 0); // fotogramas mandados a cada análisis (diagnóstico)
    for (const w of workers) {
      w.onResult = (m) => this.order.done(m.tag, m);
      w.onDrop = (tag) => this.order.done(tag, null);
    }
  }

  /** Cuántos análisis trabajan a la vez (processVideo deja tantos fotogramas en vuelo por cada uno). */
  get lanes() { return this.workers.length; }
  get ready() { return this.workers.every((w) => w.ready); }
  get delegate() { return this.workers.map((w) => w.delegate ?? '?').join(' + '); }
  get inflight() { return this.workers.reduce((n, w) => n + w.inflight, 0); }
  get capacity() { return this.workers.reduce((n, w) => n + (w.capacity ?? 2), 0); }
  /** Tiempo medio de un análisis (no el ritmo: para eso, `fps`). */
  get ms() { return this.workers.reduce((n, w) => n + (w.ms ?? 0), 0) / this.workers.length; }
  get fps() { return this.meter.fps; }
  get analysisSize() { return this.workers[0]?.analysisSize ?? null; }
  get blockedHosts() { return new Set(this.workers.flatMap((w) => [...(w.blockedHosts ?? [])])); }
  get frameMirrored() { return this.workers[0]?.frameMirrored ?? false; }
  set frameMirrored(v) { for (const w of this.workers) w.frameMirrored = v; }
  get swapNames() { return this.workers[0]?.swapNames ?? false; }
  set swapNames(v) { for (const w of this.workers) w.swapNames = v; }

  /** Manda el fotograma al análisis menos ocupado. Devuelve si lo aceptó alguno. */
  submit(frame, t) {
    let best = -1;
    this.workers.forEach((w, i) => {
      if (!w.ready || w.inflight >= (w.capacity ?? 2)) return;
      if (best < 0 || w.inflight < this.workers[best].inflight) best = i;
    });
    if (best < 0) return false;
    const tag = this.seq + 1;
    if (!this.workers[best].submit(frame, t, tag)) return false;
    this.seq = tag;
    this.sent[best]++;
    return true;
  }

  setImageMode(on) { return Promise.all(this.workers.map((w) => w.setImageMode(on))); }
  setBlendshapes(on) { return Promise.all(this.workers.map((w) => w.setBlendshapes(on))); }

  /** Para el informe: cada análisis con su acelerador, su tiempo y cuántos fotogramas hizo. */
  describe() {
    return {
      lanes: this.lanes,
      workers: this.workers.map((w, i) => ({ delegate: w.delegate ?? null, ms: Math.round((w.ms ?? 0) * 10) / 10, frames: this.sent[i] })),
      lostInOrder: this.order.skipped,
    };
  }

  /** Suelta los análisis (deja de recibir sus resultados); no los cierra. */
  detach() {
    for (const w of this.workers) { w.onResult = null; w.onDrop = null; }
  }
}
