// Decodificación fotograma a fotograma de un MP4 abierto con openMp4 (fase 6), con WebCodecs.
//
// - Se alimenta al decodificador en orden de decodificación y entrega los fotogramas en orden de
//   presentación, con su tiempo en ms (el de la muestra, no el del reloj).
// - Control del ritmo: no se le dan más muestras mientras haya `maxAhead` fotogramas listos sin recoger;
//   así la memoria no crece aunque el análisis sea más lento que la decodificación (4K: ~12 MB por
//   fotograma). No se limita por la cola del decodificador: con fotogramas B (H.264, HEVC) retiene varias
//   muestras antes de dar el primer fotograma, y esperarle con la entrada cortada lo bloquea. Solo un
//   tope amplio de muestras en vuelo (maxInFlight) por si algo va mal.
// - Quien recibe un fotograma lo tiene que cerrar (frame.close()).

/** ¿Puede este navegador decodificar el vídeo? */
export async function canDecode(config) {
  if (typeof VideoDecoder !== 'function') return { supported: false, reason: 'este navegador no tiene WebCodecs (VideoDecoder)' };
  try {
    const r = await VideoDecoder.isConfigSupported(config);
    return r.supported ? { supported: true } : { supported: false, reason: `el navegador no decodifica el códec ${config.codec}` };
  } catch (err) {
    return { supported: false, reason: `configuración no válida (${err?.message ?? err})` };
  }
}

/**
 * Fotogramas decodificados, uno a uno.
 * @param {Awaited<ReturnType<import('./mp4.js').openMp4>>} mp4
 * @param {{maxAhead?: number, signal?: AbortSignal, toMs?: number}} opts toMs: parar tras ese tiempo
 * @returns {AsyncGenerator<{frame: VideoFrame, t: number}>}
 */
export async function* decodeFrames(mp4, { maxAhead = 3, maxInFlight = 40, signal, toMs = Infinity } = {}) {
  const ready = []; // fotogramas listos
  let wake = null; // resuelve la espera del consumidor
  let failure = null;
  const notify = () => { wake?.(); wake = null; };
  let fed = 0;
  let out = 0;
  const decoder = new VideoDecoder({
    output: (frame) => { out++; ready.push(frame); notify(); },
    error: (e) => { failure = e; notify(); },
  });
  decoder.addEventListener?.('dequeue', notify);
  decoder.configure(mp4.decoderConfig);
  const samples = mp4.samples;
  let next = 0; // siguiente muestra a decodificar
  let flushed = false;
  const usMs = 1000;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      if (failure) throw failure;
      // Alimentar mientras haya poco pendiente.
      while (next < samples.length && ready.length < maxAhead && fed - out < maxInFlight && samples[next].t <= toMs + 1000) {
        const s = samples[next++];
        const data = await mp4.read(s);
        fed++;
        decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.t * usMs), duration: Math.round(s.durationMs * usMs), data }));
      }
      if (ready.length) {
        const frame = ready.shift();
        const t = frame.timestamp / usMs;
        if (t > toMs) { frame.close(); break; }
        yield { frame, t };
        continue;
      }
      if (next >= samples.length || samples[next].t > toMs + 1000) {
        if (flushed) break;
        await decoder.flush();
        flushed = true;
        continue;
      }
      // Esperar a un fotograma (o a que el decodificador avance); con un respaldo por si no avisa.
      await new Promise((r) => { wake = r; setTimeout(r, 20); });
    }
  } finally {
    for (const f of ready) f.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}

/**
 * Copia el fotograma girado (0/90/180/270° en horario) en un lienzo y devuelve un VideoFrame nuevo con
 * el mismo tiempo. No cierra el original.
 * @param {VideoFrame} frame
 * @param {number} rotation
 * @param {OffscreenCanvas} [canvas] se reutiliza entre fotogramas
 */
export function rotateFrame(frame, rotation, canvas) {
  const w = frame.displayWidth;
  const h = frame.displayHeight;
  const quarter = rotation % 180 !== 0;
  const cw = quarter ? h : w;
  const ch = quarter ? w : h;
  const c = canvas ?? new OffscreenCanvas(cw, ch);
  if (c.width !== cw || c.height !== ch) {
    c.width = cw;
    c.height = ch;
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(frame, -w / 2, -h / 2);
  return { frame: new VideoFrame(c, { timestamp: frame.timestamp }), canvas: c };
}
