// Tarjeta «Vídeo grabado» (fase 6). Paso 6a: elegir un archivo, ver su ficha y probar cuánto tarda el
// móvil en decodificarlo. Todo en el dispositivo: el archivo no sale de él y no se guarda copia.
import { openMp4 } from '../video/mp4.js';
import { canDecode } from '../video/decode.js';
import { probeDecode } from '../video/probe.js';
import { downloadJson, copyJson, stamp } from './share.js';

export const VIDEO_PROBE_SCHEMA = 'orbicula-video-probe/1';
const $ = (id) => document.getElementById(id);
const nf = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '—');

/** @param {{getContext: () => {build: object, device: object}}} deps */
export function createVideoCard({ getContext }) {
  const el = {
    file: $('vidFile'), info: $('vidInfo'), probe: $('vidProbe'), cancel: $('vidCancel'), bar: $('vidBar'), barWrap: $('vidBarWrap'),
    result: $('vidResult'), thumb: $('vidThumb'), out: $('vidOut'), download: $('vidDownload'), copy: $('vidCopy'), msg: $('vidMsg'),
    facing: $('vidFacing'), mirror: $('vidMirror'),
  };
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
    mp4 = null; probe = null; support = null;
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
      el.out.hidden = false;
    } catch (err) {
      el.info.textContent = `No se pudo leer: ${err?.message ?? err}. ¿Es un vídeo MP4 de la app de cámara?`;
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
        `Por fotograma: leer ${nf(p.readMsPerFrame, 1)} ms (${p.fileReads} lecturas del archivo) · girar ${nf(p.rotateMsPerFrame, 1)} ms · decodificar y esperar ${nf(p.otherMsPerFrame, 1)} ms`,
        `Imagen ya girada: ${p.outputSize ? `${p.outputSize.width}×${p.outputSize.height}` : '—'}. Comprueba en la miniatura que la cara está derecha.`,
      ].join('\n');
    } catch (err) {
      el.result.textContent = err?.name === 'AbortError' ? 'Cancelado.' : `Error al decodificar: ${err?.message ?? err}`;
      if (err?.name !== 'AbortError') probe = { error: String(err?.message ?? err) };
    } finally {
      wake?.release?.().catch(() => {});
      el.probe.disabled = false; el.cancel.hidden = true; el.barWrap.hidden = true;
    }
  });
  el.cancel.addEventListener('click', () => abort?.abort());

  el.download.addEventListener('click', () => {
    const { name, size } = downloadJson(report(), `orbicula-video-${stamp()}.json`);
    el.msg.textContent = `Descargado: ${name} (${Math.round(size / 1024)} KB).`;
  });
  el.copy.addEventListener('click', async () => {
    try { await copyJson(report()); el.msg.textContent = 'Copiado. Pégalo en la conversación.'; } catch (err) { el.msg.textContent = `No se pudo copiar (${err?.message ?? err}).`; }
  });

  return { report };
}
