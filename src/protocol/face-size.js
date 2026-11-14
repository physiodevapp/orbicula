// Tamaño de la cara en la imagen, medido por lo que importa: los PÍXELES del ojo. El ruido de la cámara y del
// flujo es casi fijo en píxeles; con el ojo pequeño, ese mismo ruido pasa a ser mucho «movimiento de la
// cabeza» (en distancias intercantales por segundo). Una proporción del encuadre no sirve: depende de la
// resolución. Sin DOM.
//
// Dos observaciones del autor, en una webcam de ordenador: con el ojo a ~50 px el reposo fallaba siempre
// («la cabeza se ha movido»); a ~70 px y con más luz calibró a la primera. El umbral es PROVISIONAL: cada
// sesión guarda el tamaño del ojo (`quality.<fase>.eyePx` en el JSON público) para ajustarlo con datos.
export const MIN_EYE_PX = 60;
/** Para quitar el aviso hace falta pasar el umbral por esto, y que no parpadee al rondarlo. */
export const EYE_HYSTERESIS_PX = 4;

const median = (a) => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/** Mediana de los píxeles del ojo de una serie (null si no hay ninguno). */
export function medianEyePx(series) {
  const m = median(series ?? []);
  return m == null ? null : Math.round(m);
}

/** ¿La cara es pequeña? Con histéresis: una vez pequeña, deja de serlo al pasar el umbral con margen. */
export function isSmallFace(eyePx, wasSmall = false) {
  if (!Number.isFinite(eyePx)) return false;
  return eyePx < MIN_EYE_PX + (wasSmall ? EYE_HYSTERESIS_PX : 0);
}

/** Texto del aviso en pantalla. */
export const smallFaceText = (eyePx) => `Cara pequeña: acerca el móvil o la cara (el ojo mide ${Math.round(eyePx)} px; conviene más de ${MIN_EYE_PX}).`;
/** Lo que dice la voz (siempre «tú»). */
export const SMALL_FACE_SAY = 'Cara pequeña. Acércate un poco.';
