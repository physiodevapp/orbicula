import { describe, it, expect } from 'vitest';
import { EYES, NASAL_DORSUM, ALL_USED, LANDMARK_COUNT } from '../src/roi/indices.js';
import { buildRois, hull } from '../src/roi/geometry.js';
import { patientSide, sidedBlendshapes } from '../src/roi/laterality.js';
import { contentRect, toDisplay } from '../src/ui/display.js';

const FRAME = { width: 720, height: 1280 };

/**
 * Cara sintética de frente, tal como la etiqueta el modelo en una imagen SIN espejo:
 * el ojo «right» del mallado a la izquierda de la imagen, el «left» a la derecha.
 * `open` = apertura de cada ojo (0 = cerrado).
 */
function makeFace({ openRight = 1, openLeft = 1 } = {}) {
  const lm = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i, x, y) => (lm[i] = { x, y, z: 0 });
  const eye = (e, outerX, innerX, open) => {
    const chain = (ids, dir) =>
      ids.forEach((id, k) => {
        const t = k / (ids.length - 1);
        set(id, outerX + t * (innerX - outerX), 0.4 + dir * 0.02 * open * Math.sin(Math.PI * t));
      });
    chain(e.upper, -1);
    chain(e.lower, 1);
    e.brow.forEach((id, k) => {
      const t = (k % 5) / 4;
      set(id, outerX + t * (innerX - outerX), k < 5 ? 0.3 : 0.32);
    });
  };
  eye(EYES.right, 0.3, 0.43, openRight);
  eye(EYES.left, 0.7, 0.57, openLeft);
  NASAL_DORSUM.forEach((id, k) => set(id, 0.5, 0.4 + k * 0.05));
  set(234, 0.15, 0.55);
  set(454, 0.85, 0.55);
  return lm;
}

const centerX = (r) => r.box.x + r.box.w / 2;

describe('índices del mallado', () => {
  it('están dentro del rango y sin repetir dentro de cada cadena', () => {
    for (const i of ALL_USED) {
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(LANDMARK_COUNT);
    }
    for (const e of Object.values(EYES)) {
      for (const chain of [e.upper, e.lower, e.brow]) expect(new Set(chain).size).toBe(chain.length);
      expect(e.upper[0]).toBe(e.outer);
      expect(e.lower[0]).toBe(e.outer);
      expect(e.upper.at(-1)).toBe(e.inner);
      expect(e.lower.at(-1)).toBe(e.inner);
    }
  });

  it('los dos ojos no comparten ningún índice', () => {
    const a = new Set([...EYES.right.upper, ...EYES.right.lower, ...EYES.right.brow]);
    const b = [...EYES.left.upper, ...EYES.left.lower, ...EYES.left.brow];
    expect(b.some((i) => a.has(i))).toBe(false);
  });
});

describe('geometría de las ROI', () => {
  it('hull devuelve el cuadrado de un cuadrado con puntos interiores', () => {
    const h = hull([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 2, y: 2 }, { x: 1, y: 3 },
    ]);
    expect(h).toHaveLength(4);
  });

  it('todas las ROI tienen área y el párpado superior queda sobre el inferior', () => {
    const rois = buildRois(makeFace(), FRAME);
    for (const side of ['left', 'right']) {
      for (const name of ['upperLid', 'lowerLid', 'brow', 'canthus']) {
        expect(rois[side][name].box.w).toBeGreaterThan(0);
        expect(rois[side][name].box.h).toBeGreaterThan(0);
      }
      expect(rois[side].upperLid.box.y).toBeLessThan(rois[side].lowerLid.box.y);
      expect(rois[side].brow.box.y + rois[side].brow.box.h).toBeLessThan(rois[side].upperLid.box.y + rois[side].upperLid.box.h);
    }
    expect(rois.reference.box.h).toBeGreaterThan(0);
  });

  it('el canto externo queda fuera de la comisura externa, no sobre el ojo', () => {
    const rois = buildRois(makeFace(), FRAME);
    const f = makeFace();
    // Sin espejo: el ojo derecho del paciente está a la izquierda de la imagen.
    expect(centerX(rois.right.canthus)).toBeLessThan(f[EYES.right.outer].x * FRAME.width);
    expect(centerX(rois.left.canthus)).toBeGreaterThan(f[EYES.left.outer].x * FRAME.width);
  });
});

