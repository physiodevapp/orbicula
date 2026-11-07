// Junta cada par de flujo (worker de flujo) con la postura de la cabeza (worker de la cara) y
// calcula las métricas por ROI con las tres compensaciones. Sin DOM: se prueba en tests/flow-metrics.test.js.
//
// Compensación «postura»: el movimiento rígido entre los dos frames del par se estima con los
// puntos estables de la cara (POSE_POINTS), interpolados en el tiempo entre los análisis que
// rodean a cada frame. El flujo llega antes (~40 ms) que el análisis del frame siguiente (~70 ms),
// así que cada par espera en una cola hasta que hay un análisis posterior a su segundo frame. Si
// no llega a tiempo, la variante «postura» de ese par queda vacía (null) y las otras dos se dan igual.
import { ROI_KEYS, FLOW_ROIS, VARIANTS, ZERO, translationOf, residual, affineMotion, lerpPoints, toWork, toWork3, rigidMotion3d, roiMetrics, MOMENTS } from './metrics.js';

/** Claves de los puntos 3D por ROI (orden fijo para interpolarlos como una lista). */
const ANCHOR_KEYS = ['reference', ...['left', 'right'].flatMap((s) => FLOW_ROIS.map((r) => `${s}.${r}`))];
const anchorList = (a) => ANCHOR_KEYS.map((k) => (k === 'reference' ? a.reference : a[k.split('.')[0]][k.split('.')[1]]));

/**
 * Cierre por flujo: desplazamiento acumulado del párpado superior hacia abajo menos el del inferior
 * (compensado con el dorso nasal), en distancias intercantales. Positivo = el ojo se cierra.
 * Integrador con fuga (constante de tiempo CLOSURE_TAU_MS): sin ella, el ruido se acumula y la curva
 * deriva; con 5 s, una contracción mantenida 1,5 s pierde ~26 % al final. Es la señal que detectó
 * contracciones que el EAR no distinguía del reposo (docs/plan-fase-4.md, 4c).
 */
export const CLOSURE_TAU_MS = 5000;

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
    this.closure = { left: 0, right: 0 };
  }

  /** Un análisis de la cara (con su marca de tiempo de captura). */
  pushFace(t, result) {
    if (!result?.face || !result.rois?.pose) return;
    const r = result.rois;
    const last = this.poses.at(-1);
    if (last && t <= last.t) return;
    this.poses.push({
      t, points: r.pose, intercanthal: r.meta.intercanthal, axes: { left: r.left.axes, right: r.right.axes },
      p3: r.pose3d ?? null, anchors: r.anchors3d ? anchorList(r.anchors3d) : null,
    });
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
    return {
      t, points: lerpPoints(a.points, b.points, k), intercanthal: a.intercanthal + (b.intercanthal - a.intercanthal) * k, axes: k < 0.5 ? a.axes : b.axes,
      p3: a.p3 && b.p3 ? lerpPoints(a.p3, b.p3, k) : null,
      anchors: a.anchors && b.anchors ? lerpPoints(a.anchors, b.anchors, k) : null,
    };
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
    // «Dorso nasal + giro»: movimiento rígido 3D entre los dos frames (puntos estables en coordenadas
    // de trabajo) y, para cada ROI, la diferencia entre su desplazamiento y el del dorso nasal.
    let rigid = null;
    let anchors = null;
    if (motion.reference && p1?.p3 && p2?.p3 && p1.anchors) {
      rigid = rigidMotion3d(toWork3(p1.p3, f.strip, f.scale), toWork3(p2.p3, f.strip, f.scale));
      anchors = toWork3(p1.anchors, f.strip, f.scale);
    }
    const hybridFor = (key) => {
      if (!rigid) return null;
      const dRef = rigid(anchors[0]);
      const d = rigid(anchors[ANCHOR_KEYS.indexOf(key)]);
      return { ...motion.reference, c: motion.reference.c + d.x - dRef.x, f: motion.reference.f + d.y - dRef.y };
    };
    const out = { t: f.t, dt: f.dt, left: {}, right: {} };
    ROI_KEYS.forEach((key, k) => {
      if (key === 'reference') return;
      const [side, roi] = key.split('.');
      const m = mom(k);
      const g = { ...motion, hybrid: hybridFor(key) };
      out[side][roi] = Object.fromEntries(VARIANTS.map((v) => [v, roiMetrics(residual(m, g[v]), ref.axes[side], unit, f.dt)]));
    });
    // Movimiento de la cabeza que se resta (en el centro de la franja), en distancias intercantales/s.
    const cx = (f.strip.w * f.scale) / 2;
    const cy = (f.strip.h * f.scale) / 2;
    const k = 1000 / (unit * f.dt);
    const head = (g) => (g ? { u: (g.a * cx + g.b * cy + g.c) * k, v: (g.d * cx + g.e * cy + g.f) * k } : null);
    out.head = { reference: head(motion.reference), pose: head(motion.pose) };
    // Cierre por flujo de cada ojo (ver CLOSURE_TAU_MS).
    out.closure = {};
    const leak = Math.exp(-f.dt / CLOSURE_TAU_MS);
    for (const side of ['left', 'right']) {
      const up = out[side].upperLid.reference?.down;
      const lo = out[side].lowerLid.reference?.down;
      const step = Number.isFinite(up) && Number.isFinite(lo) ? ((up - lo) * f.dt) / 1000 : 0;
      this.closure[side] = this.closure[side] * leak + step;
      out.closure[side] = this.closure[side];
    }
    return out;
  }
}

export { FLOW_ROIS, VARIANTS };
