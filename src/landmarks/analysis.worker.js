// Worker del análisis: detecta la cara y calcula ROI y blendshapes fuera del hilo principal.
import '../privacy/install.js'; // la barrera de red va la primera, antes que MediaPipe
import { createLandmarker } from './landmarker.js';
import { processResult } from './process.js';

let landmarker = null;
let lastTs = 0; // MediaPipe exige marcas de tiempo estrictamente crecientes
let imageMode = false; // vídeo grabado (fase 6): cada fotograma por separado, sin suavizado

self.onmessage = async ({ data: m }) => {
  if (m.type === 'init') {
    try {
      const made = await createLandmarker(m);
      landmarker = made.landmarker;
      self.postMessage({ type: 'ready', delegate: made.delegate });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) });
    }
    return;
  }

  if (m.type === 'options') {
    try {
      await landmarker?.setOptions({ outputFaceBlendshapes: m.blendshapes });
    } catch (err) {
      self.postMessage({ type: 'warning', message: String(err?.message ?? err) });
    }
    return;
  }

  if (m.type === 'mode') {
    try {
      await landmarker?.setOptions({ runningMode: m.image ? 'IMAGE' : 'VIDEO' });
      imageMode = !!m.image;
    } catch (err) {
      self.postMessage({ type: 'warning', message: String(err?.message ?? err) });
    }
    self.postMessage({ type: 'modeSet', image: imageMode });
    return;
  }

  if (m.type === 'frame') {
    if (!landmarker) {
      m.bitmap.close();
      self.postMessage({ type: 'skipped', id: m.id });
      return;
    }
    try {
      const t0 = performance.now();
      lastTs = Math.max(lastTs + 1, t0);
      const res = imageMode ? landmarker.detect(m.bitmap) : landmarker.detectForVideo(m.bitmap, lastTs);
      const ms = performance.now() - t0;
      const out = processResult(res, m.frame, { frameMirrored: m.frameMirrored, swapNames: m.swapNames });
      self.postMessage({ type: 'result', id: m.id, t: m.t, ms, ...out });
    } catch (err) {
      self.postMessage({ type: 'frameError', id: m.id, message: String(err?.message ?? err) });
    } finally {
      m.bitmap.close();
    }
  }
};
