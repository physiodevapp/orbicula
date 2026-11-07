// Curvas en tiempo real (izquierda y derecha del paciente) de la métrica elegida.
// Un lienzo por lado, con la misma escala vertical para poder comparar de un vistazo.

/** Escalas fijas: así dos curvas, o dos sesiones, se pueden comparar a simple vista. */
export const METRICS = {
  ear: { label: 'EAR', min: 0, max: 0.5, digits: 2 },
  aperture: { label: 'Apertura / distancia intercantal', min: 0, max: 0.35, digits: 3 },
  blink: { label: 'Blendshape de parpadeo', min: 0, max: 1, digits: 2 },
  // Flujo residual de una ROI: velocidad cuadrática media (raíz de la energía), en distancias
  // intercantales por segundo. Escala logarítmica: el reposo y una contracción difieren en órdenes de magnitud.
  flow: { label: 'Flujo (DI/s)', min: 0.01, max: 3, digits: 2, log: true, series: 'flow' },
  // Cierre del ojo por flujo integrado (DI, + = se cierra): ver CLOSURE_TAU_MS en flow/processor.js.
  closure: { label: 'Cierre por flujo (DI)', min: -0.05, max: 0.2, digits: 3, series: 'flow', key: 'closure' },
  // Subida del cierre (DI): la medida de los eventos de la fase 5 (src/protocol/events.js), con su umbral.
  rise: { label: 'Subida del cierre (DI)', min: -0.01, max: 0.06, digits: 3, series: 'flow', key: 'rise' },
};

export class Curves {
  /**
   * @param {{left: HTMLCanvasElement, right: HTMLCanvasElement}} canvases
   * @param {import('../metrics/series.js').Series} series
   * @param {() => {left: {events: object[], baseline: number|null}, right: {events: object[], baseline: number|null}}} getState
   * @param {{windowMs?: number}} opts ancho de la ventana temporal
   */
  constructor(canvases, series, getState, { windowMs = 10000, flowSeries = null } = {}) {
    this.canvases = canvases;
    this.series = series;
    this.flowSeries = flowSeries;
    this.flowKey = null; // métrica del flujo que se dibuja: '<roi>:<compensación>'
    this.getState = getState;
    this.windowMs = windowMs;
    this.metric = 'ear';
    this._pending = false;
    this._ro = new ResizeObserver(() => this.requestDraw());
    for (const c of Object.values(canvases)) this._ro.observe(c);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.requestDraw());
  }

  setMetric(key) {
    this.metric = key;
    this.requestDraw();
  }

  /** Pide un repintado; varias peticiones seguidas se juntan en una por fotograma de pantalla. */
  requestDraw() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => {
      this._pending = false;
      this.draw();
    });
  }

  draw() {
    const css = getComputedStyle(document.documentElement);
    const get = (n) => css.getPropertyValue(n).trim();
    const palette = {
      grid: get('--border'),
      text: get('--text3'),
      warn: get('--warn'),
      accent: get('--accent'),
      font: get('--font-mono'),
      left: get('--side-left'),
      right: get('--side-right'),
    };
    const state = this.getState();
    for (const side of ['left', 'right']) this.#drawSide(side, palette, state[side]);
  }

  #drawSide(side, pal, { events, baseline, detections = [], threshold = null }) {
    const canvas = this.canvases[side];
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const m = METRICS[this.metric];
    const padY = 6;
    const tr = m.log ? Math.log10 : (v) => v;
    const lo = tr(m.min);
    const hi = tr(m.max);
    const y = (v) => h - padY - ((tr(Math.min(m.max, Math.max(m.min, v))) - lo) / (hi - lo)) * (h - 2 * padY);
    const src = m.series === 'flow' ? this.flowSeries : this.series;
    const key = m.key ?? (m.series === 'flow' ? this.flowKey : this.metric);
    const { t, [side]: data } = src;
    // El tiempo lo marcan las dos series (la del flujo va unos 70 ms por detrás de la de la cara).
    const tNow = Math.max(this.series.t.at(-1) ?? 0, this.flowSeries?.t.at(-1) ?? 0);
    const x = (tt) => ((tt - (tNow - this.windowMs)) / this.windowMs) * w;

    // Cuadrícula: una línea cada 2 s y tres horizontales.
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal.grid;
    ctx.beginPath();
    for (let s = 0; s <= this.windowMs; s += 2000) {
      const gx = Math.round(x(tNow - this.windowMs + s)) + 0.5;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
    }
    for (const f of [0, 0.5, 1]) {
      const gy = Math.round(h - padY - f * (h - 2 * padY)) + 0.5;
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
    }
    ctx.stroke();

    // Parpadeos detectados (y cierres largos) como franjas.
    for (const e of events) {
      if (e.tUp < tNow - this.windowMs) continue;
      ctx.fillStyle = pal.warn;
      ctx.globalAlpha = e.kind === 'blink' ? 0.28 : 0.12;
      const x0 = x(e.tDown);
      ctx.fillRect(x0, 0, Math.max(2, x(e.tUp) - x0), h);
    }
    ctx.globalAlpha = 1;

    // Contracciones de la fase 5 (sobre las curvas del cierre); tenues si se descartaron.
    if (this.metric === 'closure' || this.metric === 'rise') {
      ctx.fillStyle = pal.accent;
      for (const e of detections) {
        if (e.tEnd < tNow - this.windowMs) continue;
        ctx.globalAlpha = e.status === 'ok' ? 0.3 : 0.1;
        const x0 = x(e.tStart);
        ctx.fillRect(x0, 0, Math.max(2, x(e.tEnd) - x0), h);
      }
      ctx.globalAlpha = 1;
    }
    // Umbral de los eventos, calibrado con el reposo.
    if (this.metric === 'rise' && threshold != null) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = pal.accent;
      ctx.beginPath();
      ctx.moveTo(0, y(threshold));
      ctx.lineTo(w, y(threshold));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Línea base del detector (solo tiene sentido para el EAR).
    if (this.metric === 'ear' && baseline != null) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = pal.text;
      ctx.beginPath();
      ctx.moveTo(0, y(baseline));
      ctx.lineTo(w, y(baseline));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // La curva, cortada donde no hay dato (cara perdida).
    ctx.strokeStyle = pal[side];
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    let last = null;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < tNow - this.windowMs - 500) continue;
      const v = data[key]?.[i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(x(t[i]), y(v));
      else ctx.moveTo(x(t[i]), y(v));
      pen = true;
      last = v;
    }
    ctx.stroke();

    // Etiqueta con el lado y el último valor.
    ctx.fillStyle = pal[side];
    ctx.font = `600 13px ${pal.font}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(side === 'left' ? 'I' : 'D', 8, 6);
    ctx.fillStyle = pal.text;
    ctx.font = `11px ${pal.font}`;
    ctx.textAlign = 'right';
    ctx.fillText(last == null ? '—' : last.toFixed(m.digits), w - 6, 6);
  }
}
