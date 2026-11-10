// Tarjeta «Vídeo grabado» (fase 6). Paso 6a: elegir un archivo, ver su ficha y probar cuánto tarda el
// móvil en decodificarlo. Todo en el dispositivo: el archivo no sale de él y no se guarda copia.
import { openMp4 } from '../video/mp4.js';
import { canDecode } from '../video/decode.js';
import { probeDecode } from '../video/probe.js';
import { downloadJson, copyJson, stamp } from './share.js';
import { buildReport } from '../assistant/report.js';
import { summarizeProtocol } from '../protocol/summary.js';
import { renderSummary } from './summary.js';
import { exportJson, exportCsv, fileCapture } from './export.js';

export const VIDEO_PROBE_SCHEMA = 'orbicula-video-probe/1';
const $ = (id) => document.getElementById(id);
const nf = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

/**
 * @param {{getContext: () => {build: object, device: object},
 *          analyzeVideoFile?: (o: object) => Promise<{results: object[], stats: object, context: object}>}} deps
 */
export function createVideoCard({ getContext, analyzeVideoFile = null }) {
  const el = {
    file: $('vidFile'), info: $('vidInfo'), probe: $('vidProbe'), cancel: $('vidCancel'), bar: $('vidBar'), barWrap: $('vidBarWrap'),
    result: $('vidResult'), thumb: $('vidThumb'), out: $('vidOut'), download: $('vidDownload'), copy: $('vidCopy'), msg: $('vidMsg'),
    facing: $('vidFacing'), mirror: $('vidMirror'),
    rest: $('vidRest'), cap: $('vidCap'), analyze: $('vidAnalyze'), aCancel: $('vidACancel'), aBar: $('vidABar'), aBarWrap: $('vidABarWrap'),
    progress: $('vidProgress'), summary: $('vidSummary'),
    exportRow: $('vidExport'), exportJson: $('vidExportJson'), exportCsv: $('vidExportCsv'), code: $('vidCode'),
  };
  let analysis = null; // { results, stats, context, settings, startedAt }
  // Un archivo elegido antes de recargar la página puede seguir en el selector sin permiso para leerlo.
  el.file.value = '';
  let mp4 = null;
  let fileMeta = null;
  let support = null;
  let probe = null;
  let abort = null;

  const report = () => ({
    app: 'orbicula', kind: 'video-probe', schema: VIDEO_PROBE_SCHEMA, createdAt: new Date().toISOString(),
    note: 'Ficha y prueba de lectura de un vídeo grabado. Sin imágenes ni el nombre del archivo.',
    ...getContext(),
    file: fileMeta,
    recordedWith: { facing: el.facing.value, mirrored: el.mirror.checked },
    container: mp4?.container ?? null, track: mp4?.track ?? null, timing: mp4?.timing ?? null,
    support, probe,
  });

  function showInfo() {
    const t = mp4.track;
    const m = mp4.timing;
    el.info.textContent = [
      `Códec ${t.codec} · ${t.codedWidth}×${t.codedHeight}${t.rotation ? ` · girado ${t.rotation}° → ${t.width}×${t.height}` : ''}`,
      `${nf(m.durationMs / 1000, 1)} s · ${t.samples} fotogramas · ${nf(m.fps, 1)} fps${m.variable ? ` (variable: ${nf(m.minMs, 1)}–${nf(m.maxMs, 1)} ms entre fotogramas)` : ''}`,
      `${t.keyframes} fotogramas clave${t.bitrateKbps ? ` · ${nf(t.bitrateKbps / 1000, 1)} Mb/s` : ''}${mp4.container.hasAudio ? ' · con audio' : ''}`,
      support.supported ? 'El navegador lo puede decodificar.' : `NO se puede decodificar: ${support.reason}. Prueba a grabar en H.264 («Más compatible» en la app de cámara).`,
    ].join('\n');
  }

  el.file.addEventListener('change', async () => {
    const file = el.file.files?.[0];
    mp4 = null; probe = null; support = null; analysis = null;
    el.summary.hidden = true; el.progress.textContent = ''; el.exportRow.hidden = true;
    el.result.textContent = ''; el.msg.textContent = ''; el.out.hidden = true; el.probe.disabled = true;
    el.thumb.hidden = true;
    if (!file) return;
    fileMeta = { sizeMB: Math.round((file.size / 1048576) * 10) / 10, type: file.type || null };
    el.info.textContent = 'Leyendo el índice del archivo…';
    try {
      mp4 = await openMp4(file);
      support = await canDecode(mp4.decoderConfig);
      showInfo();
      el.probe.disabled = !support.supported;
      el.analyze.disabled = !support.supported || !analyzeVideoFile;
      el.cap.checked = (mp4.timing.fps ?? 0) > 40;
      el.out.hidden = false;
    } catch (err) {
      el.info.textContent = err?.name === 'NotReadableError'
        ? 'El móvil no deja leer el archivo. Vuelve a elegirlo; si sigue, elígelo desde la app «Archivos».'
        : `No se pudo leer: ${err?.message ?? err}. ¿Es un vídeo MP4 de la app de cámara?`;
    }
  });

  el.probe.addEventListener('click', async () => {
    if (!mp4) return;
    abort = new AbortController();
    el.probe.disabled = true; el.cancel.hidden = false; el.barWrap.hidden = false; el.result.textContent = 'Decodificando…';
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* sin bloqueo de pantalla */ }
    try {
      probe = await probeDecode(mp4, {
        seconds: 15,
        signal: abort.signal,
        onProgress: (f) => { el.bar.style.width = `${Math.round(f * 100)}%`; },
        thumb: (bmp) => {
          el.thumb.width = bmp.width; el.thumb.height = bmp.height;
          el.thumb.getContext('2d').drawImage(bmp, 0, 0);
          bmp.close(); el.thumb.hidden = false;
        },
      });
      const p = probe;
      el.result.textContent = [
        `${p.decodedFrames} de ${p.expectedFrames} fotogramas de los primeros ${nf(p.seconds, 1)} s${p.outOfOrder ? ` · ${p.outOfOrder} fuera de orden` : ''}`,
        `${nf(p.framesPerSecond, 1)} fotogramas/s decodificando y girando (${nf(p.realtimeFactor, 2)} × tiempo real)`,
        `Por fotograma: leer ${nf(p.readMsPerFrame, 1)} ms (${p.fileReads} lecturas del archivo${p.readFallback ? `; bloques grandes fallaron: ${p.readFallback}` : ''}) · girar ${nf(p.rotateMsPerFrame, 1)} ms · decodificar y esperar ${nf(p.otherMsPerFrame, 1)} ms`,
        `Imagen ya girada: ${p.outputSize ? `${p.outputSize.width}×${p.outputSize.height}` : '—'}. Comprueba en la miniatura que la cara está derecha.`,
      ].join('\n');
    } catch (err) {
      const unreadable = err?.name === 'NotReadableError';
      el.result.textContent = err?.name === 'AbortError' ? 'Cancelado.'
        : unreadable ? 'El móvil no deja leer el archivo (el permiso ha caducado o es una copia temporal). Vuelve a elegirlo con «Seleccionar archivo» y prueba enseguida; si sigue, elígelo desde la app «Archivos» en vez de desde Fotos o la Galería.'
        : `Error al decodificar: ${err?.message ?? err}`;
      if (err?.name !== 'AbortError') probe = { error: String(err?.message ?? err), errorName: err?.name ?? null, readStats: { ...mp4.readStats } };
    } finally {
      wake?.release?.().catch(() => {});
      el.probe.disabled = false; el.cancel.hidden = true; el.barWrap.hidden = true;
    }
  });
  el.cancel.addEventListener('click', () => abort?.abort());

  /** Informe del análisis: el mismo formato que el protocolo (orbicula-test-session/3), con la ficha del vídeo. */
  const analysisReport = (includeSeries = true) => {
    const a = analysis;
    return buildReport({
      results: a.results, startedAt: a.startedAt, plan: 'video', settings: a.settings,
      summary: summarizeProtocol(a.results), includeSeries,
      video: { file: fileMeta, recordedWith: { facing: el.facing.value, mirrored: el.mirror.checked }, container: mp4.container, track: mp4.track, timing: mp4.timing, processing: a.stats },
      ...a.context,
    });
  };

  el.analyze.addEventListener('click', async () => {
    if (!mp4 || !analyzeVideoFile) return;
    abort = new AbortController();
    const settings = { restSec: Number(el.rest.value) || 30, maxFps: el.cap.checked ? 30 : 0, facing: el.facing.value, mirrored: el.mirror.checked };
    el.analyze.disabled = true; el.probe.disabled = true; el.aCancel.hidden = false; el.aBarWrap.hidden = false;
    el.summary.hidden = true; el.exportRow.hidden = true; el.msg.textContent = '';
    el.progress.textContent = 'Preparando el análisis (modelo de la cara y flujo óptico)…';
    let wake = null;
    try { wake = await navigator.wakeLock?.request('screen'); } catch { /* sin bloqueo de pantalla */ }
    const startedAt = new Date().toISOString();
    try {
      const out = await analyzeVideoFile({
        mp4, mirrored: el.mirror.checked, restSec: settings.restSec, maxFps: settings.maxFps, signal: abort.signal,
        onProgress: (p) => {
          el.aBar.style.width = `${Math.round((p.done / p.total) * 100)}%`;
          el.progress.textContent = `Fotograma ${p.done} de ${p.total} · ${mmss(p.t)} de ${mmss(p.durationMs)} del vídeo${p.etaMs != null ? ` · quedan unos ${mmss(p.etaMs)}` : ''}`;
        },
      });
      analysis = { ...out, settings, startedAt };
      const s = out.stats;
      el.progress.textContent = `Hecho: ${s.frames} fotogramas en ${mmss(s.elapsedMs)} (${nf(s.framesPerSecond, 1)}/s)${s.every > 1 ? `, uno de cada ${s.every}` : ''}.`;
      renderSummary(el.summary, summarizeProtocol(out.results), out.results);
      el.exportRow.hidden = false;
    } catch (err) {
      el.progress.textContent = err?.name === 'AbortError' ? 'Cancelado.'
        : err?.name === 'NotReadableError' ? 'El móvil no deja leer el archivo. Vuelve a elegirlo y analiza enseguida.'
        : `No se pudo analizar: ${err?.message ?? err}`;
    } finally {
      wake?.release?.().catch(() => {});
      el.analyze.disabled = false; el.probe.disabled = !support?.supported; el.aCancel.hidden = true; el.aBarWrap.hidden = true;
    }
  });
  const exportInput = () => ({ results: analysis.results, code: el.code.value, capture: fileCapture({ mp4, facing: el.facing.value, mirrored: el.mirror.checked }) });
  el.exportJson.addEventListener('click', () => { if (analysis) el.msg.textContent = exportJson({ ...exportInput(), appVersion: analysis.context?.build?.version ?? '', flowConfig: analysis.context?.flow?.config }); });
  el.exportCsv.addEventListener('click', () => { if (analysis) el.msg.textContent = exportCsv(exportInput()); });
  el.aCancel.addEventListener('click', () => abort?.abort());

  el.download.addEventListener('click', () => {
    if (analysis) {
      const { name, size } = downloadJson(analysisReport(true), `orbicula-video-analisis-${stamp()}.json`);
      el.msg.textContent = `Descargado: ${name} (${Math.round(size / 1024)} KB).`;
      return;
    }
    const { name, size } = downloadJson(report(), `orbicula-video-${stamp()}.json`);
    el.msg.textContent = `Descargado: ${name} (${Math.round(size / 1024)} KB).`;
  });
  el.copy.addEventListener('click', async () => {
    try { await copyJson(analysis ? analysisReport(false) : report()); el.msg.textContent = 'Copiado. Pégalo en la conversación.'; } catch (err) { el.msg.textContent = `No se pudo copiar (${err?.message ?? err}).`; }
  });

  return { report };
}
