// ROI periorbitarias a partir de los landmarks. Trabaja en píxeles del frame completo
// (las ROI se recortan a resolución completa en la fase 4, no del recorte del modelo).
//
// Regiones por lado (lado del paciente): párpado superior, párpado inferior, ceja y canto
// externo, más una ROI de referencia rígida (dorso nasal). Los párpados y la ceja salen de
// contornos oficiales del mallado; el canto externo NO es una región oficial: es una caja
// derivada, anclada a la comisura externa. Las proporciones de abajo son provisionales y se
// ajustan al ver las ROI en el móvil.

import { EYES, NASAL_DORSUM, FACE_WIDTH, EAR_PAIR_POSITIONS, CENTER_PAIR_POSITION } from './indices.js';
import { SIDES, patientSide } from './laterality.js';

/** Proporciones respecto al ancho del ojo (distancia entre comisuras). */
export const PROPORTIONS = {
  upperLidPad: 0.3, // el párpado superior se extiende hacia arriba hasta el pliegue
  lowerLidPad: 0.22, // y el inferior, hacia abajo
  browPad: 0.12,
  canthusOffset: 0.3, // centro del canto externo: hacia fuera de la comisura externa
  canthusHalf: 0.28, // medio lado de la caja del canto externo
  referenceHalfWidth: 0.2, // medio ancho del dorso nasal, respecto a la distancia intercantal
};

const pt = (lm, i, f) => ({ x: lm[i].x * f.width, y: lm[i].y * f.height });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v) => {
  const n = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / n, y: v.y / n };
};
const centroid = (pts) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** Envolvente convexa (cadena monótona). */
export function hull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function bbox(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const roi = (polygon) => ({ polygon, box: bbox(polygon) });

/** Región = contorno + el mismo contorno desplazado `pad` en la dirección `n`. */
const lidRoi = (chain, n, pad) => roi(hull([...chain, ...chain.map((p) => add(p, n, pad))]));

function eyeRois(lm, f, eye, intercanthal) {
  const outer = pt(lm, eye.outer, f);
  const inner = pt(lm, eye.inner, f);
  const upper = eye.upper.map((i) => pt(lm, i, f));
  const lower = eye.lower.map((i) => pt(lm, i, f));
  const width = dist(outer, inner);
  const along = unit(sub(inner, outer)); // de la comisura externa a la interna
  const up = unit(sub(centroid(upper), centroid(lower))); // del párpado inferior al superior
  const P = PROPORTIONS;

  const center = add(outer, along, -P.canthusOffset * width);
  const a = P.canthusHalf * width;
  const canthus = roi([
    add(add(center, along, -a), up, a),
    add(add(center, along, a), up, a),
    add(add(center, along, a), up, -a),
    add(add(center, along, -a), up, -a),
  ]);

  // EAR de 6 puntos y apertura central normalizada a la distancia intercantal.
  const gap = (k) => dist(upper[k], lower[k]);
  const ear = EAR_PAIR_POSITIONS.reduce((sum, k) => sum + gap(k), 0) / (EAR_PAIR_POSITIONS.length * width);
  const brow = hull(eye.brow.map((i) => pt(lm, i, f)));
  const browC = centroid(brow);
  return {
    upperLid: lidRoi(upper, up, P.upperLidPad * width),
    lowerLid: lidRoi(lower, up, -P.lowerLidPad * width),
    brow: roi(hull([...brow, ...brow.map((p) => add(p, unit(sub(p, browC)), P.browPad * width))])),
    canthus,
    eyeWidth: width,
    /** EAR: apertura vertical media / ancho del ojo (comisura a comisura). ≈ 0,25–0,35 con el ojo abierto. */
    ear,
    /** Apertura palpebral central / distancia intercantal (comisuras internas de los dos ojos). */
    aperture: gap(CENTER_PAIR_POSITION) / intercanthal,
  };
}

/**
 * ROI de un frame.
 * @param {{x:number,y:number}[]} lm landmarks normalizados (0–1) del frame
 * @param {{width:number,height:number}} frame tamaño del frame en píxeles
 * @param {{frameMirrored?: boolean}} opts la imagen ANALIZADA va en espejo
 * @returns {{left: object, right: object, reference: object, meta: object}} por lado del PACIENTE
 */
export function buildRois(lm, frame, { frameMirrored = false } = {}) {
  const out = {};
  const intercanthal = dist(pt(lm, EYES.right.inner, frame), pt(lm, EYES.left.inner, frame));
  for (const meshSide of SIDES) {
    out[patientSide(meshSide, frameMirrored)] = eyeRois(lm, frame, EYES[meshSide], intercanthal);
  }

  const dorsum = NASAL_DORSUM.map((i) => pt(lm, i, frame));
  const axis = unit(sub(dorsum[dorsum.length - 1], dorsum[0]));
  const side = { x: -axis.y, y: axis.x };
  const half = PROPORTIONS.referenceHalfWidth * intercanthal;
  out.reference = roi([
    add(dorsum[0], side, half),
    add(dorsum[0], side, -half),
    add(dorsum[dorsum.length - 1], side, -half),
    add(dorsum[dorsum.length - 1], side, half),
  ]);

  const faceWidth = dist(pt(lm, FACE_WIDTH.right, frame), pt(lm, FACE_WIDTH.left, frame));
  out.meta = {
    intercanthal,
    faceWidth,
    // Fracción del lado corto del frame que ocupa la cara (para avisar de cara pequeña).
    faceRatio: faceWidth / Math.min(frame.width, frame.height),
  };
  return out;
}
