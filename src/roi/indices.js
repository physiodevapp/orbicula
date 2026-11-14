// Índices de landmarks del mallado canónico de MediaPipe Face Landmarker (478 puntos).
//
// FUENTE: no están inventados. Salen de las conexiones oficiales del mallado:
//   https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py
//   (FACEMESH_RIGHT_EYE, FACEMESH_LEFT_EYE, FACEMESH_RIGHT_EYEBROW, FACEMESH_LEFT_EYEBROW,
//    FACEMESH_NOSE y FACEMESH_FACE_OVAL), consultado el 2026-11-07. Las cadenas de los
//   párpados se ordenan siguiendo las aristas de esos conjuntos, de comisura a comisura.
//
// LADO («mesh»): el nombre RIGHT/LEFT es el del mallado, no el del paciente. El modelo es
// agnóstico a la quiralidad: asigna los índices RIGHT_* al ojo que queda a la IZQUIERDA de la
// imagen analizada. En una imagen sin espejo (la que entrega getUserMedia, también con la
// cámara frontal) ese ojo es el derecho del paciente; si la imagen analizada va en espejo,
// es el izquierdo. Esa traducción vive solo en `laterality.js`.

/** Ojo derecho del mallado (a la izquierda de la imagen sin espejo). */
const RIGHT_EYE = {
  outer: 33, // comisura externa (temporal)
  inner: 133, // comisura interna (nasal)
  upper: [33, 246, 161, 160, 159, 158, 157, 173, 133], // párpado superior, de externa a interna
  lower: [33, 7, 163, 144, 145, 153, 154, 155, 133], // párpado inferior, de externa a interna
  brow: [70, 63, 105, 66, 107, 46, 53, 52, 65, 55], // FACEMESH_RIGHT_EYEBROW (las dos cadenas)
};

/** Ojo izquierdo del mallado (a la derecha de la imagen sin espejo). */
const LEFT_EYE = {
  outer: 263,
  inner: 362,
  upper: [263, 466, 388, 387, 386, 385, 384, 398, 362],
  lower: [263, 249, 390, 373, 374, 380, 381, 382, 362],
  brow: [300, 293, 334, 296, 336, 276, 283, 282, 295, 285], // FACEMESH_LEFT_EYEBROW
};

export const EYES = { right: RIGHT_EYE, left: LEFT_EYE };

/**
 * Pares de puntos (párpado superior, párpado inferior) del EAR de 6 puntos (Soukupová y Čech):
 *   EAR = (|p2−p6| + |p3−p5|) / (2·|p1−p4|)
 * con p1 = comisura externa, p4 = interna, p2/p3 = superiores y p6/p5 = inferiores.
 * Son las posiciones 3 y 5 de cada cadena de párpado (160↔144 y 158↔153 en el ojo derecho;
 * 387↔373 y 385↔380 en el izquierdo), que quedan a la misma altura horizontal. El par
 * central (posición 4: 159↔145 y 386↔374) da la apertura palpebral en el centro del ojo.
 */
export const EAR_PAIR_POSITIONS = [3, 5];
export const CENTER_PAIR_POSITION = 4;

/**
 * Dorso nasal (referencia rígida para compensar la cabeza): cadena central de
 * FACEMESH_NOSE, de la glabela al final del dorso. Se deja fuera la punta (5, 4, 1…),
 * que se mueve con las expresiones.
 */
export const NASAL_DORSUM = [168, 6, 197, 195];

/** Extremos laterales del óvalo facial (FACEMESH_FACE_OVAL): anchura de la cara. */
export const FACE_WIDTH = { right: 234, left: 454 };

/**
 * Centros del iris: 468 y 473 (el modelo del iris añade 10 puntos al mallado, 468–477; las
 * conexiones oficiales FACEMESH_RIGHT_IRIS = 469–472 y FACEMESH_LEFT_IRIS = 474–477 rodean a
 * 468 y 473). Cada centro se asigna al ojo más cercano, sin depender del nombre del lado.
 */
export const IRIS_CENTERS = [468, 473];

/**
 * Puntos estables para estimar el movimiento rígido de la cabeza (compensación «postura»):
 * el dorso nasal, los extremos laterales del óvalo facial y el punto superior del óvalo (10,
 * línea media de la frente junto al nacimiento del pelo; primer índice de FACEMESH_FACE_OVAL).
 * Ninguno está en los párpados ni en las cejas.
 */
export const POSE_POINTS = [...NASAL_DORSUM, 234, 454, 10];

/**
 * Comisuras de la boca: 61 y 291, los extremos de FACEMESH_LIPS (las cadenas exterior superior e inferior de
 * los labios empiezan en 61 y acaban en 291). El lado de cada una no se toma del índice: se asigna al ojo más
 * cercano (como el iris), así que no depende del nombre del lado del mallado.
 */
export const MOUTH_CORNERS = [61, 291];
/** Número de landmarks que devuelve el modelo (468 del mallado + 10 del iris). */
export const LANDMARK_COUNT = 478;

/** Todos los índices usados, por si hace falta comprobar que el modelo los devuelve. */
export const ALL_USED = [
  ...new Set([
    ...Object.values(EYES).flatMap((e) => [e.outer, e.inner, ...e.upper, ...e.lower, ...e.brow]),
    ...NASAL_DORSUM,
    FACE_WIDTH.right,
    FACE_WIDTH.left,
    ...IRIS_CENTERS,
    ...POSE_POINTS,
    ...MOUTH_CORNERS,
  ]),
];
