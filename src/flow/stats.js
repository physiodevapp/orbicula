// Resumen de un campo de flujo (paso 4a: toda la franja, sin compensar la cabeza).
// Las métricas por ROI, con la compensación, llegan en el paso 4b. Funciones puras.

/**
 * Flujo denso intercalado (dx0, dy0, dx1, dy1, …), en píxeles de trabajo.
 * @returns {{dx:number, dy:number, energy:number, n:number}} medias y media de |v|²
 */
export function denseStats(data) {
  const n = data.length >> 1;
  let sx = 0;
  let sy = 0;
  let e = 0;
  for (let i = 0; i < data.length; i += 2) {
    const x = data[i];
    const y = data[i + 1];
    sx += x;
    sy += y;
    e += x * x + y * y;
  }
  return n ? { dx: sx / n, dy: sy / n, energy: e / n, n } : { dx: 0, dy: 0, energy: 0, n: 0 };
}

/**
 * Flujo de una rejilla de puntos (Lucas-Kanade): desplazamiento de cada punto con estado 1.
 * @param {Float32Array} p0 puntos de partida (x0, y0, …)
 * @param {Float32Array} p1 puntos de llegada
 * @param {Uint8Array} status 1 = el punto se ha seguido
 */
export function sparseStats(p0, p1, status) {
  let sx = 0;
  let sy = 0;
  let e = 0;
  let n = 0;
  for (let k = 0; k < status.length; k++) {
    if (!status[k]) continue;
    const x = p1[2 * k] - p0[2 * k];
    const y = p1[2 * k + 1] - p0[2 * k + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sx += x;
    sy += y;
    e += x * x + y * y;
    n++;
  }
  return n ? { dx: sx / n, dy: sy / n, energy: e / n, n } : { dx: 0, dy: 0, energy: 0, n: 0 };
}

/** Rejilla de puntos (x, y) cada `step` px, a `step / 2` del borde. */
export function gridPoints(width, height, step) {
  const pts = [];
  for (let y = step / 2; y < height; y += step) for (let x = step / 2; x < width; x += step) pts.push(x, y);
  return Float32Array.from(pts);
}

/** Coeficientes (alfa, beta) para dejar la imagen con media 128 y desviación 40: v' = alfa·v + beta. */
export function normalizeCoeffs(mean, sd, { target = 128, spread = 40 } = {}) {
  const alpha = sd > 1 ? spread / sd : 1;
  return { alpha, beta: target - alpha * mean };
}
