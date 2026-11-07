// Cliente del worker de flujo óptico (hilo principal).
//
// En cada frame de la cámara (hasta 60/s, no solo los que analiza MediaPipe) recorta la franja
// periocular del frame COMPLETO con createImageBitmap (en la GPU), la reduce al tamaño de trabajo y
// la manda al worker con su marca de tiempo de captura. La franja sale de las últimas ROI de
// MediaPipe y solo se recoloca cuando la cara se sale de ella.
import FlowWorker from './flow.worker.js?worker';
import { FLOW_CONFIGS, DEFAULT_FLOW, OPENCV_VERSION, FARNEBACK_PARAMS } from './config.js';
import { stripFromRois, needsNewStrip, workingSize } from './strip.js';
import { FpsMeter } from '../capture/camera-logic.js';
import { RateLimiter } from './rate.js';
import { ROI_KEYS, toWork } from './metrics.js';

/** Frames en vuelo: uno calculándose y otro preparándose. Si están los dos, el frame se descarta. */
const MAX_IN_FLIGHT = 2;

const emptyCounts = () => ({ submitted: 0, busy: 0, noStrip: 0, replaced: 0, capped: 0 });

export class FlowClient {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.loadMs = null;
    this.config = FLOW_CONFIGS[DEFAULT_FLOW];
    this.strip = null; // {x, y, w, h} en píxeles del frame completo
    this.stripId = 0;
    this.work = null; // {width, height, scale} del recorte que se manda
    this.frame = null; // tamaño del frame completo de la última franja
    this.inflight = 0;
    this.seq = 0;
    this.ms = 0; // media móvil de los ms de flujo
    this.meter = new FpsMeter(1000); // pares de frames con flujo por segundo
    this.counts = emptyCounts();
    this.limiter = new RateLimiter(this.config.maxRate); // límite de pares por segundo
    this.rateCap = 0; // rebaja automática (0 = ninguna) cuando el análisis de la cara no llega (governor.js)
    this.videoFrameOk = typeof VideoFrame === 'function'; // se apaga si `new VideoFrame(video)` falla
    this.blockedHosts = new Set();
    this.meta = new Map(); // id → {submitAt, cropMs}
    this.onResult = null;
    this.polys = null; // polígonos de las ROI en píxeles de trabajo (orden de ROI_KEYS)
    this.polyId = 0;
    this.wantField = false; // pedir al worker una muestra del campo de flujo (para dibujarlo)
    this._loading = null;
  }

  get fps() {
    return this.meter.fps;
  }

  /** Arranca el worker y carga OpenCV.js (13 MB; solo la primera vez, luego desde la caché). */
  load() {
    this._loading ??= new Promise((resolve, reject) => {
      const worker = new FlowWorker();
      this.worker = worker;
      worker.onerror = (e) => reject(new Error(e.message || 'No se pudo cargar el worker de flujo'));
      worker.onmessage = ({ data: m }) => {
        switch (m.type) {
          case 'ready':
            this.ready = true;
            this.loadMs = m.loadMs;
            resolve();
            break;
          case 'error':
            reject(new Error(m.message));
            break;
          case 'result': {
            this.inflight = Math.max(0, this.inflight - 1);
            const now = performance.now();
            const meta = this.meta.get(m.id);
            this.meta.delete(m.id);
            if (meta) {
              m.cropMs = meta.cropMs; // recorte y reducción del frame en el hilo principal
              m.roundTripMs = now - meta.submitAt;
              m.scale = meta.scale;
              m.strip = meta.strip; // franja de este par (las métricas pasan de px de trabajo al frame)
            }
            if (m.paired) {
              this.ms = this.ms ? this.ms * 0.9 + m.flowMs * 0.1 : m.flowMs;
              this.meter.push(now);
            }
            this.onResult?.(m);
            break;
          }
          case 'blocked':
            this.blockedHosts.add(m.host);
            break;
          case 'skipped':
          case 'frameError':
            this.inflight = Math.max(0, this.inflight - 1);
            this.meta.delete(m.id);
            break;
        }
      };
      const opencvUrl = new URL(`opencv/${OPENCV_VERSION}/opencv.js`, document.baseURI).href;
      worker.postMessage({ type: 'init', opencvUrl });
    });
    return this._loading;
  }

  /** Cambia la configuración (método y tamaño de trabajo). El siguiente par no se mide. */
  setConfig(key) {
    const c = FLOW_CONFIGS[key];
    if (!c || c === this.config) return;
    this.config = c;
    if (this.strip) this.work = workingSize(this.strip, c.maxWidth);
    this.stripId++;
    this.polys = null; // con otra escala, los polígonos se recalculan con el siguiente análisis
    this.limiter = new RateLimiter(this.effectiveRate);
  }

  /** Pares por segundo como máximo: el de la configuración, rebajado por `rateCap` si lo hay. */
  get effectiveRate() {
    const out = Math.min(this.config.maxRate || Infinity, this.rateCap || Infinity);
    return Number.isFinite(out) ? out : 0;
  }

  /** Rebaja (o quita, con 0) el límite de pares por segundo sin cambiar de configuración. */
  setRateCap(cap) {
    if (cap === this.rateCap) return;
    this.rateCap = cap;
    this.limiter = new RateLimiter(this.effectiveRate);
  }

  /** Últimas ROI de MediaPipe: recoloca la franja si la cara se ha salido de ella. */
  setFace(result) {
    if (!result?.face) return;
    const frameChanged = !this.frame || this.frame.width !== result.frame.width || this.frame.height !== result.frame.height;
    if (frameChanged || needsNewStrip(this.strip, result.rois, result.frame)) {
      const strip = stripFromRois(result.rois, result.frame);
      if (!strip) return;
      if (this.strip) this.counts.replaced++;
      this.strip = strip;
      this.frame = { ...result.frame };
      this.work = workingSize(strip, this.config.maxWidth);
      this.stripId++;
    }
    this.#setPolys(result.rois);
  }

  /** Polígonos de las ROI pasados a píxeles de trabajo de la franja actual. */
  #setPolys(rois) {
    if (!this.strip || !this.work) return;
    this.polys = ROI_KEYS.map((key) => {
      const [side, name] = key.split('.');
      const poly = key === 'reference' ? rois.reference.polygon : rois[side][name].polygon;
      return toWork(poly, this.strip, this.work.scale);
    });
    this.polyId++;
  }

  /** Olvida la franja (otra cámara u otra resolución). */
  resetStrip() {
    this.polys = null;
    this.strip = null;
    this.work = null;
    this.frame = null;
    this.stripId++;
  }

  resetCounts() {
    this.counts = emptyCounts();
  }

  /** Recorta la franja del frame actual y la manda al worker. */
  submit(video, t) {
    if (!this.ready || video.readyState < 2 || !video.videoWidth) return;
    if (!this.strip || video.videoWidth !== this.frame.width || video.videoHeight !== this.frame.height) {
      this.counts.noStrip++;
      return;
    }
    if (this.inflight >= MAX_IN_FLIGHT) {
      this.counts.busy++;
      return;
    }
    if (!this.limiter.allow(t)) {
      this.counts.capped++;
      return;
    }
    const { x, y, w, h } = this.strip;
    const work = this.work;
    const id = ++this.seq;
    const base = {
      type: 'frame', id, t, stripId: this.stripId, method: this.config.method,
      params: FARNEBACK_PARAMS[this.config.params],
      polys: this.polys, polyId: this.polyId, wantField: this.wantField,
    };
    const submitAt = performance.now();
    this.counts.submitted++;
    this.inflight++;

    if (this.config.source === 'videoframe' && this.videoFrameOk) {
      // El frame completo pasa al worker (sin copiar: se transfiere) y allí se lee solo el plano Y.
      let frame = null;
      try {
        frame = new VideoFrame(video, { timestamp: Math.round(t * 1000) });
      } catch {
        this.videoFrameOk = false; // este navegador no lo admite: en adelante, el recorte de siempre
      }
      if (frame) {
        this.meta.set(id, { submitAt, cropMs: performance.now() - submitAt, scale: work.scale, strip: this.strip });
        this.worker.postMessage(
          { ...base, videoFrame: frame, rect: { x, y, w, h }, work: { width: work.width, height: work.height }, frameSize: { ...this.frame } },
          [frame],
        );
        return;
      }
    }

    this.meta.set(id, { submitAt, cropMs: null, scale: work.scale, strip: this.strip });
    createImageBitmap(video, x, y, w, h, { resizeWidth: work.width, resizeHeight: work.height, resizeQuality: 'medium' })
      .then((bitmap) => {
        const meta = this.meta.get(id);
        if (meta) meta.cropMs = performance.now() - submitAt;
        if (!this.worker) return bitmap.close();
        this.worker.postMessage({ ...base, bitmap }, [bitmap]);
      })
      .catch(() => {
        this.inflight = Math.max(0, this.inflight - 1);
        this.meta.delete(id);
      });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this._loading = null;
    this.meta.clear();
    this.inflight = 0;
  }
}
