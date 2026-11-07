// Configuraciones del flujo óptico que se comparan en la prueba de rendimiento.
// Las comparten el hilo principal y el worker de flujo.
//
// - method: 'farneback' (flujo denso, un vector por píxel; la opción del plan) o 'lk' (Lucas-Kanade
//   piramidal sobre una rejilla). DIS no está disponible: OpenCV.js 5.0.0 exporta solo sus constantes.
// - maxWidth: ancho máximo de la franja recortada (0 = sin reducir, hasta 1280 px).
// - params: 'standard' o 'lite' (Farnebäck con menos niveles, ventana e iteraciones; para
//   desplazamientos de 1–2 px no hacen falta los niveles gruesos de la pirámide).
// - source: de dónde sale la imagen en grises.
//     'bitmap': recorte con createImageBitmap en el hilo principal y lectura RGBA en el worker
//               (fase 4a: la lectura costaba 15–17 ms a 720p y 25–65 ms a 4K).
//     'videoframe': el frame de la cámara pasa al worker como VideoFrame y se copia solo el plano
//               de brillo (Y) de la franja, que ya es la imagen en grises. Si el frame no está en un
//               formato YUV legible, el worker recorta con createImageBitmap (se anota).
// - maxRate: pares por segundo como máximo (0 = sin límite), para dejar procesador a MediaPipe.

export const OPENCV_VERSION = '5.0.0-release.1';

/** Parámetros de Farnebäck (pyrScale, levels, winsize, iterations, polyN, polySigma). Provisionales. */
export const FARNEBACK = { pyrScale: 0.5, levels: 3, winsize: 13, iterations: 3, polyN: 5, polySigma: 1.1 };
export const FARNEBACK_LITE = { pyrScale: 0.5, levels: 2, winsize: 9, iterations: 2, polyN: 5, polySigma: 1.1 };
export const FARNEBACK_PARAMS = { standard: FARNEBACK, lite: FARNEBACK_LITE };
/** Lucas-Kanade: separación de la rejilla (px de trabajo), ventana y niveles de la pirámide. */
export const LUCAS_KANADE = { gridStep: 8, winSize: 15, maxLevel: 2 };

const cfg = (key, label, short, o) => ({ key, label, short, maxWidth: 0, params: 'standard', source: 'bitmap', maxRate: 0, ...o });

export const FLOW_CONFIGS = {
  none: cfg('none', 'Sin flujo', 'ninguno', { method: 'none' }),
  'farneback-320': cfg('farneback-320', 'Farnebäck · 320 px', 'Farn. 320', { method: 'farneback', maxWidth: 320 }),
  'farneback-320-vf': cfg('farneback-320-vf', 'Farnebäck · 320 px · plano Y', 'Farn. Y', { method: 'farneback', maxWidth: 320, source: 'videoframe' }),
  'lite-320-vf': cfg('lite-320-vf', 'Farnebäck ligero · 320 px · plano Y', 'Ligero Y', { method: 'farneback', maxWidth: 320, params: 'lite', source: 'videoframe' }),
  'farneback-320-vf-30': cfg('farneback-320-vf-30', 'Farnebäck · 320 px · plano Y · 30/s', 'Farn. Y 30/s', { method: 'farneback', maxWidth: 320, source: 'videoframe', maxRate: 30 }),
  'lite-320-vf-30': cfg('lite-320-vf-30', 'Farnebäck ligero · 320 px · plano Y · 30/s', 'Ligero Y 30/s', { method: 'farneback', maxWidth: 320, params: 'lite', source: 'videoframe', maxRate: 30 }),
  'farneback-640': cfg('farneback-640', 'Farnebäck · 640 px', 'Farn. 640', { method: 'farneback', maxWidth: 640 }),
  'farneback-full': cfg('farneback-full', 'Farnebäck · sin reducir', 'Farn. máx.', { method: 'farneback' }),
  'lk-640': cfg('lk-640', 'Lucas-Kanade · 640 px', 'LK 640', { method: 'lk', maxWidth: 640 }),
};

/**
 * Punto de trabajo (4a bis, trasera «fps» en el móvil del autor): leer el plano Y bajó la copia de
 * 15 a 1,2 ms; el Farnebäck ligero apenas ahorraba (19 frente a 20 ms) y se descarta; el límite de
 * 30 pares/s deja más procesador al análisis de la cara.
 */
export const DEFAULT_FLOW = 'farneback-320-vf-30';
