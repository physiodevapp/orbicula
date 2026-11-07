// Series temporales por lado del paciente (para las curvas y, más adelante, la exportación).
// Un frame sin cara se guarda como NaN para que la curva se corte.

export const KEYS = ['ear', 'aperture', 'blink'];

export class Series {
  /** @param {{maxAgeMs?: number}} opts cuánto histórico se conserva */
  constructor({ maxAgeMs = 120000 } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.clear();
  }

  clear() {
    this.t = [];
    this.left = { ear: [], aperture: [], blink: [] };
    this.right = { ear: [], aperture: [], blink: [] };
  }

  /** @param {number} t ms; @param {null | {left: object, right: object}} sample null = sin cara */
  push(t, sample) {
    this.t.push(t);
    for (const side of ['left', 'right']) {
      for (const k of KEYS) this[side][k].push(sample?.[side]?.[k] ?? NaN);
    }
    // Se recorta de golpe de vez en cuando, no en cada muestra.
    if (this.t[0] < t - this.maxAgeMs * 1.25) {
      let n = 0;
      while (this.t[n] < t - this.maxAgeMs) n++;
      this.t.splice(0, n);
      for (const side of ['left', 'right']) for (const k of KEYS) this[side][k].splice(0, n);
    }
  }

  /** Media de una métrica en la ventana [tNow − windowMs, tNow], sin contar los NaN. */
  mean(side, key, tNow, windowMs) {
    const arr = this[side][key];
    let sum = 0;
    let n = 0;
    for (let i = this.t.length - 1; i >= 0 && this.t[i] >= tNow - windowMs; i--) {
      if (Number.isFinite(arr[i])) {
        sum += arr[i];
        n++;
      }
    }
    return n ? sum / n : null;
  }
}
