// Calibración sobre el reposo y detección de eventos (fase 5). Sin DOM ni reloj propio: recibe las
// marcas de tiempo (ms) de la cámara. Lo usan igual la app (en directo) y scripts/dev/replay-events.mjs
// (sobre los JSON del asistente). Decisiones en docs/plan-fase-5.md.
//
// Medida de los eventos: la SUBIDA del cierre por flujo (FlowProcessor.closure, compensado con el dorso
// nasal), es decir, cuánto se ha cerrado el ojo respecto a cómo estaba justo antes:
//   subida(t) = cierre(t) − mín { mediana del cierre en [h − 0,6 s, h] : h ∈ [t − 1,5 s, t] }
// Es el máximo, entre las ventanas de 1,5 s que contienen t (empezando en el instante de un par), del
// estadístico con el que se comprobó el criterio 4 en la fase 4 (scripts/dev/analyze-flow.mjs), pero
// causal: se puede calcular en directo.
// El umbral es el máximo de la subida en el reposo válido (sin parpadeos y con la cabeza quieta).
//
// Puerta «cabeza en movimiento»: si la velocidad del dorso nasal (mediana de 3 pares, para que un pico
// suelto de ruido no cuente) supera el umbral del reposo, los eventos de alrededor (±0,5 s) se descartan.

import { percentile } from '../metrics/blinks.js';

export const EVENT_DEFAULTS = {
  medianMs: 600, // ventana de la mediana de «cómo estaba antes»
  riseMs: 1500, // hasta cuánto antes se busca ese «antes»
  endRatio: 0.5, // un evento acaba cuando la subida baja de esta fracción del umbral
  minDurationMs: 500, // una contracción más corta es «breve» (parpadeo incompleto, sacudida): no cuenta
  riseMargin: 1, // umbral = margen × máximo de la subida en el reposo válido
  // Si el máximo supera spikyRatio × el p95 del reposo, lo ha fijado un pico suelto (una sacudida del
  // párpado): se avisa (`warning`) para que, si se quiere más sensibilidad, se repita el reposo. En los
  // JSON reales, la razón es 1,5–3,7 salvo en el reposo con una sacudida (14–23). Las reglas que quitan los
  // picos (mediana móvil, «sostenida») bajan el umbral en TODAS las sesiones y traen falsas alarmas en
  // los controles (docs/plan-fase-5.md, 5c): no se usan.
  spikyRatio: 6,
  riseFloor: 0.001, // suelo del umbral (DI), provisional hasta repetirlo con los JSON reales: que un reposo muy quieto no dé un umbral ridículo
  headK: 3, // cabeza quieta: velocidad del dorso nasal < headK × su mediana en el reposo…
  headFloor: 0.1, // …y nunca menos de esto (DI/s); la misma regla que analyze-flow.mjs…
  headMax: 0.3, // …ni más (provisional): si la cabeza se mueve casi todo el reposo, su mediana ya es movimiento
  headSmooth: 3, // pares para la mediana de la velocidad de la cabeza
  marginMs: 500, // margen alrededor del movimiento de la cabeza (y espera antes de dar un evento por bueno)
  maxWaitMs: 2000, // espera máxima a que el detector de parpadeos termine un cierre en curso
  blinkMin: 0.5, // parpadeos «de verdad»: cierre ≥ 50 % (los poco profundos son la propia contracción)
  blinkBefore: 200, // una contracción que se solapa con [inicio − 200 ms, fin + 400 ms] de un parpadeo…
  blinkAfter: 400, // …del mismo ojo es el parpadeo, no una contracción
  energyRois: ['brow', 'canthus'], // eventos experimentales por energía
  energyK: 2, // umbral = energyK × p99 de la velocidad residual del reposo (provisional)
  minValidMs: 10000, // reposo válido: al menos este tiempo sin parpadeos y con la cabeza quieta…
  minCleanMs: 3000, // …y al menos este tiempo con ventanas de subida limpias (para el umbral)
  maxFaceLoss: 0.1, // …y la cara perdida como mucho este tanto por uno
};

