// Junta cada par de flujo (worker de flujo) con la postura de la cabeza (worker de la cara) y
// calcula las métricas por ROI con las tres compensaciones. Sin DOM: se prueba en tests/flow-metrics.test.js.
//
// Compensación «postura»: el movimiento rígido entre los dos frames del par se estima con los
// puntos estables de la cara (POSE_POINTS), interpolados en el tiempo entre los análisis que
// rodean a cada frame. El flujo llega antes (~40 ms) que el análisis del frame siguiente (~70 ms),
// así que cada par espera en una cola hasta que hay un análisis posterior a su segundo frame. Si
// no llega a tiempo, la variante «postura» de ese par queda vacía (null) y las otras dos se dan igual.
import { ROI_KEYS, FLOW_ROIS, VARIANTS, ZERO, translationOf, residual, affineMotion, lerpPoints, toWork, roiMetrics, MOMENTS } from './metrics.js';

/** Cuánto puede esperar un par a la postura (ms de marca de tiempo de la cámara). */
export const MAX_WAIT_MS = 300;
/** Histórico de posturas que se guarda (ms). */
const KEEP_MS = 2000;

export class FlowProcessor {
  /** @param {(sample: object) => void} onSample se llama con cada par procesado, en orden */
  constructor(onSample) {
    this.onSample = onSample;
    this.reset();
  }

  reset() {
    this.poses = []; // { t, points, intercanthal, axes: {left, right} } en orden de t
    this.queue = []; // pares de flujo esperando la postura
  }

  /** Un análisis de la cara (con su marca de tiempo de captura). */
  pushFace(t, result) {
    if (!result?.face || !result.rois?.pose) return;
    const r = result.rois;
    const last = this.poses.at(-1);
    if (last && t <= last.t) return;
    this.poses.push({ t, points: r.pose, intercanthal: r.meta.intercanthal, axes: { left: r.left.axes, right: r.right.axes } });
    while (this.poses.length > 2 && this.poses[0].t < t - KEEP_MS) this.poses.shift();
    this.#drain(false);
  }

  /**
   * Un par de flujo del worker.
   * @param {{t:number, dt:number, moments:Float64Array, strip:{x,y,w,h}, scale:number}} f
   */
  pushFlow(f) {
    if (!f?.moments || !(f.dt > 0)) return;
    this.queue.push(f);
    this.#drain(false);
  }

  /** Procesa lo que quede en la cola aunque falte la postura (al terminar un paso). */
  flush() {
    this.#drain(true);
  }

  /** Puntos estables interpolados en el instante t (null si no hay análisis que lo rodeen). */
  poseAt(t) {
    const P = this.poses;
    if (!P.length || t > P.at(-1).t) return null;
    if (t < P[0].t) return P[0].t - t < 50 ? P[0] : null;
    let i = P.length - 1;
    while (i > 0 && P[i - 1].t > t) i--;
    const b = P[i];
    const a = P[Math.max(0, i - 1)];
    if (a === b || b.t === a.t) return b;
    const k = (t - a.t) / (b.t - a.t);
    return { t, points: lerpPoints(a.points, b.points, k), intercanthal: a.intercanthal + (b.intercanthal - a.intercanthal) * k, axes: k < 0.5 ? a.axes : b.axes };
  }

  #drain(force) {
    const newestPose = this.poses.at(-1)?.t ?? -Infinity;
    const newestFlow = this.queue.at(-1)?.t ?? -Infinity;
    while (this.queue.length) {
      const f = this.queue[0];
      const ready = newestPose >= f.t || newestFlow - f.t > MAX_WAIT_MS || force;
      if (!ready) break;
      this.queue.shift();
      const s = this.process(f);
      if (s) this.onSample(s);
    }
  }

  /** Métricas de un par (público para los tests). */
  process(f) {
    const p2 = this.poseAt(f.t);
    const p1 = this.poseAt(f.t - f.dt);
    // Sin ningún análisis cerca no hay ejes ni escala: el par no se puede normalizar.
    const ref = p2 ?? p1 ?? this.poses.at(-1);
    if (!ref) return null;
    const unit = ref.intercanthal * f.scale; // px de trabajo por distancia intercantal
    const mom = (k) => f.moments.subarray(k * MOMENTS, (k + 1) * MOMENTS);
    const refIdx = ROI_KEYS.indexOf('reference');
    const motion = {
      none: ZERO,
      reference: translationOf(mom(refIdx)),
      pose: p1 && p2 ? affineMotion(toWork(p1.points, f.strip, f.scale), toWork(p2.points, f.strip, f.scale)) : null,
    };
    const out = { t: f.t, dt: f.dt, left: {}, right: {} };
    ROI_KEYS.forEach((key, k) => {
      if (key === 'reference') return;
      const [side, roi] = key.split('.');
      const m = mom(k);
      out[side][roi] = Object.fromEntries(VARIANTS.map((v) => [v, roiMetrics(residual(m, motion[v]), ref.axes[side], unit, f.dt)]));
    });
    // Movimiento de la cabeza que se resta (en el centro de la franja), en distancias intercantales/s.
    const cx = (f.strip.w * f.scale) / 2;
    const cy = (f.strip.h * f.scale) / 2;
    const k = 1000 / (unit * f.dt);
    const head = (g) => (g ? { u: (g.a * cx + g.b * cy + g.c) * k, v: (g.d * cx + g.e * cy + g.f) * k } : null);
    out.head = { reference: head(motion.reference), pose: head(motion.pose) };
    return out;
  }
}

export { FLOW_ROIS, VARIANTS };
