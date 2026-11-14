// CSV de las series temporales (fase 7). Dos archivos, porque las series de la cara y las del flujo no
// comparten instantes: coma como separador, punto decimal, cabecera, tiempos en ms y sin ningún dato
// del paciente. Sin DOM.
import { seriesOf } from './result.js';

const cell = (v) => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v));
const line = (cols) => `${cols.map(cell).join(',')}\n`;

/**
 * CSV de la cara: t_ms, phase y, por lado, EAR, apertura, blendshape de parpadeo, sonrisa y cierre por flujo;
 * luego, si el cierre estaba congelado, y al final la posición de las comisuras de la boca (añadidas después:
 * al final para no mover las columnas de antes).
 */
export function faceCsv(results) {
  const { face } = seriesOf(results);
  const cols = ['ear', 'aperture', 'blink', 'smile', 'closure'];
  const extra = ['cornerOut', 'cornerUp'];
  const sides = ['left', 'right'];
  let out = line(['t_ms', 'phase', ...sides.flatMap((s) => cols.map((c) => `${s}_${c}`)), 'closure_frozen', ...sides.flatMap((s) => extra.map((c) => `${s}_${c}`))]);
  face.t.forEach((t, i) => {
    out += line([t, face.phase[i], ...sides.flatMap((s) => cols.map((c) => face[s][c][i])), face.frozen[i], ...sides.flatMap((s) => extra.map((c) => face[s][c][i]))]);
  });
  return out;
}

/** CSV del flujo: t_ms, phase, cierre por flujo de cada ojo, si estaba congelado y la velocidad de la cabeza. */
export function flowCsv(results) {
  const { flow } = seriesOf(results);
  let out = line(['t_ms', 'phase', 'left_closure', 'right_closure', 'closure_frozen', 'head_u', 'head_v']);
  flow.t.forEach((t, i) => {
    out += line([t, flow.phase[i], flow.closure.left[i], flow.closure.right[i], flow.frozen[i], flow.head.u[i], flow.head.v[i]]);
  });
  return out;
}