const SIDES = ['left', 'right'];
const median = (a) => percentile(a, 0.5);

/** Subida del cierre en directo (ver la cabecera). Una instancia por ojo. */
export class RiseTracker {
  constructor(opt = EVENT_DEFAULTS) {
    this.opt = { ...EVENT_DEFAULTS, ...opt };
    this.reset();
  }

  reset() {
    this.buf = []; // { t, v } de la ventana de la mediana
    this.meds = []; // { t, m }: mediana de la ventana que acaba en t
    this.t0 = null;
  }

  /** @returns {number} la subida en t, o NaN mientras no hay señal suficiente */
  push(t, v) {
    if (!Number.isFinite(v)) return NaN;
    const { medianMs, riseMs } = this.opt;
    this.t0 ??= t;
    this.buf.push({ t, v });
    while (this.buf[0].t < t - medianMs) this.buf.shift();
    // Solo cuentan las medianas con la ventana completa.
    if (t - this.t0 >= medianMs) this.meds.push({ t, m: median(this.buf.map((s) => s.v)) });
    while (this.meds.length && this.meds[0].t < t - riseMs) this.meds.shift();
    // Sin la historia completa (0,6 + 1,5 s) la subida no es comparable con la del reposo.
    if (!this.meds.length || t - this.t0 < medianMs + riseMs) return NaN;
    let min = Infinity;
    for (const x of this.meds) if (x.m < min) min = x.m;
    return v - min;
  }
}

/** Mediana de las últimas n velocidades de la cabeza. */
class Smoother {
  constructor(n) {
    this.n = n;
    this.buf = [];
  }

  push(v) {
    if (!Number.isFinite(v)) return NaN;
    this.buf.push(v);
    if (this.buf.length > this.n) this.buf.shift();
    return median(this.buf);
  }
}

/** Velocidad de la cabeza (DI/s) del movimiento que resta el dorso nasal. */
export const headSpeedOf = (u, v) => (Number.isFinite(u) && Number.isFinite(v) ? Math.hypot(u, v) : NaN);

/**
 * Datos de un paso del asistente con nombres comunes, venga del JSON (series.t, flow.t) o de la sesión
 * en curso (rel, flow.rel).
 */
export function stepView(step) {
  const st = step.series?.t ?? step.rel ?? [];
  const f = step.flow ?? {};
  const ft = f.t ?? f.rel ?? [];
  return {
    st,
    ear: { left: step.series?.left?.ear ?? [], right: step.series?.right?.ear ?? [] },
    aperture: { left: step.series?.left?.aperture ?? [], right: step.series?.right?.aperture ?? [] },
    events: { left: step.events?.left ?? [], right: step.events?.right ?? [] },
    ft,
    closure: { left: f.closure?.left ?? [], right: f.closure?.right ?? [] },
    head: ft.map((_, i) => headSpeedOf(f.head?.rU?.[i], f.head?.rV?.[i])),
    energy: (side, roi) => {
      const e = f[side]?.[roi]?.eR ?? [];
      return ft.map((_, i) => (Number.isFinite(e[i]) ? Math.sqrt(e[i]) : NaN));
    },
  };
}

const r4 = (v) => (Number.isFinite(v) ? Number(v.toPrecision(4)) : null);
const overlaps = (wins, a, b) => wins.some(([x, y]) => y >= a && x <= b);

/**
 * Calibración sobre el paso de reposo.
 * Las ventanas de los eventos del detector de parpadeos (todos, también los poco profundos) y del
 * movimiento de la cabeza se apartan, como en el reposo estricto de la fase 4.
 * @returns {object} umbrales por lado, validez y el motivo si no vale
 */
