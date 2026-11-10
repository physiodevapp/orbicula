// Grabación del vídeo de la cámara durante el protocolo (fase 6c), solo en la memoria del móvil.
// MediaRecorder entrega MP4 fragmentado (H.264) en trozos; se guardan en un array de Blob y nunca se
// convierten en una URL ni se descargan: solo se leen con openRecording() para analizarlos y se borran
// con discard(). Si el navegador no graba MP4, no se ofrece (la lectura de WebM no está soportada).

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4'];
/** Tope de memoria: ~4 min a 4 Mb/s son 120 MB. Más de esto se corta la grabación. */
export const MAX_BYTES = 300 * 1024 * 1024;

/** Tipo MP4 que puede grabar este navegador, o null. */
export function recordingType() {
  if (typeof MediaRecorder !== 'function') return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export class FrameRecorder {
  constructor() {
    this.rec = null;
    this.chunks = [];
    this.bytes = 0;
    this.startedAt = null; // performance.now() cuando arrancó la grabación (reloj de la cámara)
    this.overflow = false;
    this.error = null;
  }

  get active() {
    return this.rec?.state === 'recording';
  }

  /** Empieza a grabar el stream de la cámara. Devuelve cuando la grabación ya ha arrancado. */
  start(stream, { bitsPerSecond = 4e6 } = {}) {
    const mimeType = recordingType();
    if (!mimeType) return Promise.reject(new Error('este navegador no graba vídeo MP4'));
    this.discard();
    return new Promise((resolve, reject) => {
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitsPerSecond });
      this.rec = rec;
      rec.ondataavailable = (e) => {
        if (!e.data?.size) return;
        this.chunks.push(e.data);
        this.bytes += e.data.size;
        if (this.bytes > MAX_BYTES && rec.state === 'recording') {
          this.overflow = true;
          rec.stop();
        }
      };
      rec.onerror = (e) => { this.error = e?.error?.message ?? 'error de grabación'; reject(new Error(this.error)); };
      rec.onstart = () => { this.startedAt = performance.now(); resolve({ mimeType }); };
      rec.start(1000);
    });
  }

  /** Para la grabación y devuelve el vídeo (un Blob en memoria). */
  stop() {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve(this.blob());
    return new Promise((resolve) => {
      rec.addEventListener('stop', () => resolve(this.blob()), { once: true });
      rec.stop();
    });
  }

  blob() {
    return this.chunks.length ? new Blob(this.chunks, { type: this.rec?.mimeType ?? 'video/mp4' }) : null;
  }

  /** Borra el vídeo de la memoria. */
  discard() {
    if (this.rec?.state === 'recording') { try { this.rec.stop(); } catch { /* ya parado */ } }
    this.rec = null;
    this.chunks = [];
    this.bytes = 0;
    this.startedAt = null;
    this.overflow = false;
    this.error = null;
  }
}
