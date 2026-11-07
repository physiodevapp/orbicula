// Paso de coordenadas del frame (píxeles) a la pantalla. Solo afecta al DIBUJO: los datos
// siempre van en coordenadas del frame analizado. La vista previa de la cámara frontal se
// muestra en espejo (CSS), así que el dibujo se invierte igual para que las ROI coincidan.

/** Rectángulo que ocupa el vídeo dentro del marco con object-fit: contain. */
export function contentRect(stageW, stageH, frameW, frameH) {
  const scale = Math.min(stageW / frameW, stageH / frameH);
  const w = frameW * scale;
  const h = frameH * scale;
  return { x: (stageW - w) / 2, y: (stageH - h) / 2, w, h, scale };
}

/** Punto del frame → punto del lienzo (en px CSS). */
export function toDisplay(p, rect, displayMirrored) {
  const x = displayMirrored ? rect.w - p.x * rect.scale : p.x * rect.scale;
  return { x: rect.x + x, y: rect.y + p.y * rect.scale };
}