export function calibrate(step, options = {}) {
  const o = { ...EVENT_DEFAULTS, ...options };
  const v = stepView(step);
  const smooth = new Smoother(o.headSmooth);
  const head = v.head.map((s) => smooth.push(s));
  const headStill = Math.min(o.headMax, Math.max(o.headFloor, o.headK * (median(head.filter(Number.isFinite)) ?? 0)));

  const blinkWins = SIDES.flatMap((s) => v.events[s].map((e) => [e.t - e.duration - o.blinkBefore, e.t + e.duration + o.blinkAfter]));
  const moveWins = v.ft.filter((t, i) => head[i] > headStill).map((t) => [t - o.marginMs, t + o.marginMs]);
  const bad = [...blinkWins, ...moveWins];

  // Tiempo válido: pares fuera de cualquier ventana apartada.
  const dt = median(v.ft.slice(1).map((t, i) => t - v.ft[i])) ?? 0;
  const ok = v.ft.map((t) => !overlaps(bad, t, t));
  const validMs = ok.filter(Boolean).length * dt;
  // Qué aparta más tiempo: la cabeza o los parpadeos (para decir el motivo si el reposo no vale).
  const movingMs = v.ft.filter((t) => overlaps(moveWins, t, t)).length * dt;
  const blinkedMs = v.ft.filter((t) => overlaps(blinkWins, t, t)).length * dt;
  // Subida: solo cuentan los pares cuya ventana entera ([t − 2,1 s, t]) está limpia.
  const span = o.medianMs + o.riseMs;
  const clean = v.ft.map((t) => t - (v.ft[0] ?? t) >= span && !overlaps(bad, t - span, t));
  const cleanMs = clean.filter(Boolean).length * dt;

  const out = {
    version: 1,
    options: { riseMargin: o.riseMargin, riseFloor: o.riseFloor, energyK: o.energyK, headK: o.headK, headFloor: o.headFloor, headMax: o.headMax },
    headStill: r4(headStill),
    validMs: Math.round(validMs),
    cleanMs: Math.round(cleanMs),
    faceFraction: null,
    rise: {},
    riseNull: {},
    ear: {},
    aperture: {},
    energy: {},
    valid: true,
    reason: null,
  };
  const n = v.st.length;
  out.faceFraction = n ? r4(v.st.filter((_, i) => Number.isFinite(v.ear.left[i]) || Number.isFinite(v.ear.right[i])).length / n) : 0;

  const spiky = [];
  for (const side of SIDES) {
    const tr = new RiseTracker(o);
    const all = v.ft.map((t, i) => tr.push(t, v.closure[side][i]));
    const rises = all.filter((r, i) => clean[i] && Number.isFinite(r));
    const max = rises.length ? Math.max(...rises) : NaN;
    const p95 = percentile(rises, 0.95);
    out.riseNull[side] = { n: rises.length, p95: r4(p95), max: r4(max) };
    out.rise[side] = r4(Math.max(o.riseFloor, Number.isFinite(max) ? o.riseMargin * max : o.riseFloor));
    // Umbral fijado por un pico suelto (sacudida del párpado): el reposo vale, pero se pierde sensibilidad.
    if (Number.isFinite(max) && p95 > 0 && max / p95 > o.spikyRatio) spiky.push(side);

    const restEar = v.st.map((t, i) => (overlaps(blinkWins, t, t) ? NaN : v.ear[side][i])).filter(Number.isFinite);
    const restAp = v.st.map((t, i) => (overlaps(blinkWins, t, t) ? NaN : v.aperture[side][i])).filter(Number.isFinite);
    const mean = restEar.reduce((a, b) => a + b, 0) / (restEar.length || 1);
    out.ear[side] = {
      baseline: r4(percentile(restEar, 0.9)),
      noise: r4(restEar.length ? Math.sqrt(restEar.reduce((a, b) => a + (b - mean) ** 2, 0) / restEar.length) : NaN),
    };
    out.aperture[side] = { baseline: r4(percentile(restAp, 0.9)) };
    out.energy[side] = Object.fromEntries(o.energyRois.map((roi) => {
      const e = v.energy(side, roi).filter((x, i) => ok[i] && Number.isFinite(x));
      return [roi, r4(percentile(e, 0.99))];
    }));
  }

  out.warning = spiky.length
    ? `Umbral alto en ${spiky.map((x) => (x === 'left' ? 'el ojo izquierdo' : 'el ojo derecho')).join(' y ')}: lo ha fijado una sacudida suelta del párpado durante el reposo. Vale, pero detectará menos contracciones finas; si quieres más sensibilidad, repite el reposo.`
    : null;
  // Si no vale, el motivo con números (se ve en la revisión y viaja en el JSON) y un código para la voz.
  const s1 = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const reasons = [];
  const codes = [];
  if (!v.ft.length) {
    reasons.push('no hay datos del flujo');
    codes.push('noflow');
  } else {
    if (out.faceFraction < 1 - o.maxFaceLoss) {
      reasons.push(`se ha perdido la cara (detectada el ${Math.round(out.faceFraction * 100)} % del tiempo; hace falta el ${Math.round((1 - o.maxFaceLoss) * 100)} %)`);
      codes.push('face');
    }
    if (validMs < o.minValidMs) {
      const head = movingMs >= blinkedMs;
      reasons.push(`${head ? 'la cabeza se ha movido' : 'hay demasiados parpadeos'} (${s1(validMs)} de reposo útil; hacen falta ${s1(o.minValidMs)}; la cabeza aparta ${s1(movingMs)} y los parpadeos ${s1(blinkedMs)})`);
      codes.push(head ? 'head' : 'blinks');
    } else if (cleanMs < o.minCleanMs) {
      reasons.push(`no hay tramos tranquilos suficientes (${s1(cleanMs)}; hacen falta ${s1(o.minCleanMs)} sin parpadeos ni movimiento seguidos)`);
      codes.push('clean');
    }
  }
  out.diagnosis = { validMs: Math.round(validMs), neededMs: Math.round(o.minValidMs), cleanMs: Math.round(cleanMs), neededCleanMs: o.minCleanMs, movingMs: Math.round(movingMs), blinkedMs: Math.round(blinkedMs), faceFraction: out.faceFraction, headStill: out.headStill };
  if (reasons.length) {
    out.valid = false;
    out.reason = reasons.join('; ');
    out.reasonCode = codes[0];
  }
  return out;
}

