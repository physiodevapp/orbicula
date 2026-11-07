// Franja periocular: el rectángulo del frame completo que se recorta para el flujo óptico.
// Funciones puras (sin DOM): las usa el cliente del worker de flujo y se prueban en tests/flow.test.js.
//
// La franja abarca los dos ojos, las cejas, los cantos externos y el dorso nasal, con un margen.
// El flujo se calcula entre dos frames con EL MISMO recorte: la franja solo se recoloca cuando la
// cara se sale de ella (o se aleja mucho), y el par de frames de ese cambio no se mide.

const ROI_NAMES = ['upperLid', 'lowerLid', 'brow', 'canthus'];

/** Margen alrededor de las ROI, en distancias intercantales. */
export const STRIP_MARGIN = 0.35;
/** Si las ROI ocupan menos de esta fracción del ancho de la franja (la cara se alejó), se recoloca. */
export const MIN_FILL = 0.6;

/** Caja que envuelve todas las ROI (ambos lados y la referencia), en píxeles del frame completo. */
export function roiCore(rois) {
  const boxes = [rois.reference.box];
  for (const side of ['left', 'right']) for (const n of ROI_NAMES) boxes.push(rois[side][n].box);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const even = (v) => 2 * Math.round(v / 2);

/**
 * Franja nueva para unas ROI: su caja con un margen, recortada al frame y con lados pares.
 * @returns {{x:number,y:number,w:number,h:number}|null} null si no queda nada dentro del frame
 */
export function stripFromRois(rois, frame, { margin = STRIP_MARGIN } = {}) {
  const core = roiCore(rois);
  const m = margin * rois.meta.intercanthal;
  const x0 = Math.max(0, Math.floor(core.x - m));
  const y0 = Math.max(0, Math.floor(core.y - m));
  const x1 = Math.min(frame.width, Math.ceil(core.x + core.w + m));
  const y1 = Math.min(frame.height, Math.ceil(core.y + core.h + m));
  const w = Math.min(even(x1 - x0), frame.width - x0);
  const h = Math.min(even(y1 - y0), frame.height - y0);
  if (w < 16 || h < 16) return null;
  return { x: x0, y: y0, w, h };
}

const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/**
 * ¿Hay que recolocar la franja? Sí si no hay franja, si las ROI se salen de ella o si ocupan
 * demasiado poco (la cara se alejó: se perdería resolución).
 */
export function needsNewStrip(strip, rois) {
  if (!strip) return true;
  const core = roiCore(rois);
  return !inside(core, strip) || core.w < MIN_FILL * strip.w;
}

/**
 * Tamaño de trabajo del recorte: el ancho se limita a `maxWidth` (0 = sin reducir, hasta `cap`).
 * Lados pares; la escala es la misma en los dos ejes.
 */
export function workingSize(strip, maxWidth, { cap = 1280 } = {}) {
  const limit = maxWidth > 0 ? maxWidth : cap;
  const scale = Math.min(1, limit / strip.w);
  return { width: Math.max(16, even(strip.w * scale)), height: Math.max(16, even(strip.h * scale)), scale };
}
