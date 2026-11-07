// Métricas del flujo por ROI y compensación del movimiento de la cabeza (paso 4b). Funciones puras.
//
// El worker no devuelve el campo de flujo entero: por cada ROI devuelve 14 sumas («momentos») de
// sus píxeles. Con ellas se calcula aquí, en el hilo principal, el flujo medio y la energía residual
// frente a CUALQUIER movimiento afín de la cabeza g(x, y) = (a·x + b·y + c, d·x + e·y + f):
//   Σ|f − g|² = Σ|f|² − 2·Σ f·g + Σ|g|²,  y cada término sale de los momentos.
// Así las tres compensaciones (ninguna, referencia y postura) se comparan con el mismo flujo, y la
// de postura puede esperar a que llegue el análisis de la cara del frame siguiente.
//
// Coordenadas: píxeles de trabajo de la franja (x a la derecha, y hacia abajo).

/** ROI con flujo, por lado del paciente, más la referencia (dorso nasal). El orden es el de los momentos. */
export const FLOW_ROIS = ['upperLid', 'lowerLid', 'brow', 'canthus'];
export const ROI_KEYS = [...FLOW_ROIS.map((r) => `left.${r}`), ...FLOW_ROIS.map((r) => `right.${r}`), 'reference'];

/**
 * Compensaciones que se calculan a la vez:
 *   none: ninguna; reference: traslación del dorso nasal; pose: afín 2D de puntos estables;
 *   hybrid: «dorso nasal + giro»: la traslación del dorso nasal más, para cada ROI, la diferencia de
 *   movimiento que da el giro 3D de la cabeza entre esa ROI y el dorso nasal (para canto y ceja).
 */
export const VARIANTS = ['none', 'reference', 'pose', 'hybrid'];

/** Índices de los momentos. u, v = componentes del flujo; x, y = posición del píxel. */
export const M = { n: 0, u: 1, v: 2, uu: 3, vv: 4, x: 5, y: 6, xx: 7, yy: 8, xy: 9, ux: 10, uy: 11, vx: 12, vy: 13 };
export const MOMENTS = 14;

/**
 * Píxeles (índices y·ancho + x) cuyo centro cae dentro del polígono.
 * @param {{x:number,y:number}[]} poly en píxeles de trabajo
 */
export function rasterize(poly, width, height) {
  if (!poly || poly.length < 3) return new Int32Array(0);
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const out = [];
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    // Cortes de la fila con los lados del polígono (regla par-impar).
    const cuts = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > cy !== b.y > cy) cuts.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    cuts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const from = Math.max(x0, Math.ceil(cuts[k] - 0.5));
      const to = Math.min(x1, Math.floor(cuts[k + 1] - 0.5));
      for (let x = from; x <= to; x++) out.push(y * width + x);
    }
  }
  return Int32Array.from(out);
}

/**
 * Momentos del flujo denso (u0, v0, u1, v1, …) sobre los píxeles `idx`.
 * Las posiciones son las del centro del píxel.
 */
export function moments(flow, width, idx) {
  const m = new Float64Array(MOMENTS);
  for (let k = 0; k < idx.length; k++) {
    const p = idx[k];
    const x = (p % width) + 0.5;
    const y = Math.floor(p / width) + 0.5;
    const u = flow[2 * p];
    const v = flow[2 * p + 1];
    m[0] += 1;
    m[1] += u;
    m[2] += v;
    m[3] += u * u;
    m[4] += v * v;
    m[5] += x;
    m[6] += y;
    m[7] += x * x;
    m[8] += y * y;
    m[9] += x * y;
    m[10] += u * x;
    m[11] += u * y;
    m[12] += v * x;
    m[13] += v * y;
  }
  return m;
}

/** Movimiento nulo (sin compensación). */
export const ZERO = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };

/** Traslación pura: el flujo medio de una ROI (la referencia). */
export function translationOf(m) {
  if (!m || !m[M.n]) return null;
  return { a: 0, b: 0, c: m[M.u] / m[M.n], d: 0, e: 0, f: m[M.v] / m[M.n] };
}

/**
 * Flujo medio y energía residual (media de |f − g|²) de una ROI frente al movimiento afín `g`.
 * @returns {{n:number, du:number, dv:number, energy:number} | null}
 */
export function residual(m, g) {
  const n = m[M.n];
  if (!n || !g) return null;
  const { a, b, c, d, e, f } = g;
  // Σ g_u, Σ g_v
  const gu = a * m[M.x] + b * m[M.y] + c * n;
  const gv = d * m[M.x] + e * m[M.y] + f * n;
  // Σ f·g
  const fg = a * m[M.ux] + b * m[M.uy] + c * m[M.u] + d * m[M.vx] + e * m[M.vy] + f * m[M.v];
  // Σ |g|²
  const quad = (p, q, r) => p * p * m[M.xx] + q * q * m[M.yy] + r * r * n + 2 * p * q * m[M.xy] + 2 * p * r * m[M.x] + 2 * q * r * m[M.y];
  const gg = quad(a, b, c) + quad(d, e, f);
  const energy = Math.max(0, (m[M.uu] + m[M.vv] - 2 * fg + gg) / n);
  return { n, du: (m[M.u] - gu) / n, dv: (m[M.v] - gv) / n, energy };
}