/**
 * Eventos en directo a partir de la calibración.
 *   pushFlow(sample) con cada par de flujo procesado; pushBlink(side, e) con cada evento del detector
 *   de parpadeos. Ambos devuelven los eventos que quedan cerrados en ese momento.
 * Tipos: 'contraction' (subida del cierre por flujo por encima del umbral), 'blink' / 'closure' (detector
 * del EAR, cierre ≥ 50 %) y, experimentales, 'brow' / 'canthus' (energía por encima del umbral).
 * Estado (`status`): 'ok' (cuenta), 'head' (descartado: cabeza en movimiento), 'blink' (era un parpadeo)
 * o 'brief' (contracción de menos de minDurationMs: en los JSON de la fase 4 y la 5a, las contracciones
 * mantenidas duraron 600–1800 ms y las falsas alarmas de los controles y del reposo, 80–470 ms, casi
 * siempre con un parpadeo incompleto a la vez; se guarda, pero no cuenta).
 * Los tiempos de los eventos van en el reloj de la cámara (ms).
 */
export class EventDetector {
  /**
   * @param {object} cal resultado de calibrate()
   * @param {{isClosing?: (side: string) => boolean} & object} options isClosing: el detector de
   *   parpadeos de ese ojo tiene un cierre en curso (se espera a que acabe para fusionar)
   */
  constructor(cal, { isClosing = () => false, ...options } = {}) {
    this.cal = cal;
    this.opt = { ...EVENT_DEFAULTS, ...options };
    this.isClosing = isClosing;
    this.rise = { left: new RiseTracker(this.opt), right: new RiseTracker(this.opt) };
    this.smooth = new Smoother(this.opt.headSmooth);
    this.moves = []; // instantes con la cabeza en movimiento (recientes)
    this.active = {}; // `${kind}:${side}` → evento abierto
    this.pending = []; // eventos cerrados a la espera de comprobar la cabeza y los parpadeos
    this.blinks = { left: [], right: [] };
    this.events = [];
    this.last = { t: null, rise: { left: NaN, right: NaN }, moving: false };
  }

