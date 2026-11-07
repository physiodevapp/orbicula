// Lógica pura de la captura (sin DOM): restricciones, cámara obtenida, errores y fps.
// Se prueba en tests/camera-logic.test.js.

/** Lo que se pide a la cámara: 60 fps siempre. */
export const REQUESTED_FPS = 60;

/**
 * Prioridades de captura. Muchos móviles no dan 60 fps a 4K: «resolución» pide
 * lo máximo y acepta los fps que salgan; «fps» se conforma con 1280×720 para
 * que el sensor pueda ir a 60.
 */
export const PRIORITIES = {
  resolution: { width: 4096, height: 2160 },
  fps: { width: 1280, height: 720 },
};

/** Mínimo que se exige en el intento estricto de la prioridad «fps». */
export const STRICT_MIN_FPS = 55;

/**
 * Restricciones para getUserMedia.
 *
 * Con frameRate solo «ideal», Chrome para Android se queda en 30 fps aunque la
 * cámara anuncie 60. Por eso la prioridad «fps» hace primero un intento estricto
 * (`strict`), con un mínimo de 55 fps; si la cámara no puede, se repite sin él.
 * @param {{ facing?: 'rear'|'front', deviceId?: string|null, priority?: keyof PRIORITIES, strict?: boolean }} opts
 */
export function buildConstraints({ facing = 'rear', deviceId = null, priority = 'resolution', strict = false } = {}) {
  const size = PRIORITIES[priority] ?? PRIORITIES.resolution;
  const video = {
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: strict ? { min: STRICT_MIN_FPS, ideal: REQUESTED_FPS } : { ideal: REQUESTED_FPS },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: facing === 'front' ? 'user' : 'environment' };
  return { audio: false, video };
}

/**
 * Qué cámara se ha obtenido de verdad. Se fía primero de facingMode de la pista;
 * si el navegador no lo da, del nombre del dispositivo; si tampoco, de lo pedido.
 * @returns {'rear'|'front'}
 */
export function resolveFacing(settings = {}, label = '', requested = 'rear') {
  if (settings.facingMode === 'user') return 'front';
  if (settings.facingMode === 'environment') return 'rear';
  const l = label.toLowerCase();
  if (/front|frontal|user|delantera|selfie/.test(l)) return 'front';
  if (/back|rear|trasera|environment/.test(l)) return 'rear';
  return requested;
}

/** Mensaje en español para un error de getUserMedia. */
export function describeError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permiso de cámara denegado. Actívalo en los ajustes del sitio (candado de la barra de direcciones) y vuelve a intentarlo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No se encuentra una cámara que cumpla lo pedido. Prueba con la otra cámara.';
    case 'NotReadableError':
    case 'AbortError':
      return 'La cámara está ocupada por otra app o pestaña. Ciérrala y vuelve a intentarlo.';
    case 'InsecureContext':
      return 'La cámara solo funciona con HTTPS. Abre la app desde su dirección https://.';
    case 'Unsupported':
      return 'Este navegador no permite usar la cámara. Usa Chrome para Android.';
    default:
      return `No se pudo abrir la cámara (${err?.name ?? 'error'}: ${err?.message ?? 'desconocido'}).`;
  }
}

/** Estado de los fps medidos respecto al mínimo de la v0 (24 fps en directo). */
export const MIN_LIVE_FPS = 24;
export function fpsLevel(fps) {
  if (!Number.isFinite(fps) || fps <= 0) return 'none';
  if (fps >= MIN_LIVE_FPS) return 'ok';
  if (fps >= MIN_LIVE_FPS * 0.75) return 'warn';
  return 'bad';
}

/**
 * Medidor de fps reales: cuenta los frames de vídeo entregados en una ventana
 * deslizante. Usa el reloj de los frames (requestVideoFrameCallback), no el de
 * la pantalla, así que mide lo que entrega la cámara.
 */
export class FpsMeter {
  /** @param {number} windowMs duración de la ventana, en ms */
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
    this.times = [];
    this.counts = [];
  }

  /**
   * Registra un frame y devuelve los fps actuales.
   * @param {number} t marca de tiempo del frame, en ms
   * @param {number} [count] contador de frames presentados (`presentedFrames`): si se da,
   *   los fps cuentan también los frames que el análisis ha dejado sin atender.
   */
  push(t, count) {
    const last = this.times[this.times.length - 1];
    // Un frame repetido (misma marca) no cuenta.
    if (last !== undefined && t <= last) return this.fps;
    this.times.push(t);
    this.counts.push(count ?? null);
    const from = t - this.windowMs;
    while (this.times.length > 2 && this.times[0] < from) {
      this.times.shift();
      this.counts.shift();
    }
    return this.fps;
  }

  /**
   * fps = el mayor de dos recuentos, porque ambos se quedan cortos y ninguno se pasa:
   *  - los callbacks de vídeo, que se pierden si el hilo principal está ocupado (en el móvil del autor,
   *    con la trasera a 4K, 44 en el worker y 20 en el hilo principal frente a unos 53 reales);
   *  - el contador `presentedFrames`, que con la frontal se quedó por debajo de los frames analizados.
   */
  get fps() {
    const n = this.times.length;
    if (n < 2) return 0;
    const span = this.times[n - 1] - this.times[0];
    if (span <= 0) return 0;
    const byCallbacks = ((n - 1) * 1000) / span;
    const c0 = this.counts[0];
    const c1 = this.counts[n - 1];
    const byCount = c0 != null && c1 != null && c1 > c0 ? ((c1 - c0) * 1000) / span : 0;
    return Math.max(byCallbacks, byCount);
  }

  reset() {
    this.times = [];
    this.counts = [];
  }
}
