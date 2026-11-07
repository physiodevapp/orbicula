// Worker del flujo óptico: recibe la franja periocular de cada frame y calcula el flujo entre ese
// frame y el anterior con el mismo recorte. OpenCV.js (WASM, CPU) corre aquí, separado del worker de
// MediaPipe (GPU), para que trabajen en paralelo.
//
// La imagen llega de dos maneras (ver `source` en config.js):
//   - `bitmap`: la franja ya recortada y reducida (RGBA); se lee con un OffscreenCanvas.
//   - `videoFrame`: el frame completo de la cámara; se copia solo el plano de brillo (Y) de la franja.
import '../privacy/install.js'; // la barrera de red va la primera, antes que OpenCV.js
import { LUCAS_KANADE } from './config.js';
import { denseStats, sparseStats, gridPoints, normalizeCoeffs } from './stats.js';
import { rasterize, moments, MOMENTS } from './metrics.js';

/** Separación (px de trabajo) de la muestra del campo de flujo que se manda para dibujarlo. */
const FIELD_STEP = 10;

/** Formatos de VideoFrame cuyo primer plano es el brillo (Y) a resolución completa. */
const YUV_FORMATS = new Set(['I420', 'I420A', 'I422', 'I422A', 'I444', 'I444A', 'NV12']);

let cv = null;
let canvas = null;
let ctx = null;
// Buffers reutilizados (los cv.Mat viven en el heap del WASM: si no se liberan, se agota).
let mats = null;
let size = null; // { width, height } de trabajo de los buffers actuales
let full = null; // { mat, width, height }: plano Y de la franja a resolución completa
let yuvBuf = null; // copia del VideoFrame (se reutiliza si cabe)
let prevKey = null; // franja + configuración del frame anterior: solo se compara con el mismo recorte
let prevT = null;
let grid = null; // Lucas-Kanade: puntos de la rejilla { p0: cv.Mat, pts: Float32Array }
let queue = Promise.resolve(); // los frames se procesan en orden (la copia del VideoFrame es asíncrona)
let masks = null; // { key, idx: Int32Array[] } píxeles de cada ROI (orden de ROI_KEYS)

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
}

function ensureFull(width, height) {
  if (full && full.width === width && full.height === height) return full.mat;
  full?.mat.delete();
  full = { mat: new cv.Mat(height, width, cv.CV_8UC1), width, height };
  return full.mat;
}

/** Píxeles de cada ROI; se recalculan solo si cambian los polígonos o el tamaño. */
function roiMasks(polys, polyId, width, height) {
  const key = `${polyId}|${width}x${height}`;
  if (masks?.key !== key) masks = { key, idx: polys.map((p) => rasterize(p, width, height)) };
  return masks.idx;
}

/** Muestra del campo de flujo cada FIELD_STEP px (para dibujarlo): [x, y, u, v, …]. */
function sampleField(flow, width, height) {
  const out = [];
  for (let y = FIELD_STEP / 2; y < height; y += FIELD_STEP) {
    for (let x = FIELD_STEP / 2; x < width; x += FIELD_STEP) {
      const p = 2 * (Math.floor(y) * width + Math.floor(x));
      out.push(x, y, flow[p], flow[p + 1]);
    }
  }
  return Float32Array.from(out);
}

function lkGrid(width, height) {
  if (grid) return grid;
  const pts = gridPoints(width, height, LUCAS_KANADE.gridStep);
  const p0 = new cv.Mat(pts.length / 2, 1, cv.CV_32FC2);
  p0.data32F.set(pts);
  grid = { p0, pts };
  return grid;
}

/** RGBA de un ImageBitmap (ya al tamaño de trabajo) → mats.gray. */
function grayFromBitmap(bitmap) {
  const { width, height } = bitmap;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, width, height);
  mats.rgba.data.set(img.data);
  cv.cvtColor(mats.rgba, mats.gray, cv.COLOR_RGBA2GRAY);
}

/**
 * ¿Se puede leer el plano Y del VideoFrame con las coordenadas de la franja? Hace falta un formato
 * YUV y que el frame no venga girado ni con otro tamaño que el del vídeo (las coordenadas de la
 * franja son las del vídeo). Devuelve el motivo si no.
 */
function yPlaneProblem(frame, frameSize) {
  if (!YUV_FORMATS.has(frame.format)) return `formato ${frame.format ?? 'opaco (GPU)'}`;
  if ((frame.rotation ?? 0) !== 0 || frame.flip) return 'frame girado';
  const v = frame.visibleRect;
  if (!v || v.width !== frameSize.width || v.height !== frameSize.height) return `tamaño ${v?.width}×${v?.height}`;
  return null;
}

