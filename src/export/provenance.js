// Procedencia del análisis (bloque `analysis` del JSON público): con qué versiones y parámetros se han
// calculado las métricas, para poder comparar sesiones analizadas con versiones distintas de la app.
// No lleva nada del dispositivo ni del paciente (ni modelo de móvil, ni navegador). Sin DOM.
import { EVENT_DEFAULTS } from '../protocol/events.js';
import { SHUT_FRACTION, SHUT_PAD_MS } from '../flow/processor.js';
import { SUMMARY } from '../protocol/summary.js';
import { FLOW_CONFIGS, DEFAULT_FLOW, OPENCV_VERSION, FARNEBACK_PARAMS } from '../flow/config.js';

/** Nombre del modelo de MediaPipe (el de `public/modelos`; la versión va en el nombre). */
export const MODEL_NAME = 'face_landmarker_float16_1';

/** Parámetros del detector de eventos que se exportan (los que cambian lo que se cuenta). */
export const DETECTOR_KEYS = ['riseMargin', 'riseFloor', 'spikyRatio', 'endRatio', 'minDurationMs', 'headK', 'headFloor', 'headMax', 'marginMs', 'blinkMin'];

const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * @param {{flowConfig?: string|null}} [o] flowConfig: clave de FLOW_CONFIGS con que se calculó el flujo.
 *   El detector de eventos usa siempre EVENT_DEFAULTS (la app no lo deja cambiar).
 */
export function provenance({ flowConfig = DEFAULT_FLOW } = {}) {
  const cfg = FLOW_CONFIGS[flowConfig] ?? FLOW_CONFIGS[DEFAULT_FLOW];
  return {
    mediapipe: { version: typeof __MEDIAPIPE_VERSION__ !== 'undefined' ? __MEDIAPIPE_VERSION__ : null, model: MODEL_NAME },
    opencv: { version: OPENCV_VERSION },
    flow: {
      config: cfg.key,
      method: cfg.method,
      maxWidth: cfg.maxWidth || null,
      maxRate: cfg.maxRate || null,
      params: cfg.method === 'farneback' ? { ...FARNEBACK_PARAMS[cfg.params] } : null,
    },
    detector: Object.fromEntries(DETECTOR_KEYS.map((k) => [k, num(EVENT_DEFAULTS[k])])),
    closureFreeze: { earFraction: SHUT_FRACTION, padMs: SHUT_PAD_MS },
    summary: { incompleteRatio: SUMMARY.incompleteRatio, coactLagMs: SUMMARY.coactLagMs, minAnalysisFps: SUMMARY.minAnalysisFps },
  };
}
