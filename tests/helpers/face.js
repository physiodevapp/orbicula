// Cara sintética de frente para los tests, tal como la etiqueta el modelo en una imagen SIN
// espejo: el ojo «right» del mallado a la izquierda de la imagen, el «left» a la derecha.
// `openRight`/`openLeft` = apertura de cada ojo (0 = cerrado). `smileRight`/`smileLeft` = cuánto se va la
// comisura de la boca de ese lado del mallado hacia fuera y hacia arriba (en fracción de la imagen).
import { EYES, NASAL_DORSUM, LANDMARK_COUNT, MOUTH_CORNERS } from '../../src/roi/indices.js';

export function makeFace({ openRight = 1, openLeft = 1, smileRight = 0, smileLeft = 0 } = {}) {
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
  // Comisuras: 61 a la izquierda de la imagen (lado «right» del mallado), 291 a la derecha.
  set(MOUTH_CORNERS[0], 0.42 - smileRight, 0.65 - smileRight);
  set(MOUTH_CORNERS[1], 0.58 + smileLeft, 0.65 - smileLeft);
  return lm;
}
