// Cámara en directo: abre el stream, lo cambia de cámara y mide los fps reales.
// La lógica sin DOM está en camera-logic.js.

import { buildConstraints, resolveFacing, FpsMeter } from './camera-logic.js';

export class Camera {
  /** @param {HTMLVideoElement} video */
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.meter = new FpsMeter(1000);
    this.onFrame = null; // (fps) => void
    this.onVideoFrame = null; // (now, meta) => void, una vez por frame nuevo
    this._rvfc = null;
    this._raf = null;
    this.info = null;
  }

  static checkSupport() {
    if (!window.isSecureContext) {
      const e = new Error('Contexto no seguro');
      e.name = 'InsecureContext';
      throw e;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('getUserMedia no disponible');
      e.name = 'Unsupported';
      throw e;
    }
  }

  /** Lista de cámaras (los nombres solo aparecen tras conceder permiso). */
  static async listDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  /**
   * Abre la cámara.
   * @param {{ facing: 'rear'|'front', deviceId?: string|null, priority: 'resolution'|'fps' }} opts
   */
  async start(opts) {
    Camera.checkSupport();
    this.stop();
    const stream = await Camera._open(opts);
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings?.() ?? {};
    const caps = track.getCapabilities?.() ?? null;
    this.info = {
      label: track.label,
      deviceId: settings.deviceId ?? null,
      facing: resolveFacing(settings, track.label, opts.facing),
      width: settings.width ?? this.video.videoWidth,
      height: settings.height ?? this.video.videoHeight,
      frameRate: settings.frameRate ?? null,
      maxWidth: caps?.width?.max ?? null,
      maxHeight: caps?.height?.max ?? null,
      maxFrameRate: caps?.frameRate?.max ?? null,
      priority: opts.priority,
      strictFps: stream.strictFps,
    };
    this._startMeter();
    return this.info;
  }

  /** En prioridad «fps», intenta primero exigir ≥55 fps; si no se puede, sin exigirlos. */
  static async _open(opts) {
    if (opts.priority === 'fps') {
      try {
        const s = await navigator.mediaDevices.getUserMedia(buildConstraints({ ...opts, strict: true }));
        s.strictFps = true;
        return s;
      } catch (err) {
        if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotReadableError') throw err;
      }
    }
    const s = await navigator.mediaDevices.getUserMedia(buildConstraints(opts));
    s.strictFps = false;
    return s;
  }

  /** Resolución real de los frames que llegan (puede diferir de getSettings). */
  get frameSize() {
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  _startMeter() {
    this.meter.reset();
    const v = this.video;
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const tick = (now, meta) => {
        if (!this.stream) return;
        // mediaTime es el instante de captura del frame; si no, el de presentación.
        const t = meta?.mediaTime != null ? meta.mediaTime * 1000 : now;
        const fps = this.meter.push(t, meta?.presentedFrames);
        this.onFrame?.(fps);
        this.onVideoFrame?.(now, meta); // análisis del frame (landmarks)
        this._rvfc = v.requestVideoFrameCallback(tick);
      };
      this._rvfc = v.requestVideoFrameCallback(tick);
    } else {
      // Respaldo: cuenta cambios de currentTime en cada repintado.
      let lastTime = -1;
      const tick = (now) => {
        if (!this.stream) return;
        if (v.currentTime !== lastTime) {
          lastTime = v.currentTime;
          this.onFrame?.(this.meter.push(now));
          this.onVideoFrame?.(now);
        }
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
  }

  stop() {
    if (this._rvfc != null && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this._rvfc);
    }
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._rvfc = this._raf = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
