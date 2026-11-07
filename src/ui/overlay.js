// Superposición de las ROI sobre el vídeo. Lienzo propio (sin espejo CSS): el espejo de la
// vista previa frontal se aplica al dibujar (ver display.js), así las etiquetas I/D no salen
// al revés.
import { contentRect, toDisplay } from './display.js';

const ROI_NAMES = ['upperLid', 'lowerLid', 'brow', 'canthus'];
const LABEL = { left: 'I', right: 'D' }; // izquierda / derecha del PACIENTE

export class Overlay {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement} stage marco que contiene el vídeo y el lienzo
   */
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext('2d');
    this.colors = {};
    this.resize();
    new ResizeObserver(() => this.resize()).observe(stage);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readColors());
  }

  readColors() {
    const css = getComputedStyle(document.documentElement);
    const get = (n) => css.getPropertyValue(n).trim();
    this.colors = { left: get('--side-left'), right: get('--side-right'), reference: get('--accent'), font: get('--font-mono') };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.stage.clientWidth;
    this.h = this.stage.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.readColors();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  /**
   * @param {{frame:{width:number,height:number}, rois:object}} result
   * @param {{displayMirrored:boolean}} opts la vista previa va en espejo (cámara frontal)
   */
  draw(result, { displayMirrored }) {
    const { ctx } = this;
    this.clear();
    const rect = contentRect(this.w, this.h, result.frame.width, result.frame.height);
    const path = (poly) => {
      poly.forEach((p, i) => {
        const d = toDisplay(p, rect, displayMirrored);
        if (i) ctx.lineTo(d.x, d.y);
        else ctx.beginPath(), ctx.moveTo(d.x, d.y);
      });
      ctx.closePath();
    };

    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const side of ['left', 'right']) {
      const color = this.colors[side];
      ctx.strokeStyle = ctx.fillStyle = color;
      for (const name of ROI_NAMES) {
        path(result.rois[side][name].polygon);
        ctx.globalAlpha = 0.14;
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.stroke();
      }
      // Etiqueta I/D sobre la ceja.
      const b = result.rois[side].brow.box;
      const label = toDisplay({ x: b.x + b.w / 2, y: b.y }, rect, displayMirrored);
      ctx.globalAlpha = 1;
      ctx.font = `600 16px ${this.colors.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(LABEL[side], label.x, label.y - 6);
    }

    ctx.strokeStyle = ctx.fillStyle = this.colors.reference;
    ctx.setLineDash([5, 4]);
    path(result.rois.reference.polygon);
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** Franja periocular que se recorta para el flujo óptico (rectángulo en píxeles del frame completo). */
  drawStrip(strip, frame, { displayMirrored }) {
    const { ctx } = this;
    const rect = contentRect(this.w, this.h, frame.width, frame.height);
    const a = toDisplay({ x: strip.x, y: strip.y }, rect, displayMirrored);
    const b = toDisplay({ x: strip.x + strip.w, y: strip.y + strip.h }, rect, displayMirrored);
    ctx.strokeStyle = this.colors.reference;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}
