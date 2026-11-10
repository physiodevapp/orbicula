// Grabación del protocolo y análisis fotograma a fotograma (fase 6c). El vídeo vive solo en la memoria
// del móvil (src/video/recorder.js): no se guarda, no se exporta y se borra al terminar el análisis, al
// descartarlo o al empezar otra sesión. Las fases salen de los tiempos de la sesión en directo.
import { FrameRecorder, recordingType } from '../video/recorder.js';
import { openRecording } from '../video/mp4.js';
import { protocolWindows, windowedSteps } from '../video/offline.js';
import { summarizeProtocol } from '../protocol/summary.js';
import { buildReport } from '../assistant/report.js';
import { renderSummary } from './summary.js';
import { downloadJson, stamp } from './share.js';
import { exportJson, exportCsv, fileCapture } from './export.js';

const $ = (id) => document.getElementById(id);
const nf = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');
const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;
/** Margen antes del primer paso y después del último que se analiza (ms). */
const MARGIN_MS = 1000;

/**
 * @param {{getStream: () => MediaStream|null,
 *          analyzeVideoFile: (o: object) => Promise<{results: object[], stats: object, context: object}>,
 *          saved?: ReturnType<import('./saved.js').createSavedCard>|null}} deps
 */
export function createProtocolVideo({ getStream, analyzeVideoFile, saved = null }) {
  const el = {
    record: $('prRecord'), recordRow: $('prRecordRow'), block: $('prRecBlock'), info: $('prRecInfo'), analyze: $('prRecAnalyze'),
    cancel: $('prRecCancel'), discard: $('prRecDiscard'), cap: $('prRecCap'), barWrap: $('prRecBarWrap'), bar: $('prRecBar'),
    progress: $('prRecProgress'), summary: $('prRecSummary'), download: $('prRecDownload'), msg: $('prRecMsg'),
    exportRow: $('prRecExport'), exportJson: $('prRecExportJson'), exportCsv: $('prRecExportCsv'), code: $('prCode'),
  };
  const recorder = new FrameRecorder();
  const supported = recordingType() != null;
  let recorded = null; // { blob, windows, steps, settings, startedAt, durationMs }
  let abort = null;
  let analysis = null; // resultado del análisis (para el JSON)
  let savedId = null; // sesión guardada de este análisis

  // Sin soporte, la casilla no se ofrece.
  if (el.recordRow) el.recordRow.hidden = !supported;
  if (el.record) el.record.checked = false;

  function forget() {
    recorder.discard();
    recorded = null;
    analysis = null;
    savedId = null;
    if (el.block) el.block.hidden = true;
    if (el.summary) el.summary.hidden = true;
  }

  function show(msg) { if (el.msg) el.msg.textContent = msg; }

  /** Antes de empezar el protocolo: arranca la grabación si la casilla está marcada. */
  async function beforeStart() {
    forget();
    if (!el.record?.checked) return;
    const stream = getStream();
    if (!stream) throw new Error('hace falta la cámara encendida para grabar el vídeo');
    await recorder.start(stream);
  }

  /** Cambios de estado de la tarjeta del protocolo. */
  async function onState(state, session, extra) {
    if (state === 'done' && recorder.rec) {
      const interrupted = !recorder.active || recorder.overflow;
      const blob = await recorder.stop();
      if (interrupted || !blob || recorder.startedAt == null) {
        forget();
        return;
      }
      const windows = protocolWindows(session.results, recorder.startedAt);
      if (!windows.length) { forget(); return; }
      recorded = { blob, windows, steps: session.steps, settings: extra.settings, startedAt: session.startedAt, durationMs: windows.at(-1).runEnd };
      // Tiempo estimado sin abrir el vídeo: ~33 fotogramas por segundo grabado y ~11 analizados por segundo
      // en el móvil del autor (8–13 según el calor).
      const frames = ((recorded.durationMs - recorded.windows[0].runStart + 2 * MARGIN_MS) / 1000) * 33;
      const min = (n) => Math.max(1, Math.round(n / 11 / 60));
      el.info.textContent = `Vídeo grabado durante el protocolo: ${nf(blob.size / 1048576, 0)} MB, solo en la memoria del móvil (no se guarda ni se exporta). Analizarlo fotograma a fotograma es más sensible que el directo. Tardará unos ${min(frames)} min con todos los fotogramas y unos ${min(frames / 2)} min con uno de cada dos.`;
      el.progress.textContent = '';
      el.summary.hidden = true;
      el.download.hidden = true;
      el.exportRow.hidden = true;
      el.analyze.disabled = false;
      el.cap.checked = false; // todos los fotogramas: es lo que hace más sensible al análisis
      el.block.hidden = false;
    } else if (state === 'idle' || state === 'aborted') {
      forget();
    }
  }

  el.analyze?.addEventListener('click', async () => {
    if (!recorded) return;
    abort = new AbortController();
    el.analyze.disabled = true; el.discard.disabled = true; el.cancel.hidden = false; el.barWrap.hidden = false;
    el.summary.hidden = true; el.download.hidden = true; el.exportRow.hidden = true; show('');
    el.progress.textContent = 'Preparando el análisis (modelo de la cara y flujo óptico)…';
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* sin bloqueo de pantalla */ }
    try {
      const mp4 = await openRecording(recorded.blob);
      const steps = windowedSteps(recorded.steps, recorded.windows);
      const out = await analyzeVideoFile({
        mp4, mirrored: false, steps, every: el.cap.checked ? 2 : 1,
        fromMs: Math.max(0, recorded.windows[0].runStart - MARGIN_MS), toMs: recorded.durationMs + MARGIN_MS,
        signal: abort.signal,
        onProgress: (p) => {
          el.bar.style.width = `${Math.round((p.done / p.total) * 100)}%`;
          el.progress.textContent = `Fotograma ${p.done} de ${p.total} · quedan unos ${p.etaMs != null ? mmss(p.etaMs) : '…'}`;
        },
      });
      const s = out.stats;
      analysis = { ...out, video: { source: 'recorded-during-protocol', sizeMB: Math.round((recorded.blob.size / 1048576) * 10) / 10, track: mp4.track, timing: mp4.timing, processing: s, windows: recorded.windows, capped: el.cap.checked } };
      el.progress.textContent = `Hecho: ${s.frames} fotogramas en ${mmss(s.elapsedMs)}. El vídeo se ha borrado de la memoria.`;
      renderSummary(el.summary, summarizeProtocol(out.results), out.results);
      el.download.hidden = false;
      el.exportRow.hidden = false;
      const keep = recorded;
      const header = await saved?.save({
        id: `protocol-video-${keep.startedAt}`, kind: 'protocol-video', code: el.code?.value.trim() || null,
        appVersion: out.context?.build?.version ?? '', flowConfig: out.context?.flow?.config,
        capture: fileCapture({ mp4: { timing: mp4.timing, track: mp4.track }, facing: out.context?.capture?.facing, mirrored: false, source: 'live' }),
        results: out.results, extra: { stats: s },
        meta: { phases: out.results.filter((r) => r.status === 'completed').length, durationMs: keep.durationMs },
      });
      savedId = header?.id ?? null;
      recorder.discard(); // el vídeo ya no hace falta
      recorded = null;
      keep.blob = null;
      el.info.textContent = '';
    } catch (err) {
      el.progress.textContent = err?.name === 'AbortError' ? 'Cancelado. El vídeo sigue en la memoria: puedes volver a analizarlo o descartarlo.'
        : `No se pudo analizar: ${err?.message ?? err}`;
    } finally {
      wake?.release?.().catch(() => {});
      el.analyze.disabled = !recorded; el.discard.disabled = false; el.cancel.hidden = true; el.barWrap.hidden = true;
      if (!recorded) el.discard.hidden = true;
    }
  });
  el.cancel?.addEventListener('click', () => abort?.abort());
  // Resultados (fase 7): la captura es la del vídeo que se grabó en directo (no hay archivo ni espejo).
  const exportInput = () => ({ results: analysis.results, code: el.code?.value, capture: fileCapture({ mp4: { timing: analysis.video.timing, track: analysis.video.track }, facing: analysis.context?.capture?.facing, mirrored: false, source: 'live' }) });
  el.exportJson?.addEventListener('click', () => {
    if (!analysis) return;
    show(exportJson({ ...exportInput(), appVersion: analysis.context?.build?.version ?? '', flowConfig: analysis.context?.flow?.config }));
    saved?.patchCode(savedId, el.code?.value);
  });
  el.exportCsv?.addEventListener('click', () => {
    if (!analysis) return;
    show(exportCsv(exportInput()));
    saved?.patchCode(savedId, el.code?.value);
  });
  el.discard?.addEventListener('click', () => { forget(); show('Vídeo descartado.'); });
  el.download?.addEventListener('click', () => {
    if (!analysis) return;
    const a = analysis;
    const report = buildReport({
      results: a.results, startedAt: recorded?.startedAt ?? null, plan: 'protocol', settings: a.settings ?? null,
      summary: summarizeProtocol(a.results), video: a.video, includeSeries: true, ...a.context,
    });
    const { name, size } = downloadJson(report, `orbicula-protocolo-video-${stamp()}.json`);
    show(`Descargado: ${name} (${Math.round(size / 1024)} KB).`);
  });

  return { beforeStart, onState, forget, supported };
}
