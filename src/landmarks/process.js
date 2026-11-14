// De la salida de MediaPipe a lo que usa la app: ROI y blendshapes por lado del paciente.
// Función pura: la usan igual el worker y el respaldo en el hilo principal.
import { buildRois } from '../roi/geometry.js';
import { sidedBlendshapes } from '../roi/laterality.js';

/**
 * @param {{faceLandmarks?: object[][], faceBlendshapes?: {categories: object[]}[]}} res salida de detectForVideo
 * @param {{width:number,height:number}} frame tamaño en píxeles del frame COMPLETO de la cámara
 *   (los landmarks son normalizados: valen igual para una copia reducida del frame)
 * @param {{frameMirrored?: boolean, swapNames?: boolean}} opts
 */
export function processResult(res, frame, { frameMirrored = false, swapNames = false } = {}) {
  const lm = res.faceLandmarks?.[0];
  if (!lm) return { frame, face: false };
  return {
    frame,
    face: true,
    rois: buildRois(lm, frame, { frameMirrored }),
    blend: sidedBlendshapes(res.faceBlendshapes?.[0]?.categories, { frameMirrored, swapNames }),
  };
}

/** Muestra de métricas por lado para las series y los detectores (null si no hay cara). */
export function sampleOf(result) {
  if (!result.face) return null;
  const side = (s) => ({
    ear: result.rois[s].ear,
    aperture: result.rois[s].aperture,
    blink: result.blend[s].eyeBlink ?? NaN,
    // Mirada arriba/abajo del modelo: para estudiar los falsos cierres al mirar hacia abajo.
    lookDown: result.blend[s].eyeLookDown ?? NaN,
    lookUp: result.blend[s].eyeLookUp ?? NaN,
    // Posición del iris en el ojo (ver geometry.js): para estudiar la mirada sin blendshapes.
    irisH: result.rois[s].iris?.h ?? NaN,
    irisV: result.rois[s].iris?.v ?? NaN,
    // Sonrisa de ese lado de la boca (blendshape mouthSmile): para la co-activación ojo–boca (fase 5).
    smile: result.blend[s].mouthSmile ?? NaN,
  });
  // Tamaño del ojo en píxeles (media de los dos): con la cara pequeña, el ruido parece movimiento de la cabeza.
  const eyePx = (result.rois.left.eyeWidth + result.rois.right.eyeWidth) / 2;
  return { left: side('left'), right: side('right'), eyePx: Number.isFinite(eyePx) ? eyePx : NaN };
}
