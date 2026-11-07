// Análisis por frame: Face Landmarker → ROI y blendshapes por lado del paciente.
import { createLandmarker } from './landmarker.js';
import { buildRois } from '../roi/geometry.js';
import { sidedBlendshapes } from '../roi/laterality.js';
import { FpsMeter } from '../capture/camera-logic.js';

export class Analysis {
  /** @param {HTMLVideoElement} video */
  constructor(video) {
    this.video = video;
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
  }

  get ready() {
    return !!this.landmarker;
  }

  get fps() {
    return this.meter.fps;
  }

  /** Carga el modelo (una sola vez). Rechaza si no se puede. */
  load() {
    this._loading ??= createLandmarker().then(({ landmarker, delegate }) => {
      this.landmarker = landmarker;
      this.delegate = delegate;
    });
    return this._loading;
  }

  /**
   * Analiza el frame actual del vídeo.
   * @returns {null | {frame, face: false} | {frame, face: true, lm, rois, blend}}
   *   null si el modelo aún no está listo o el vídeo no tiene frame.
   */
  step() {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || !v.videoWidth) return null;
    const frame = { width: v.videoWidth, height: v.videoHeight };

    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(v, t0);
    const t1 = performance.now();
    this.ms = this.ms ? this.ms * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
    this.meter.push(t1);

    const lm = res.faceLandmarks?.[0];
    if (!lm) return { frame, face: false };
    const opts = { frameMirrored: this.frameMirrored };
    return {
      frame,
      face: true,
      lm,
      rois: buildRois(lm, frame, opts),
      blend: sidedBlendshapes(res.faceBlendshapes?.[0]?.categories, { ...opts, swapNames: this.swapNames }),
    };
  }
}
