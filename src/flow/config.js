// Configuraciones del flujo óptico que se comparan en la prueba de rendimiento (paso 4a).
// Las comparten el hilo principal y el worker de flujo.
//
// - Farnebäck: flujo denso (un vector por píxel). Es la opción del plan.
// - Lucas-Kanade piramidal sobre una rejilla de puntos: alternativa más barata si Farnebäck no
//   llega. DIS no está disponible: OpenCV.js 5.0.0 exporta solo sus constantes, no la clase.
//
// `maxWidth` es el ancho máximo de la franja recortada (0 = sin reducir, hasta 1280 px).

export const OPENCV_VERSION = '5.0.0-release.1';

/** Parámetros de Farnebäck (pyrScale, levels, winsize, iterations, polyN, polySigma). Provisionales. */
export const FARNEBACK = { pyrScale: 0.5, levels: 3, winsize: 13, iterations: 3, polyN: 5, polySigma: 1.1 };
/** Lucas-Kanade: separación de la rejilla (px de trabajo), ventana y niveles de la pirámide. */
export const LUCAS_KANADE = { gridStep: 8, winSize: 15, maxLevel: 2 };

export const FLOW_CONFIGS = {
  none: { key: 'none', method: 'none', maxWidth: 0, label: 'Sin flujo' },
  'farneback-320': { key: 'farneback-320', method: 'farneback', maxWidth: 320, label: 'Farnebäck · 320 px' },
  'farneback-640': { key: 'farneback-640', method: 'farneback', maxWidth: 640, label: 'Farnebäck · 640 px' },
  'farneback-full': { key: 'farneback-full', method: 'farneback', maxWidth: 0, label: 'Farnebäck · sin reducir' },
  'lk-640': { key: 'lk-640', method: 'lk', maxWidth: 640, label: 'Lucas-Kanade · 640 px' },
};

export const DEFAULT_FLOW = 'farneback-320';
