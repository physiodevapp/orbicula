// Ajuste automático del ritmo del flujo: si el análisis de la cara (MediaPipe) baja de 24 por
// segundo (criterio 1) con el flujo encendido —p. ej. con el móvil caliente—, se rebaja el flujo para
// devolverle procesador; cuando el análisis se recupera con margen, se vuelve al ritmo normal.
// Sin DOM: se prueba en tests/flow.test.js.

export const GOVERNOR = {
  minAnalysisFps: 24, // por debajo, se rebaja el flujo…
  lowForMs: 3000, // …si dura al menos esto
  cap: 20, // pares por segundo mientras está rebajado
  recoverFps: 27, // se quita la rebaja si el análisis pasa de esto…
  recoverForMs: 10000, // …durante este tiempo
};

export class RateGovernor {
  constructor(opt = GOVERNOR) {
    this.opt = opt;
    this.cap = 0;
    this.since = null; // desde cuándo se cumple la condición de cambio
  }

  /**
   * @param {number} now ms
   * @param {number} analysisFps análisis de la cara por segundo
   * @returns {number} rebaja que hay que aplicar (0 = ninguna)
   */
  update(now, analysisFps) {
    const o = this.opt;
    const wantsChange = this.cap ? analysisFps >= o.recoverFps : analysisFps > 0 && analysisFps < o.minAnalysisFps;
    if (!wantsChange) {
      this.since = null;
      return this.cap;
    }
    this.since ??= now;
    if (now - this.since >= (this.cap ? o.recoverForMs : o.lowForMs)) {
      this.cap = this.cap ? 0 : o.cap;
      this.since = null;
    }
    return this.cap;
  }

  reset() {
    this.cap = 0;
    this.since = null;
  }
}