  /** Umbral de cada medida por lado. */
  threshold(kind, side) {
    if (kind === 'contraction') return this.cal.rise?.[side];
    const p99 = this.cal.energy?.[side]?.[kind];
    return Number.isFinite(p99) ? p99 * this.opt.energyK : NaN;
  }

  /**
   * @param {{t:number, closure:{left:number,right:number}, headSpeed:number,
   *          energy?: {left: object, right: object}}} s velocidades de la energía en DI/s (raíz)
   */
  pushFlow(s) {
    const { t } = s;
    const speed = this.smooth.push(s.headSpeed);
    if (speed > this.cal.headStill) this.moves.push(t);
    while (this.moves.length && this.moves[0] < t - 10000) this.moves.shift();
    this.last.t = t;
    this.last.moving = this.moves.length > 0 && this.moves.at(-1) >= t - this.opt.marginMs;
    for (const side of SIDES) {
      const r = this.rise[side].push(t, s.closure?.[side]);
      this.last.rise[side] = r;
      this.#track('contraction', side, t, r, this.opt.endRatio);
      for (const roi of this.opt.energyRois) this.#track(roi, side, t, s.energy?.[side]?.[roi], 1);
    }
    return this.#settle(t, false);
  }

  /** Un evento del detector de parpadeos (BlinkDetector), con tDown, tUp, completeness y kind. */
  pushBlink(side, e) {
    if (!(e.completeness >= this.opt.blinkMin)) return [];
    this.blinks[side].push(e);
    if (this.blinks[side].length > 50) this.blinks[side].shift();
    const ev = { kind: e.kind === 'blink' ? 'blink' : 'closure', side, tStart: e.tDown, tEnd: e.tUp, duration: Math.round(e.duration), peak: e.completeness, tPeak: e.t, status: 'ok' };
    this.events.push(ev);
    return [ev];
  }

  /** Cierra y da por buenos todos los eventos pendientes (al terminar un paso). */
  flush() {
    const t = this.last.t ?? 0;
    for (const key of Object.keys(this.active)) this.#close(key, t);
    return this.#settle(t, true);
  }

  #track(kind, side, t, value, endRatio) {
    const thr = this.threshold(kind, side);
    if (!Number.isFinite(thr) || !(thr > 0)) return;
    const key = `${kind}:${side}`;
    const a = this.active[key];
    if (!a) {
      if (value > thr) this.active[key] = { kind, side, tStart: t, tEnd: t, peak: value / thr, tPeak: t };
      return;
    }
    if (Number.isFinite(value) && value / thr > a.peak) {
      a.peak = value / thr;
      a.tPeak = t;
    }
    a.tEnd = t;
    if (!(value > thr * endRatio)) this.#close(key, t);
  }

  #close(key, t) {
    const a = this.active[key];
    delete this.active[key];
    a.tEnd = t;
    this.pending.push(a);
  }

  #settle(t, force) {
    const out = [];
    const { marginMs, maxWaitMs, blinkBefore, blinkAfter } = this.opt;
    this.pending = this.pending.filter((a) => {
      const waited = t - a.tEnd;
      const closing = a.kind === 'contraction' && this.isClosing(a.side);
      if (!force && (waited < marginMs || (closing && waited < maxWaitMs))) return true;
      let status = 'ok';
      if (this.moves.some((m) => m >= a.tStart - marginMs && m <= a.tEnd + marginMs)) status = 'head';
      else if (a.kind === 'contraction' && (closing || this.blinks[a.side].some((b) => b.tUp + blinkAfter >= a.tStart && b.tDown - blinkBefore <= a.tEnd))) status = 'blink';
      else if (a.kind === 'contraction' && a.tEnd - a.tStart < this.opt.minDurationMs) status = 'brief';
      const ev = { ...a, duration: Math.round(a.tEnd - a.tStart), peak: Number(a.peak.toFixed(2)), status };
      this.events.push(ev);
      out.push(ev);
      return false;
    });
    return out;
  }
}
