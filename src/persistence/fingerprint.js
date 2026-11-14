// Huella de un vídeo: lo que permite reconocerlo al volver a elegirlo sin guardarlo (puede pesar cientos
// de MB y no sale del dispositivo). Mismo criterio que dualkinema: tamaño, número de fotogramas y
// duración identifican el contenido casi sin ambigüedad; el NOMBRE no cuenta, porque Android entrega el
// mismo vídeo con otro nombre según se elija desde Fotos o desde Archivos. Y no se guarda el nombre.
//
// @param {{size:number, frames:number, durationMs:number}} f
export function fingerprintKey({ size, frames, durationMs }) {
  return `${Math.round(size)}:${Math.round(frames)}:${Math.round(durationMs)}`;
}

/** Huella de un archivo ya abierto con openMp4. */
export function fingerprintOf(file, mp4) {
  return fingerprintKey({ size: file.size, frames: mp4.track.samples, durationMs: mp4.timing.durationMs });
}
