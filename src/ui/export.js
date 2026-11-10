// Descarga del JSON público y del CSV (fase 7). Todo local: sin red.
import { buildPublicResult, medianCameraFps } from '../export/result.js';
import { faceCsv, flowCsv } from '../export/csv.js';
import { downloadJson, downloadText, stamp } from './share.js';

const safeCode = (code) => (code ?? '').trim().replace(/[^\w-]/g, '');
const suffix = (code) => (safeCode(code) ? `-${safeCode(code)}` : '');

/** Descarga el JSON público. Devuelve el texto de confirmación. */
export function exportJson({ results, capture, code, appVersion }) {
  const doc = buildPublicResult({ results, capture, appVersion, participantCode: safeCode(code) || null });
  const { name, size } = downloadJson(doc, `orbicula-resultados-${stamp()}${suffix(code)}.json`);
  return `Descargado: ${name} (${Math.round(size / 1024)} KB).`;
}

/** Descarga los dos CSV (cara y flujo). */
export function exportCsv({ results, code }) {
  const s = stamp();
  const a = downloadText(faceCsv(results), `orbicula-cara-${s}${suffix(code)}.csv`);
  // Dos descargas seguidas: Chrome puede pedir permiso para la segunda.
  const b = downloadText(flowCsv(results), `orbicula-flujo-${s}${suffix(code)}.csv`);
  return `Descargados: ${a.name} (${Math.round(a.size / 1024)} KB) y ${b.name} (${Math.round(b.size / 1024)} KB). Si el móvil pide permiso para descargar varios archivos, acéptalo.`;
}

/** `capture` del directo: la cámara de la app (la mediana de los fps de los pasos, o los actuales). */
export function liveCapture({ camera, results, mirrored = false }) {
  const info = camera.info;
  return {
    source: 'live',
    analysis: 'live',
    camera: info?.facing === 'front' ? 'front' : info?.facing === 'rear' ? 'rear' : null,
    fps: medianCameraFps(results) ?? camera.meter.fps ?? null,
    width: camera.frameSize?.width || null,
    height: camera.frameSize?.height || null,
    mirrored,
  };
}

/** `capture` de un vídeo grabado: ficha del archivo y lo que eligió quien lo analiza. */
export function fileCapture({ mp4, facing, mirrored, source = 'file' }) {
  return {
    source,
    analysis: 'frame-by-frame',
    camera: facing === 'front' ? 'front' : facing === 'rear' ? 'rear' : null,
    fps: mp4.timing?.fps ?? null,
    width: mp4.track?.width ?? null,
    height: mp4.track?.height ?? null,
    mirrored: !!mirrored,
  };
}
