// Curvas en tiempo real (izquierda y derecha del paciente) de la métrica elegida.
// Un lienzo por lado, con la misma escala vertical para poder comparar de un vistazo.

/** Escalas fijas: así dos curvas, o dos sesiones, se pueden comparar a simple vista. */
export const METRICS = {
  ear: { label: 'EAR', min: 0, max: 0.5, digits: 2 },
  aperture: { label: 'Apertura / distancia intercantal', min: 0, max: 0.35, digits: 3 },
  blink: { label: 'Blendshape de parpadeo', min: 0, max: 1, digits: 2 },
};

export class Curves {
  /**
   * @param {{left: HTMLCanvasElement, right: HTMLCanvasElement}} canvases
   * @param {import('../metrics/series.js').Series} series
   * @param {() => {left: {events: object[], baseline: number|null}, right: {events: object[], baseline: number|null}}} getState
   * @param {{windowMs?: number}} opts ancho de la ventana temporal
   */
  constructor(canvases, series, getState, { windowMs = 10000 } = {}) {
    this.canvases = canvases;
    this.series = series;
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
      font: get('--font-mono'),
      left: get('--side-left'),
      right: get('--side-right'),
    };
    const state = this.getState();
    for (const side of ['left', 'right']) this.#drawSide(side, palette, state[side]);
  }

  #drawSide(side, pal, { events, baseline }) {
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
    const y = (v) => h - padY - ((Math.min(m.max, Math.max(m.min, v)) - m.min) / (m.max - m.min)) * (h - 2 * padY);
    const { t, [side]: data } = this.series;
    const tNow = t.length ? t[t.length - 1] : 0;
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
      const gy = Math.round(y(m.min + f * (m.max - m.min))) + 0.5;
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
      const v = data[this.metric][i];
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
