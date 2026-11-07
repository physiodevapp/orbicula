// Worker del flujo óptico: recibe la franja periocular recortada de cada frame y calcula el
// flujo entre ese frame y el anterior con el mismo recorte. OpenCV.js (WASM, CPU) corre aquí,
// separado del worker de MediaPipe (GPU), para que trabajen en paralelo.
import '../privacy/install.js'; // la barrera de red va la primera, antes que OpenCV.js
import { FARNEBACK, LUCAS_KANADE } from './config.js';
import { denseStats, sparseStats, gridPoints, normalizeCoeffs } from './stats.js';

let cv = null;
let canvas = null;
let ctx = null;
// Buffers reutilizados (los cv.Mat viven en el heap del WASM: si no se liberan, se agota).
let mats = null;
let size = null; // { width, height } de los buffers actuales
let prevKey = null; // franja + configuración del frame anterior: solo se compara con el mismo recorte
let prevT = null;
let grid = null; // Lucas-Kanade: puntos de la rejilla { p0: cv.Mat, pts: Float32Array }

/** Carga OpenCV.js: importScripts en un worker clásico (la build); import() en uno de módulo (dev). */
async function loadOpenCv(url) {
  try {
    importScripts(url);
  } catch {
    await import(/* @vite-ignore */ url);
  }
  // OpenCV.js 5 deja en `cv` una promesa que se resuelve cuando el WASM está listo.
  const mod = await self.cv;
  self.cv = mod;
  return mod;
}

function freeMats() {
  if (mats) for (const m of Object.values(mats)) m.delete();
  if (grid) grid.p0.delete();
  mats = null;
  grid = null;
  size = null;
  prevKey = null;
}

function ensureBuffers(width, height) {
  if (size && size.width === width && size.height === height) return;
  freeMats();
  mats = {
    rgba: new cv.Mat(height, width, cv.CV_8UC4),
    gray: new cv.Mat(height, width, cv.CV_8UC1),
    prev: new cv.Mat(height, width, cv.CV_8UC1),
    cur: new cv.Mat(height, width, cv.CV_8UC1),
    flow: new cv.Mat(height, width, cv.CV_32FC2),
    p1: new cv.Mat(),
    status: new cv.Mat(),
    err: new cv.Mat(),
    mean: new cv.Mat(),
    sd: new cv.Mat(),
  };
  size = { width, height };
  canvas = new OffscreenCanvas(width, height);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
}

function lkGrid(width, height) {
  if (grid) return grid;
  const pts = gridPoints(width, height, LUCAS_KANADE.gridStep);
  const p0 = new cv.Mat(pts.length / 2, 1, cv.CV_32FC2);
  p0.data32F.set(pts);
  grid = { p0, pts };
  return grid;
}

function processFrame(m) {
  const t0 = performance.now();
  const { width, height } = m.bitmap;
  ensureBuffers(width, height);

  // 1. Píxeles de la franja (la copia de la GPU a la CPU es lo que más cuesta aquí).
  ctx.drawImage(m.bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height);
  const t1 = performance.now();

  // 2. Escala de grises y brillo normalizado (media y varianza), contra el parpadeo de las luces.
  mats.rgba.data.set(img.data);
  cv.cvtColor(mats.rgba, mats.gray, cv.COLOR_RGBA2GRAY);
  cv.meanStdDev(mats.gray, mats.mean, mats.sd);
  const { alpha, beta } = normalizeCoeffs(mats.mean.doubleAt(0, 0), mats.sd.doubleAt(0, 0));
  mats.gray.convertTo(mats.cur, cv.CV_8U, alpha, beta);
  const t2 = performance.now();

  // 3. Flujo, solo si el frame anterior tiene el mismo recorte y la misma configuración.
  const key = `${m.stripId}|${m.method}|${width}x${height}`;
  let stats = null;
  if (prevKey === key && m.method !== 'none') {
    if (m.method === 'farneback') {
      const F = FARNEBACK;
      cv.calcOpticalFlowFarneback(mats.prev, mats.cur, mats.flow, F.pyrScale, F.levels, F.winsize, F.iterations, F.polyN, F.polySigma, 0);
      stats = denseStats(mats.flow.data32F);
    } else if (m.method === 'lk') {
      const L = LUCAS_KANADE;
      const g = lkGrid(width, height);
      cv.calcOpticalFlowPyrLK(mats.prev, mats.cur, g.p0, mats.p1, mats.status, mats.err, new cv.Size(L.winSize, L.winSize), L.maxLevel);
      stats = sparseStats(g.pts, mats.p1.data32F, mats.status.data);
    }
  }
  const t3 = performance.now();

  const dt = prevKey === key && prevT != null ? m.t - prevT : null;
  // El frame actual pasa a ser el anterior (se intercambian los buffers, sin copiar).
  [mats.prev, mats.cur] = [mats.cur, mats.prev];
  prevKey = key;
  prevT = m.t;

  return {
    paired: !!stats,
    dt,
    readMs: t1 - t0,
    prepMs: t2 - t1,
    flowMs: stats ? t3 - t2 : null,
    totalMs: t3 - t0,
    size: { width, height },
    stats,
  };
}

self.onmessage = async ({ data: m }) => {
  if (m.type === 'init') {
    try {
      const t0 = performance.now();
      cv = await loadOpenCv(m.opencvUrl);
      self.postMessage({ type: 'ready', loadMs: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) });
    }
    return;
  }

  if (m.type === 'reset') {
    prevKey = null;
    return;
  }

  if (m.type === 'frame') {
    if (!cv) {
      m.bitmap.close();
      self.postMessage({ type: 'skipped', id: m.id });
      return;
    }
    try {
      const out = processFrame(m);
      self.postMessage({ type: 'result', id: m.id, t: m.t, stripId: m.stripId, method: m.method, ...out });
    } catch (err) {
      prevKey = null;
      self.postMessage({ type: 'frameError', id: m.id, message: String(err?.message ?? err) });
    } finally {
      m.bitmap.close();
    }
  }
};
