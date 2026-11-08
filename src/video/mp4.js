// Lectura de un MP4 grabado con la app de cámara (fase 6). Sin DOM: funciona con un File/Blob del
// navegador o con cualquier objeto con `size` y `slice(a, b).arrayBuffer()`.
//
// Para no cargar en memoria un vídeo de 1 GB, solo se lee el índice (cajas `ftyp` y `moov`) y, después,
// cada muestra (fotograma comprimido) directamente del archivo según su posición. El índice se entrega a
// mp4box «pegado» detrás del ftyp: las posiciones de las muestras (stco/co64) son absolutas en el archivo
// real, así que siguen valiendo.
//
// Tiempos: los de presentación de cada muestra (cts), en ms desde la primera, aunque el fps sea variable.
// Giro: el de la matriz de la pista (tkhd). Los móviles guardan el vídeo en horizontal y lo marcan para
// girarlo al mostrarlo.
import { createFile, MP4BoxBuffer, DataStream, Endianness } from 'mp4box';

/** Cajas de primer nivel: [{ type, start, size }]. Lee solo las cabeceras (16 bytes por caja). */
export async function scanBoxes(file) {
  const boxes = [];
  let pos = 0;
  while (pos + 8 <= file.size) {
    const head = new DataView(await file.slice(pos, Math.min(file.size, pos + 16)).arrayBuffer());
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error('el archivo no es un MP4 válido');
    if (size === 1) size = Number(head.getBigUint64(8));
    else if (size === 0) size = file.size - pos;
    if (size < 8) throw new Error(`caja «${type}» con tamaño ${size}: el archivo no es un MP4 válido`);
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

/**
 * Giro en grados, en el sentido de las agujas del reloj (0, 90, 180 o 270), de la matriz de la pista.
 * Matriz MP4: [a, b, u, c, d, v, x, y, w] en 16.16; un punto (x, y) se muestra en (a·x + c·y, b·x + d·y).
 * Con y hacia abajo, a = 0, b = 1 (lo de la derecha pasa abajo) es un giro horario de 90°: el de los móviles.
 */
export function rotationOf(matrix) {
  if (!matrix || matrix.length < 5) return 0;
  const deg = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

const percentile = (v, p) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
};

/**
 * Ritmo real a partir de los tiempos de presentación (ms): fps según la mediana del intervalo, intervalos
 * mínimo y máximo, y si es variable (los intervalos del p5 al p95 difieren más de un 10 % de la mediana).
 */
export function frameStats(timesMs) {
  const t = [...timesMs].sort((a, b) => a - b);
  const d = t.slice(1).map((x, i) => x - t[i]).filter((x) => x > 0);
  if (!d.length) return { frames: t.length, fps: null, medianMs: null, minMs: null, maxMs: null, variable: false, durationMs: 0 };
  const med = percentile(d, 0.5);
  const spread = (percentile(d, 0.95) - percentile(d, 0.05)) / med;
  return {
    frames: t.length,
    fps: Math.round((1000 / med) * 100) / 100,
    medianMs: Math.round(med * 100) / 100,
    minMs: Math.round(Math.min(...d) * 100) / 100,
    maxMs: Math.round(Math.max(...d) * 100) / 100,
    variable: spread > 0.1,
    durationMs: Math.round(t.at(-1) - t[0] + med),
  };
}

/** Configuración del decodificador (WebCodecs) a partir de la entrada de la pista. */
function descriptionOf(entry) {
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 8); // sin la cabecera de la caja
}

/**
 * Abre un MP4 y devuelve su ficha y la lista de muestras de vídeo (en orden de decodificación).
 * @param {{size:number, slice:(a:number,b:number)=>{arrayBuffer:()=>Promise<ArrayBuffer>}}} file
 */
export async function openMp4(file) {
  const boxes = await scanBoxes(file);
  const ftyp = boxes.find((b) => b.type === 'ftyp');
  const moov = boxes.find((b) => b.type === 'moov');
  if (!moov) throw new Error('el archivo no tiene índice (caja «moov»): quizá la grabación no terminó bien');
  const mp4 = createFile();
  let info = null;
  mp4.onReady = (i) => { info = i; };
  let at = 0;
  for (const b of [ftyp, moov].filter(Boolean)) {
    const ab = await file.slice(b.start, b.start + b.size).arrayBuffer();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, at));
    at += b.size;
  }
  mp4.flush();
  const track = info?.videoTracks?.[0];
  if (!track) throw new Error('el archivo no tiene pista de vídeo');
  const trak = mp4.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const ts = track.timescale;
  const raw = trak.samples ?? [];
  const cts0 = Math.min(...raw.map((s) => s.cts));
  const samples = raw.map((s) => ({
    offset: s.offset,
    size: s.size,
    key: !!s.is_sync,
    t: ((s.cts - cts0) * 1000) / ts, // ms de presentación desde el primer fotograma
    durationMs: (s.duration * 1000) / ts,
  }));
  const rotation = rotationOf(track.matrix);
  const codedWidth = track.video?.width ?? track.track_width;
  const codedHeight = track.video?.height ?? track.track_height;
  const quarter = rotation % 180 !== 0;
  return {
    container: { brands: info.brands ?? [], hasAudio: (info.audioTracks?.length ?? 0) > 0, moovAtEnd: moov.start > (boxes.find((b) => b.type === 'mdat')?.start ?? 0) },
    track: {
      codec: track.codec,
      codedWidth,
      codedHeight,
      rotation,
      // Tamaño con el giro aplicado (lo que se ve).
      width: quarter ? codedHeight : codedWidth,
      height: quarter ? codedWidth : codedHeight,
      timescale: ts,
      samples: samples.length,
      keyframes: samples.filter((s) => s.key).length,
      bitrateKbps: track.bitrate ? Math.round(track.bitrate / 1000) : null,
    },
    timing: frameStats(samples.map((s) => s.t)),
    decoderConfig: { codec: track.codec, codedWidth, codedHeight, description: descriptionOf(entry), optimizeForLatency: false },
    samples,
    /** Datos comprimidos de una muestra, leídos del archivo. */
    read: async (s) => new Uint8Array(await file.slice(s.offset, s.offset + s.size).arrayBuffer()),
  };
}
