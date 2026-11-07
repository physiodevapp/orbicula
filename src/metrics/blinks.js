// Detector de parpadeos sobre una señal de apertura (EAR) de un lado.
// Sin DOM ni reloj propio: recibe las marcas de tiempo (ms) de los frames.
//
// Cómo funciona
//  - «Apertura en reposo» (línea base): percentil alto de la ventana de los últimos segundos.
//    Los parpadeos son breves, así que el percentil 90 los ignora. Puede fijarse desde fuera
//    (`baseline`): la calibración del protocolo (fase 5) la dará con el reposo del paciente.
//  - Un cierre empieza cuando la señal baja de `startRatio` × reposo y acaba cuando vuelve a
//    subir de `endRatio` × reposo (histéresis, para no contar dos veces un mismo parpadeo).
//  - Duración = tiempo entre los cruces (interpolados) del nivel intermedio entre el reposo y
//    el mínimo: no depende de los umbrales de arriba ni de la frecuencia de muestreo.
//  - Completitud = cierre respecto a la apertura en reposo = (reposo − mínimo) / reposo. El EAR
//    no llega a 0 con el ojo cerrado (el contorno del párpado tiene grosor): en las pruebas del
//    autor un cierre completo ronda el 70–80 %.
//  - Un cierre de más de `closureMs` se anota como «cierre» (voluntario o mantenido), no como
//    parpadeo, y no cuenta para la frecuencia.
//
// Todos los umbrales son provisionales y se ajustarán con pruebas en el móvil.

export const BLINK_DEFAULTS = {
  windowMs: 5000, // ventana para estimar el reposo
  percentile: 0.9,
  warmupMs: 1500, // sin detección hasta tener esta cantidad de señal
  startRatio: 0.75,
  endRatio: 0.85,
  minSamples: 2, // muestras por debajo del umbral de inicio para aceptar un cierre
  closureMs: 800,
  maxGapMs: 250, // un hueco mayor (cara perdida) corta el cierre en curso
  baseline: null,
};

export function percentile(values, p) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}

/** Instante en que la señal cruza `level` entre dos muestras (interpolación lineal). */
function crossing(a, b, level) {
  if (b.v === a.v) return b.t;
  return a.t + ((level - a.v) / (b.v - a.v)) * (b.t - a.t);
}

export class BlinkDetector {
  constructor(options = {}) {
    this.opt = { ...BLINK_DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.buf = []; // ventana de reposo: {t, v}
    this.closing = false;
    this.ev = []; // muestras del cierre en curso
    this.base0 = null; // reposo al empezar el cierre
    this.prev = null;
    this.firstT = null;
    this.events = [];
  }

  /** Línea base actual (fija, o estimada si ya hay señal suficiente), o null. */
  get baseline() {
    if (this.opt.baseline != null) return this.opt.baseline;
    const b = this.buf;
    if (b.length < 2 || b[b.length - 1].t - b[0].t < this.opt.warmupMs) return null;
    return percentile(b.map((s) => s.v), this.opt.percentile);
  }

  #gap() {
    this.closing = false;
    this.ev = [];
    this.prev = null;
  }

  /**
   * Añade una muestra. `v` no finito = sin dato (cara perdida).
   * @returns {object|null} el evento si esta muestra cierra uno (parpadeo o cierre)
   */
  push(t, v) {
    if (!Number.isFinite(v)) {
      this.#gap();
      return null;
    }
    if (this.prev && t - this.prev.t > this.opt.maxGapMs) this.#gap();
    this.firstT ??= t;
    const sample = { t, v };
    let out = null;

    if (!this.closing) {
      this.buf.push(sample);
      while (this.buf.length && this.buf[0].t < t - this.opt.windowMs) this.buf.shift();
      const base = this.baseline;
      if (base != null && v < this.opt.startRatio * base) {
        this.closing = true;
        this.base0 = base;
        this.ev = this.prev ? [this.prev, sample] : [sample];
      }
    } else {
      this.ev.push(sample);
      if (v > this.opt.endRatio * this.base0) {
        out = this.#finish();
        this.closing = false;
        this.ev = [];
      }
    }
    this.prev = sample;
    return out;
  }

  #finish() {
    const { ev, base0: base } = this;
    const below = ev.filter((s) => s.v < this.opt.startRatio * base).length;
    if (below < this.opt.minSamples) return null;

    let min = ev[0];
    for (const s of ev) if (s.v < min.v) min = s;
    const half = (base + min.v) / 2;

    let tDown = ev[0].t;
    for (let i = 1; i < ev.length; i++) {
      if (ev[i].v <= half) {
        tDown = ev[i - 1].v <= half ? ev[i - 1].t : crossing(ev[i - 1], ev[i], half);
        break;
      }
    }
    let tUp = ev[ev.length - 1].t;
    for (let i = ev.length - 2; i >= 0; i--) {
      if (ev[i].v <= half) {
        tUp = crossing(ev[i], ev[i + 1], half);
        break;
      }
    }

    const duration = Math.max(0, tUp - tDown);
    const event = {
      kind: duration > this.opt.closureMs ? 'closure' : 'blink',
      t: min.t, // instante del mínimo
      tDown,
      tUp,
      duration,
      min: min.v,
      baseline: base,
      completeness: Math.min(1, Math.max(0, (base - min.v) / base)),
    };
    this.events.push(event);
    return event;
  }

  /** Cuenta, frecuencia (por minuto, sobre los últimos 60 s) y último parpadeo. */
  stats(tNow) {
    const blinks = this.events.filter((e) => e.kind === 'blink');
    const elapsed = this.firstT == null ? 0 : tNow - this.firstT;
    const recent = blinks.filter((e) => e.t >= tNow - 60000).length;
    const span = Math.min(60000, elapsed);
    return {
      count: blinks.length,
      closures: this.events.length - blinks.length,
      // Antes de 10 s de señal la frecuencia no es fiable.
      perMinute: span >= 10000 ? (recent * 60000) / span : null,
      last: blinks.at(-1) ?? null,
    };
  }
}
