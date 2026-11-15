// ROI periorbitarias a partir de los landmarks. Trabaja en píxeles del frame completo
// (las ROI se recortan a resolución completa en la fase 4, no del recorte del modelo).
//
// Regiones por lado (lado del paciente): párpado superior, párpado inferior, ceja y canto
// externo, más una ROI de referencia rígida (dorso nasal). Los párpados y la ceja salen de
// contornos oficiales del mallado; el canto externo NO es una región oficial: es una caja
// derivada, anclada a la comisura externa. Las proporciones de abajo son provisionales y se
// ajustan al ver las ROI en el móvil.

import { EYES, NASAL_DORSUM, FACE_WIDTH, EAR_PAIR_POSITIONS, CENTER_PAIR_POSITION, IRIS_CENTERS, POSE_POINTS, MOUTH_CORNERS } from './indices.js';
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

/**
 * Posición del iris dentro del ojo, normalizada al ancho del ojo:
 *   h: a lo largo del eje de las comisuras, 0 = comisura interna, 1 = externa (≈ 0,5 mirando al frente);
 *   v: perpendicular, positivo hacia abajo (mirada hacia abajo).
 * El centro del iris se toma de entre los dos que da el modelo, el más cercano a este ojo.
 */
function irisPosition(lm, f, inner, outer, down) {
  if (lm.length <= Math.max(...IRIS_CENTERS)) return null;
  const mid = { x: (inner.x + outer.x) / 2, y: (inner.y + outer.y) / 2 };
  const [c] = IRIS_CENTERS.map((i) => pt(lm, i, f)).sort((a, b) => dist(a, mid) - dist(b, mid));
  const axis = sub(outer, inner);
  const w2 = axis.x * axis.x + axis.y * axis.y || 1;
  const rel = sub(c, inner);
  return {
    h: (rel.x * axis.x + rel.y * axis.y) / w2,
    v: ((c.x - mid.x) * down.x + (c.y - mid.y) * down.y) / Math.sqrt(w2),
  };
}

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
    /**
     * Ejes del ojo en la imagen (vectores unitarios), para dar signo al flujo: `temple` va de la
     * comisura interna a la externa (hacia la sien) y `down` del párpado superior al inferior.
     * Salen de la propia cara, así que valen igual con espejo o sin él y con la cabeza inclinada.
     */
    axes: { temple: { x: -along.x, y: -along.y }, down: { x: -up.x, y: -up.y } },
    iris: irisPosition(lm, f, inner, outer, { x: -up.x, y: -up.y }),
  };
}

/**
 * Posición de las comisuras de la boca en un sistema de la propia cara, en 3D (z del modelo en la escala de x):
 *   origen: punto medio de las comisuras internas de los ojos;
 *   `out`: hacia fuera, por el lado de esa comisura (eje entre las comisuras internas de los ojos);
 *   `up`: hacia arriba (del dorso nasal a la glabela, sin la parte que va a lo largo de `out`);
 *   unidad: la distancia intercantal (3D).
 * Así no cambia con la distancia a la cámara, la inclinación de la cabeza ni, en primera aproximación, el giro:
 * en 2D, con la cabeza girada, la comisura del lado lejano parecería más cerca de la línea media. La sonrisa
 * lleva la comisura hacia fuera (+out) y arriba (+up). Lo que se mide es el cambio respecto al reposo
 * (src/protocol/summary.js), no la posición absoluta.
 * @returns {Record<'right'|'left', {out:number, up:number}> | null} por lado del MALLADO
 */
function mouthCorners(lm, f) {
  if (lm.length <= Math.max(...MOUTH_CORNERS)) return null;
  const p3 = (i) => ({ x: lm[i].x * f.width, y: lm[i].y * f.height, z: (lm[i].z ?? 0) * f.width });
  const s3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len3 = (a) => Math.sqrt(dot3(a, a));
  const ir = p3(EYES.right.inner);
  const il = p3(EYES.left.inner);
  const o = { x: (ir.x + il.x) / 2, y: (ir.y + il.y) / 2, z: (ir.z + il.z) / 2 };
  const across = s3(il, ir); // del ojo derecho del mallado al izquierdo
  const scale = len3(across);
  if (!(scale > 0)) return null;
  const ax = { x: across.x / scale, y: across.y / scale, z: across.z / scale };
  // «Arriba»: del final del dorso nasal a la glabela, quitándole la componente a lo largo de `ax`.
  const raw = s3(p3(NASAL_DORSUM[0]), p3(NASAL_DORSUM[NASAL_DORSUM.length - 1]));
  const k = dot3(raw, ax);
  const upv = { x: raw.x - k * ax.x, y: raw.y - k * ax.y, z: raw.z - k * ax.z };
  const ul = len3(upv);
  if (!(ul > 0)) return null;
  const ay = { x: upv.x / ul, y: upv.y / ul, z: upv.z / ul };
  const outer = { right: p3(EYES.right.outer), left: p3(EYES.left.outer) };
  const out = {};
  for (const i of MOUTH_CORNERS) {
    const c = p3(i);
    const side = len3(s3(c, outer.right)) <= len3(s3(c, outer.left)) ? 'right' : 'left';
    const v = s3(c, o);
    const along = dot3(v, ax) / scale; // + hacia el ojo izquierdo del mallado
    out[side] = { out: side === 'left' ? along : -along, up: dot3(v, ay) / scale, px: { x: c.x, y: c.y } }; // px: para dibujarla
  }
  return out.left && out.right ? out : null;
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
  // Puntos estables (píxeles del frame) para estimar el movimiento rígido de la cabeza.
  out.pose = POSE_POINTS.map((i) => pt(lm, i, frame));
  // Lo mismo en 3D (z del modelo, en la escala de x: píxeles del ancho) y un punto 3D por ROI:
  // la compensación «dorso nasal + giro» estima con ellos cuánto se mueve cada ROI respecto al dorso
  // nasal cuando la cabeza gira (las regiones laterales están más atrás y se mueven distinto).
  const p3 = (i) => ({ x: lm[i].x * frame.width, y: lm[i].y * frame.height, z: (lm[i].z ?? 0) * frame.width });
  const mean3 = (ids) => {
    const ps = ids.map(p3);
    return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length, z: ps.reduce((s, p) => s + p.z, 0) / ps.length };
  };
  out.pose3d = POSE_POINTS.map(p3);
  out.anchors3d = { reference: mean3(NASAL_DORSUM) };
  for (const meshSide of SIDES) {
    const e = EYES[meshSide];
    out.anchors3d[patientSide(meshSide, frameMirrored)] = { upperLid: mean3(e.upper), lowerLid: mean3(e.lower), brow: mean3(e.brow), canthus: p3(e.outer) };
  }

  // Comisuras de la boca por lado del paciente (o null si el modelo no da los puntos).
  const corners = mouthCorners(lm, frame);
  out.mouth = corners ? { [patientSide('left', frameMirrored)]: corners.left, [patientSide('right', frameMirrored)]: corners.right } : null;

  out.meta = {
    intercanthal,
    faceWidth,
    // Fracción del lado corto del frame que ocupa la cara (para avisar de cara pequeña).
    faceRatio: faceWidth / Math.min(frame.width, frame.height),
  };
  return out;
}
