// Tamaño de una fuente de imagen: el <video> de la cámara o un VideoFrame decodificado de un archivo
// (fase 6). null si todavía no hay imagen.
export function sourceSize(src) {
  if (!src) return null;
  if (typeof src.videoWidth === 'number') {
    return src.readyState >= 2 && src.videoWidth ? { width: src.videoWidth, height: src.videoHeight } : null;
  }
  const width = src.displayWidth ?? src.width;
  const height = src.displayHeight ?? src.height;
  return width && height ? { width, height } : null;
}
