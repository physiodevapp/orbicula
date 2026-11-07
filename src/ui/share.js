// Descargar, compartir o copiar un JSON de diagnóstico. Todo local: sin red.

const pad = (n) => String(n).padStart(2, '0');

/** Sello para nombres de archivo: AAAAMMDD-HHMM. */
export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Descarga el objeto como archivo JSON (sin indentar: ocupa menos). */
export function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { name, size: blob.size };
}

/** Comparte el archivo con el menú del sistema. Lanza si el navegador no puede; AbortError si se cancela. */
export async function shareJson(obj, name, title) {
  const file = new File([JSON.stringify(obj)], name, { type: 'application/json' });
  if (!navigator.canShare?.({ files: [file] })) throw new Error('no se pueden compartir archivos');
  await navigator.share({ files: [file], title });
}

/** Copia el objeto, con sangría, al portapapeles. */
export function copyJson(obj) {
  return navigator.clipboard.writeText(JSON.stringify(obj, null, 1));
}