/** Plano Y de la franja (resolución completa) → reducido al tamaño de trabajo en mats.gray. */
async function grayFromYPlane(frame, rect, work) {
  const v = frame.visibleRect;
  const r = { x: v.x + rect.x, y: v.y + rect.y, width: rect.w, height: rect.h };
  const bytes = frame.allocationSize({ rect: r });
  if (!yuvBuf || yuvBuf.byteLength < bytes) yuvBuf = new Uint8Array(bytes);
  const layout = await frame.copyTo(yuvBuf, { rect: r });
  frame.close(); // se suelta cuanto antes: la cámara tiene pocos buffers
  const { offset, stride } = layout[0];
  const target = rect.w === work.width && rect.h === work.height ? mats.gray : ensureFull(rect.w, rect.h);
  if (stride === rect.w) {
    target.data.set(yuvBuf.subarray(offset, offset + rect.w * rect.h));
  } else {
    for (let y = 0; y < rect.h; y++) target.data.set(yuvBuf.subarray(offset + y * stride, offset + y * stride + rect.w), y * rect.w);
  }
  if (target !== mats.gray) cv.resize(target, mats.gray, new cv.Size(work.width, work.height), 0, 0, cv.INTER_AREA);
}

/** Pone en mats.gray la franja en grises al tamaño de trabajo. Devuelve de dónde ha salido. */
async function loadGray(m) {
  if (m.bitmap) {
    ensureBuffers(m.bitmap.width, m.bitmap.height);
    grayFromBitmap(m.bitmap);
    return { source: 'bitmap', note: null };
  }
  const frame = m.videoFrame;
  ensureBuffers(m.work.width, m.work.height);
  const problem = yPlaneProblem(frame, m.frameSize);
  if (!problem) {
    const format = frame.format; // se lee antes: grayFromYPlane cierra el frame
    await grayFromYPlane(frame, m.rect, m.work);
    return { source: 'y-plane', note: format };
  }
  // Respaldo: recorte y reducción con createImageBitmap aquí, en el worker.
  const { x, y, w, h } = m.rect;
  const bitmap = await createImageBitmap(frame, x, y, w, h, { resizeWidth: m.work.width, resizeHeight: m.work.height, resizeQuality: 'medium' });
  frame.close();
  try {
    grayFromBitmap(bitmap);
  } finally {
    bitmap.close();
  }
  return { source: 'worker-bitmap', note: problem };
}

async function processFrame(m) {
  const t0 = performance.now();
  // 1. La franja en grises (lo que más costaba en la fase 4a era esta copia de la GPU a la CPU).
  const { source, note } = await loadGray(m);
  const { width, height } = size;
  const t1 = performance.now();

  // 2. Brillo normalizado (media y varianza), contra el parpadeo de las luces.
  cv.meanStdDev(mats.gray, mats.mean, mats.sd);
  const { alpha, beta } = normalizeCoeffs(mats.mean.doubleAt(0, 0), mats.sd.doubleAt(0, 0));
  mats.gray.convertTo(mats.cur, cv.CV_8U, alpha, beta);
  const t2 = performance.now();

  // 3. Flujo, solo si el frame anterior tiene el mismo recorte y la misma configuración.
  const key = `${m.stripId}|${m.method}|${JSON.stringify(m.params)}|${width}x${height}`;
  let stats = null;
  let roiMoments = null;
  let field = null;
  if (prevKey === key && m.method !== 'none') {
    if (m.method === 'farneback') {
      const F = m.params;
      cv.calcOpticalFlowFarneback(mats.prev, mats.cur, mats.flow, F.pyrScale, F.levels, F.winsize, F.iterations, F.polyN, F.polySigma, 0);
      const flow = mats.flow.data32F;
      stats = denseStats(flow);
      // Momentos por ROI (ver metrics.js): el hilo principal calcula con ellos las métricas y las compensaciones.
      if (m.polys) {
        const idx = roiMasks(m.polys, m.polyId, width, height);
        roiMoments = new Float64Array(idx.length * MOMENTS);
        idx.forEach((ix, k) => roiMoments.set(moments(flow, width, ix), k * MOMENTS));
      }
      if (m.wantField) field = sampleField(flow, width, height);
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
    source,
    sourceNote: note,
    readMs: t1 - t0,
    prepMs: t2 - t1,
    flowMs: stats ? t3 - t2 : null,
    totalMs: t3 - t0,
    size: { width, height },
    stats,
    moments: roiMoments,
    field,
  };
}

function release(m) {
  m.bitmap?.close();
  m.videoFrame?.close(); // cerrar dos veces no hace nada
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
      release(m);
      self.postMessage({ type: 'skipped', id: m.id });
      return;
    }
    queue = queue.then(async () => {
      try {
        const out = await processFrame(m);
        const transfer = [out.moments?.buffer, out.field?.buffer].filter(Boolean);
        self.postMessage({ type: 'result', id: m.id, t: m.t, stripId: m.stripId, method: m.method, ...out }, transfer);
      } catch (err) {
        prevKey = null;
        self.postMessage({ type: 'frameError', id: m.id, message: String(err?.message ?? err) });
      } finally {
        release(m);
      }
    });
  }
};
