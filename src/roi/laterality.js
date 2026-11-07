// Lateralidad: izquierda y derecha son SIEMPRE las del paciente.
// Único sitio donde se traduce entre el lado del mallado/blendshapes y el del paciente.

export const SIDES = ['left', 'right'];

export const oppositeSide = (side) => (side === 'left' ? 'right' : 'left');

/**
 * Lado del paciente de algo que el modelo llama `meshSide`.
 * El modelo etiqueta por posición en la imagen que analiza: si esa imagen va en espejo
 * (p. ej. un vídeo de la cámara frontal guardado en espejo), el «derecho» del modelo es el
 * izquierdo del paciente.
 * @param {'left'|'right'} meshSide
 * @param {boolean} frameMirrored la imagen ANALIZADA va en espejo
 */
export function patientSide(meshSide, frameMirrored) {
  return frameMirrored ? oppositeSide(meshSide) : meshSide;
}

/**
 * Lado del mallado al que corresponde sufijo Left/Right de un blendshape (eyeBlinkLeft…).
 * Por defecto se supone que sigue el mismo criterio que los índices del mallado
 * (Left = LEFT_EYE). Si la comprobación con un guiño en el móvil dice lo contrario,
 * `swapNames` lo invierte sin tocar nada más.
 */
export function blendshapeMeshSide(suffix, swapNames = false) {
  const side = suffix === 'Left' ? 'left' : 'right';
  return swapNames ? oppositeSide(side) : side;
}

const SIDED = /^(.*?)(Left|Right)$/;

/**
 * Agrupa los blendshapes con lado por lado del PACIENTE.
 * @param {{categoryName:string, score:number}[]} categories
 * @returns {{left: Record<string, number>, right: Record<string, number>}}
 *   p. ej. `result.left.eyeBlink`, `result.right.mouthSmile`
 */
export function sidedBlendshapes(categories, { frameMirrored = false, swapNames = false } = {}) {
  const out = { left: {}, right: {} };
  for (const c of categories ?? []) {
    const m = SIDED.exec(c.categoryName);
    if (!m) continue;
    const side = patientSide(blendshapeMeshSide(m[2], swapNames), frameMirrored);
    out[side][m[1]] = c.score;
  }
  return out;
}