describe('lateralidad (a la cara del paciente)', () => {
  it('patientSide invierte solo si la imagen analizada va en espejo', () => {
    expect(patientSide('right', false)).toBe('right');
    expect(patientSide('right', true)).toBe('left');
    expect(patientSide('left', true)).toBe('right');
  });

  it('sin espejo: el derecho del paciente queda a la izquierda de la imagen', () => {
    const rois = buildRois(makeFace(), FRAME, { frameMirrored: false });
    expect(centerX(rois.right.upperLid)).toBeLessThan(FRAME.width / 2);
    expect(centerX(rois.left.upperLid)).toBeGreaterThan(FRAME.width / 2);
  });

  it('con espejo: el derecho del paciente queda a la derecha de la imagen', () => {
    const rois = buildRois(makeFace(), FRAME, { frameMirrored: true });
    expect(centerX(rois.right.upperLid)).toBeGreaterThan(FRAME.width / 2);
    expect(centerX(rois.left.upperLid)).toBeLessThan(FRAME.width / 2);
  });

  it('un cierre del ojo de la izquierda de la imagen es el derecho sin espejo y el izquierdo con espejo', () => {
    const face = makeFace({ openRight: 0.05, openLeft: 1 }); // se cierra el ojo «right» del mallado
    const plain = buildRois(face, FRAME, { frameMirrored: false });
    expect(plain.right.opening).toBeLessThan(plain.left.opening);
    const mirrored = buildRois(face, FRAME, { frameMirrored: true });
    expect(mirrored.left.opening).toBeLessThan(mirrored.right.opening);
  });

  it('blendshapes: se asignan al lado del paciente y se corrigen con el espejo', () => {
    const cats = [
      { categoryName: 'eyeBlinkRight', score: 0.9 },
      { categoryName: 'eyeBlinkLeft', score: 0.05 },
      { categoryName: 'mouthSmileLeft', score: 0.4 },
      { categoryName: 'jawOpen', score: 0.7 }, // sin lado: se ignora
    ];
    const plain = sidedBlendshapes(cats, { frameMirrored: false });
    expect(plain.right.eyeBlink).toBe(0.9);
    expect(plain.left.eyeBlink).toBe(0.05);
    expect(plain.left.mouthSmile).toBe(0.4);
    expect(plain.left.jawOpen).toBeUndefined();

    const mirrored = sidedBlendshapes(cats, { frameMirrored: true });
    expect(mirrored.left.eyeBlink).toBe(0.9);
    expect(mirrored.right.eyeBlink).toBe(0.05);
    expect(mirrored.right.mouthSmile).toBe(0.4);
  });

  it('swapNames invierte la asignación de los nombres Left/Right de los blendshapes', () => {
    const cats = [{ categoryName: 'eyeBlinkRight', score: 0.9 }];
    expect(sidedBlendshapes(cats, { swapNames: true }).left.eyeBlink).toBe(0.9);
    expect(sidedBlendshapes(cats, { swapNames: true, frameMirrored: true }).right.eyeBlink).toBe(0.9);
  });

  it('ROI y blendshapes coinciden: el ojo que se cierra y su blendshape caen en el mismo lado', () => {
    const face = makeFace({ openRight: 0.05, openLeft: 1 });
    const cats = [
      { categoryName: 'eyeBlinkRight', score: 0.95 }, // el modelo, coherente con el mallado
      { categoryName: 'eyeBlinkLeft', score: 0.02 },
    ];
    for (const frameMirrored of [false, true]) {
      const rois = buildRois(face, FRAME, { frameMirrored });
      const bs = sidedBlendshapes(cats, { frameMirrored });
      const closedByRoi = rois.right.opening < rois.left.opening ? 'right' : 'left';
      const closedByBlend = bs.right.eyeBlink > bs.left.eyeBlink ? 'right' : 'left';
      expect(closedByRoi).toBe(closedByBlend);
    }
  });
});

describe('dibujo (display)', () => {
  const rect = contentRect(380, 380, 720, 1280); // vertical dentro de un marco cuadrado
  it('contentRect centra el vídeo con barras a los lados', () => {
    expect(rect.h).toBeCloseTo(380);
    expect(rect.w).toBeCloseTo((720 / 1280) * 380);
    expect(rect.x).toBeCloseTo((380 - rect.w) / 2);
  });
  it('toDisplay invierte en x solo con la vista en espejo', () => {
    const p = { x: 0, y: 0 };
    expect(toDisplay(p, rect, false).x).toBeCloseTo(rect.x);
    expect(toDisplay(p, rect, true).x).toBeCloseTo(rect.x + rect.w);
    expect(toDisplay({ x: 720, y: 1280 }, rect, true).x).toBeCloseTo(rect.x);
  });
});
