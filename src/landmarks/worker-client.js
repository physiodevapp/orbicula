// Cliente del worker de análisis. Interfaz común con Analysis (hilo principal):
//   load(blendshapes), ready, delegate, mode, ms, fps, submit(video, t), onResult(result),
//   frameMirrored, swapNames, setBlendshapes(on), analysisSize, inflight, dispose().
import { sourceSize } from '../capture/source.js';
import AnalysisWorker from './analysis.worker.js?worker';
import { assetUrls } from './landmarker.js';
import { FpsMeter } from '../capture/camera-logic.js';

/**
 * Lado corto máximo de la copia del frame que se manda al worker. El modelo reduce la imagen
 * por dentro (el recorte de la cara entra a 256×256), así que más resolución no mejora los
 * landmarks y sí encarece la copia. Las ROI se calculan igualmente sobre el frame completo.
 */
export const ANALYSIS_SHORT_SIDE = 720;
/** Frames en vuelo: uno analizándose y otro preparándose, para que el worker no espere. */
const MAX_IN_FLIGHT = 2;

export class WorkerAnalysis {
  constructor() {
    this.mode = 'worker';
    this.worker = null;
    this.delegate = null;
    this.ready = false;
    this.frameMirrored = false;
    this.swapNames = false;
    this.ms = 0;
    this.meter = new FpsMeter(1000);
    this.analysisSize = null;
    this.onResult = null;
    this.inflight = 0;
    this.seq = 0;
    this.blockedHosts = new Set(); // dominios que el worker intentó llamar y la barrera bloqueó
    this.meta = new Map(); // id → {submitAt, bitmapMs}: para medir lo que cuesta copiar y enviar el frame
    this._loading = null;
  }

  get fps() {
    return this.meter.fps;
  }

  /** Fotogramas en vuelo que admite (el pool de análisis lo usa para repartir). */
  get capacity() {
    return MAX_IN_FLIGHT;
  }

  /**
   * Arranca el worker y carga el modelo. Rechaza si el worker no puede arrancar.
   * @param {boolean} blendshapes
   * @param {{delegates?: ('GPU'|'CPU')[]}} [o] orden de aceleradores a probar (por defecto GPU y, si falla, CPU)
   */
  load(blendshapes = true, { delegates } = {}) {
    this._loading ??= new Promise((resolve, reject) => {
      const worker = new AnalysisWorker();
      this.worker = worker;
      worker.onerror = (e) => reject(new Error(e.message || 'No se pudo cargar el worker'));
      worker.onmessage = ({ data: m }) => {
        switch (m.type) {
          case 'ready':
            this.ready = true;
            this.delegate = m.delegate;
            resolve();
            break;
          case 'error':
            reject(new Error(m.message));
            break;
          case 'result': {
            this.inflight = Math.max(0, this.inflight - 1);
            this.ms = this.ms ? this.ms * 0.9 + m.ms * 0.1 : m.ms;
            const now = performance.now();
            this.meter.push(now);
            const meta = this.meta.get(m.id);
            this.meta.delete(m.id);
            if (meta) {
              m.bitmapMs = meta.bitmapMs; // tiempo en el hilo principal hasta tener la copia del frame
              m.roundTripMs = now - meta.submitAt; // desde que se pide hasta que vuelve el resultado
              m.tag = meta.tag; // número del envío (para reordenar los resultados de varios análisis)
            }
            this.onResult?.(m);
            break;
          }
          case 'modeSet':
            this.modeWaiter?.();
            this.modeWaiter = null;
            break;
          case 'blocked':
            this.blockedHosts.add(m.host);
            break;
          case 'skipped':
          case 'frameError': {
            this.inflight = Math.max(0, this.inflight - 1);
            const tag = this.meta.get(m.id)?.tag;
            this.meta.delete(m.id);
            this.onDrop?.(tag); // el fotograma no se analizó: que no se le espere
            break;
          }
        }
      };
      worker.postMessage({ type: 'init', ...assetUrls(), blendshapes, ...(delegates ? { delegates } : {}) });
    });
    return this._loading;
  }

  /**
   * Modo IMAGE (vídeo grabado, fase 6): cada fotograma por separado, sin el suavizado entre frames del
   * modo VIDEO. Se espera a que el worker confirme el cambio.
   */
  setImageMode(on) {
    if (!this.worker) return Promise.resolve();
    return new Promise((resolve) => {
      this.modeWaiter = resolve;
      this.worker.postMessage({ type: 'mode', image: !!on });
      setTimeout(resolve, 3000); // por si no contesta
    });
  }

  /** Activa o desactiva los blendshapes. El worker lo aplica de forma asíncrona: se espera un poco. */
  setBlendshapes(on) {
    this.worker?.postMessage({ type: 'options', blendshapes: on });
    return new Promise((resolve) => setTimeout(resolve, 400));
  }

  /**
   * Manda una copia del frame actual al worker. Si está ocupado, el frame se descarta.
   * @param {*} [tag] número del envío; vuelve en el resultado (`m.tag`) o en `onDrop(tag)` si no se analiza
   * @returns {boolean} si lo aceptó
   */
  submit(video, t, tag = null) {
    const frame = sourceSize(video); // <video> de la cámara o VideoFrame de un archivo (fase 6)
    if (!this.ready || this.inflight >= MAX_IN_FLIGHT || !frame) return false;
    const scale = Math.min(1, ANALYSIS_SHORT_SIDE / Math.min(frame.width, frame.height));
    const size = { width: Math.round(frame.width * scale), height: Math.round(frame.height * scale) };
    this.analysisSize = size;
    const id = ++this.seq;
    const submitAt = performance.now();
    this.meta.set(id, { submitAt, bitmapMs: null, tag });
    this.inflight++;
    const options = scale < 1 ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'low' } : undefined;
    createImageBitmap(video, options)
      .then((bitmap) => {
        const meta = this.meta.get(id);
        if (meta) meta.bitmapMs = performance.now() - submitAt;
        this.worker.postMessage(
          { type: 'frame', id, bitmap, t, frame, frameMirrored: this.frameMirrored, swapNames: this.swapNames },
          [bitmap],
        );
      })
      .catch(() => {
        this.inflight = Math.max(0, this.inflight - 1);
        this.meta.delete(id);
        this.onDrop?.(tag);
      });
    return true;
  }

  /** Libera el worker (y con él el modelo). */
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.meta.clear();
    this.inflight = 0;
  }
}