/** Resuelve un sistema 3×3 (regla de Cramer). null si es singular. */
function solve3(A, r) {
  const det = (M3) =>
    M3[0][0] * (M3[1][1] * M3[2][2] - M3[1][2] * M3[2][1]) -
    M3[0][1] * (M3[1][0] * M3[2][2] - M3[1][2] * M3[2][0]) +
    M3[0][2] * (M3[1][0] * M3[2][1] - M3[1][1] * M3[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / D);
}

/**
 * Movimiento afín (por mínimos cuadrados) que lleva los puntos `from` a `to`, expresado como
 * desplazamiento: g(x, y) = to − from ≈ (a·x + b·y + c, d·x + e·y + f). null si los puntos no
 * bastan (menos de 3 o alineados).
 */
export function affineMotion(from, to) {
  const n = Math.min(from.length, to.length);
  if (n < 3) return null;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0;
  let su = [0, 0, 0];
  let sv = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const { x, y } = from[i];
    const u = to[i].x - x;
    const v = to[i].y - y;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    su = [su[0] + u * x, su[1] + u * y, su[2] + u];
    sv = [sv[0] + v * x, sv[1] + v * y, sv[2] + v];
  }
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const pu = solve3(A, su);
  const pv = solve3(A, sv);
  if (!pu || !pv) return null;
  return { a: pu[0], b: pu[1], c: pu[2], d: pv[0], e: pv[1], f: pv[2] };
}

/** Interpolación lineal de dos listas de puntos (2D o 3D). */
export function lerpPoints(p, q, k) {
  return p.map((a, i) => {
    const o = { x: a.x + (q[i].x - a.x) * k, y: a.y + (q[i].y - a.y) * k };
    if (a.z != null) o.z = a.z + (q[i].z - a.z) * k;
    return o;
  });
}

/** Resuelve A·x = b (n×n) por eliminación gaussiana con pivote. null si es singular. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-9) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Movimiento rígido 3D pequeño (de un frame al siguiente) que lleva `from` a `to`, por mínimos
 * cuadrados: d(p) = ω × (p − c) + T, con c el centroide de `from`. Devuelve una función que da el
 * desplazamiento de cualquier punto 3D, o null si los puntos no bastan.
 */
export function rigidMotion3d(from, to) {
  const n = Math.min(from.length, to.length);
  if (n < 3) return null;
  const c = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < n; i++) { c.x += from[i].x / n; c.y += from[i].y / n; c.z += from[i].z / n; }
  const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0));
  const Atb = new Array(6).fill(0);
  const add = (row, v) => {
    for (let i = 0; i < 6; i++) {
      Atb[i] += row[i] * v;
      for (let j = 0; j < 6; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < n; i++) {
    const q = { x: from[i].x - c.x, y: from[i].y - c.y, z: from[i].z - c.z };
    const d = { x: to[i].x - from[i].x, y: to[i].y - from[i].y, z: to[i].z - from[i].z };
    // ω × q = (ωy·qz − ωz·qy, ωz·qx − ωx·qz, ωx·qy − ωy·qx); incógnitas [ωx, ωy, ωz, Tx, Ty, Tz].
    add([0, q.z, -q.y, 1, 0, 0], d.x);
    add([-q.z, 0, q.x, 0, 1, 0], d.y);
    add([q.y, -q.x, 0, 0, 0, 1], d.z);
  }
  const s = solveLinear(AtA, Atb);
  if (!s) return null;
  const [wx, wy, wz, tx, ty, tz] = s;
  return (p) => {
    const q = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    return { x: wy * q.z - wz * q.y + tx, y: wz * q.x - wx * q.z + ty, z: wx * q.y - wy * q.x + tz };
  };
}

/** Puntos 3D del frame → coordenadas de trabajo (x, y como toWork; z con la misma escala). */
export const toWork3 = (points, strip, scale) => points.map((p) => ({ x: (p.x - strip.x) * scale, y: (p.y - strip.y) * scale, z: p.z * scale }));

/** Puntos del frame completo → píxeles de trabajo de la franja. */
export const toWork = (points, strip, scale) => points.map((p) => ({ x: (p.x - strip.x) * scale, y: (p.y - strip.y) * scale }));

/**
 * Métricas de una ROI para un par de frames, normalizadas: velocidades en distancias intercantales
 * por segundo (independientes de la distancia a la cámara y de los fps), energía en su cuadrado.
 * @param {{n:number,du:number,dv:number,energy:number}} r residual()
 * @param {{temple:{x,y}, down:{x,y}}} axes ejes del ojo (vectores unitarios)
 * @param {number} unit píxeles de trabajo de una distancia intercantal
 * @param {number} dtMs tiempo entre los dos frames
 */
export function roiMetrics(r, axes, unit, dtMs) {
  if (!r || !(unit > 0) || !(dtMs > 0)) return null;
  const k = 1000 / (unit * dtMs);
  return {
    energy: r.energy * k * k,
    // Componente con signo: + = hacia abajo (el párpado baja) / + = hacia la sien.
    down: axes ? (r.du * axes.down.x + r.dv * axes.down.y) * k : null,
    temple: axes ? (r.du * axes.temple.x + r.dv * axes.temple.y) * k : null,
  };
}
