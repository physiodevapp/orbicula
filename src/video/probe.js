// Prueba de lectura de un vídeo grabado (paso 6a): decodifica los primeros segundos y mide el ritmo,
// con y sin el giro aplicado, y comprueba que los tiempos de los fotogramas son los del archivo.
import { decodeFrames, rotateFrame } from './decode.js';

/**
 * @param {Awaited<ReturnType<import('./mp4.js').openMp4>>} mp4
 * @param {{seconds?: number, signal?: AbortSignal, onProgress?: (frac: number) => void, thumb?: (bitmap: ImageBitmap) => void}} opts
 */
export async function probeDecode(mp4, { seconds = 15, signal, onProgress = () => {}, thumb = null } = {}) {
  const toMs = Math.min(seconds * 1000, mp4.timing.durationMs);
  const expected = mp4.samples.filter((s) => s.t <= toMs).length;
  const rotation = mp4.track.rotation;
  let canvas = null;
  let decoded = 0;
  let disorder = 0;
  let lastT = -Infinity;
  let rotateMs = 0;
  let outSize = null;
  const t0 = performance.now();
  for await (const { frame, t } of decodeFrames(mp4, { signal, toMs })) {
    try {
      if (t < lastT) disorder++;
      lastT = t;
      decoded++;
      // El giro: lo que costará en el análisis (6b), y la miniatura del primer fotograma.
      const r0 = performance.now();
      const { frame: upright, canvas: c } = rotateFrame(frame, rotation, canvas);
      canvas = c;
      rotateMs += performance.now() - r0;
      outSize ??= { width: upright.displayWidth, height: upright.displayHeight };
      if (decoded === 1 && thumb) thumb(await createImageBitmap(upright, { resizeWidth: 240, resizeQuality: 'medium' }));
      upright.close();
    } finally {
      frame.close();
    }
    if (decoded % 10 === 0) onProgress(Math.min(1, t / toMs));
  }
  const wallMs = performance.now() - t0;
  onProgress(1);
  return {
    seconds: Math.round(toMs) / 1000,
    expectedFrames: expected,
    decodedFrames: decoded,
    outOfOrder: disorder,
    wallMs: Math.round(wallMs),
    // Fotogramas por segundo de reloj: decodificar y girar (lo que limitará el análisis si va más rápido).
    framesPerSecond: Math.round((decoded / wallMs) * 1000 * 10) / 10,
    rotateMsPerFrame: decoded ? Math.round((rotateMs / decoded) * 100) / 100 : null,
    // Cuánto más rápido que el tiempo real (1 = tan rápido como se grabó).
    realtimeFactor: Math.round(((toMs / wallMs) * 100)) / 100,
    outputSize: outSize,
  };
}
