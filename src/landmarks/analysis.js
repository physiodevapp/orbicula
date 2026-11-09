// Análisis en el hilo principal: respaldo si el worker no puede arrancar.
// Tiene la misma interfaz que WorkerAnalysis (ver worker-client.js).
import { createLandmarker, assetUrls } from './landmarker.js';
import { processResult } from './process.js';
import { FpsMeter } from '../capture/camera-logic.js';
import { sourceSize } from '../capture/source.js';

export class Analysis {
  constructor() {
    this.mode = 'main';
    this.landmarker = null;
    this.delegate = null;
    this._loading = null;
    /**
     * La imagen ANALIZADA va en espejo. getUserMedia entrega los frames sin espejo también
     * con la cámara frontal (el espejo de la vista previa es solo CSS), así que en directo
     * es siempre false. Será true en el modo de vídeo grabado si el archivo está en espejo.
     */
    this.frameMirrored = false;
    /** Los nombres Left/Right de los blendshapes siguen el criterio contrario al del mallado. */
    this.swapNames = false;
    this.ms = 0; // tiempo medio de análisis por frame (media móvil)
    this.meter = new FpsMeter(1000);
    this.analysisSize = null;
    this.onResult = null;
    this.inflight = 0; // misma interfaz que WorkerAnalysis: aquí el análisis es síncrono
  }

  get ready() {
    return !!this.landmarker;
  }

  get fps() {
    return this.meter.fps;
  }

  load(blendshapes = true) {
    this._loading ??= createLandmarker({ ...assetUrls(), blendshapes }).then(({ landmarker, delegate }) => {
      this.landmarker = landmarker;
      this.delegate = delegate;
    });
    return this._loading;
  }

  setBlendshapes(on) {
    return this.landmarker?.setOptions({ outputFaceBlendshapes: on });
  }

  /** Libera el modelo. */
  dispose() {
    this.landmarker?.close();
    this.landmarker = null;
    this._loading = null;
  }

  /** Modo IMAGE (vídeo grabado, fase 6): cada fotograma por separado. */
  async setImageMode(on) {
    await this.landmarker?.setOptions({ runningMode: on ? 'IMAGE' : 'VIDEO' });
    this.imageMode = !!on;
  }

  /** Analiza el frame actual del vídeo (o un VideoFrame) y entrega el resultado por `onResult`. */
  submit(video, t) {
    const frame = sourceSize(video);
    if (!this.landmarker || !frame) return;
    this.analysisSize = frame;
    const t0 = performance.now();
    const res = this.imageMode ? this.landmarker.detect(video) : this.landmarker.detectForVideo(video, t0);
    const t1 = performance.now();
    this.ms = this.ms ? this.ms * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
    this.meter.push(t1);
    this.onResult?.({
      t,
      ms: t1 - t0,
      ...processResult(res, frame, { frameMirrored: this.frameMirrored, swapNames: this.swapNames }),
    });
  }
}
