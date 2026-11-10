// Pantalla del resumen del protocolo (fase 5c): una tarjeta por fase con izquierda, derecha y asimetría,
// los avisos, la lista de contracciones y el aviso de que no es una herramienta de diagnóstico.
// Solo construye DOM con textContent (nada de innerHTML). Los números vienen de summarizeProtocol().

/** Asimetría destacada a partir de este valor absoluto (orientativo: no hay datos de referencia). */
export const ASYM_HIGHLIGHT = 0.2;

const nf = (v, d) => v.toFixed(d).replace('.', ',');
const FORMATS = {
  pct: (v) => `${nf(v * 100, 0)} %`,
  pct100: (v) => `${nf(v, 0)} %`,
  num2: (v) => nf(v, 2),
  num1: (v) => nf(v, 1),
  ms: (v) => `${nf(v, 0)} ms`,
  times: (v) => `×${nf(v, 1)}`,
  count: (v) => nf(v, 0),
  perMin: (v) => nf(v, 0),
  di: (v) => nf(v, 2),
};

/** Métricas que se muestran, por fase: [clave, etiqueta, formato, ayuda]. */
export const ROWS = {
  rest: [
    ['ear', 'EAR en reposo', 'num2', 'Apertura vertical del ojo / ancho, en reposo.'],
    ['aperture', 'Apertura / distancia intercantal', 'num2'],
    ['spectrum', 'Actividad rítmica (pico)', 'spectrum', 'Pico espectral del párpado (mioquimias). Provisional.'],
  ],
  natural: [
    ['blinksPerMin', 'Parpadeos por minuto', 'perMin'],
    ['blinkMs', 'Duración del parpadeo', 'ms'],
    ['blinkVsMax', 'Cierre del parpadeo / cierre máximo', 'pct', 'Orientativo: a ~27 análisis/s se pierde parte del cierre de un parpadeo breve.'],
    ['incompletePct', 'Parpadeos incompletos', 'pct100', 'Menos del 80 % del cierre máximo de ese ojo.'],
    ['contractions', 'Contracciones finas', 'count', 'Subidas del cierre por flujo por encima del umbral del reposo.'],
    ['spectrum', 'Actividad rítmica (pico)', 'spectrum'],
  ],
  soft: [
    ['closure', 'Cierre', 'pct', '1 − EAR mínimo / EAR en reposo.'],
    ['browRecruit', 'Ceja (reclutamiento)', 'times', 'Pico de movimiento de la ceja, en veces su reposo.'],
    ['canthusRecruit', 'Canto externo (reclutamiento)', 'times'],
  ],
  forced: [
    ['closure', 'Cierre', 'pct'],
    ['browRecruit', 'Ceja (reclutamiento)', 'times'],
    ['canthusRecruit', 'Canto externo (reclutamiento)', 'times'],
  ],
  brows: [
    ['eyeOpening', 'El ojo se abre', 'pct'],
    ['browLift', 'Subida de la ceja (DI)', 'di', 'Desplazamiento hacia arriba, en distancias intercantales.'],
    ['browPeak', 'Ceja (pico)', 'times'],
  ],
  smile: [
    ['smile', 'Sonrisa de la boca', 'pct'],
    ['closure', 'El ojo se cierra', 'pct'],
    ['coactivation', 'Co-activación ojo–boca (r)', 'num2', 'Correlación entre la sonrisa y el cierre del ojo del mismo lado.'],
    ['contractions', 'Contracciones finas', 'count'],
  ],
};
const ASYM_LABEL = 'Asimetría = (I − D) / (I + D): 0 es simétrico, + más a la izquierda del paciente.';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function fmtValue(format, v) {
  if (v == null) return '—';
  if (format === 'spectrum') return v.rhythmic ? `${nf(v.freq, 1)} Hz` : 'no';
  return Number.isFinite(v) ? FORMATS[format](v) : '—';
}
const fmtAsym = (v) => (v == null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${nf(Math.abs(v), 2)}`);

/** Texto de la hora de un evento: segundos desde el inicio de la fase. */
const at = (ms) => `+${nf(ms / 1000, 1)} s`;

/**
 * Pinta el resumen.
 * @param {HTMLElement} root contenedor (se vacía)
 * @param {ReturnType<import('../protocol/summary.js').summarizeProtocol>} summary
 * @param {object[]} results pasos grabados (para la lista de eventos)
 */
export function renderSummary(root, summary, results = []) {
  root.replaceChildren();
  const ids = Object.keys(summary.phases);
  root.hidden = !ids.length;
  if (!ids.length) return;

  for (const w of summary.warnings) root.append(el('div', 'sum-warning', w));

  for (const id of ids) {
    const p = summary.phases[id];
    const card = el('section', 'sum-card');
    const head = el('div', 'sum-head');
    head.append(el('span', 'sum-title', p.title));
    if (!p.quality.reliable) head.append(el('span', 'sum-badge', 'poco fiable'));
    card.append(head);
    if (p.quality.notes.length) card.append(el('div', 'sum-note', p.quality.notes.join(' · ')));

    const grid = el('div', 'sum-grid');
    grid.append(el('span'), el('span', 'sum-col side-left', 'I'), el('span', 'sum-col side-right', 'D'), el('span', 'sum-col', 'Asim.'));
    for (const [key, label, format, help] of ROWS[id] ?? []) {
      if (p.left[key] == null && p.right[key] == null) continue;
      const name = el('span', 'sum-label', label);
      if (help) name.title = help;
      const high = Math.abs(p.asymmetry[key] ?? 0) >= ASYM_HIGHLIGHT;
      grid.append(name, el('span', 'sum-val', fmtValue(format, p.left[key])), el('span', 'sum-val', fmtValue(format, p.right[key])), el('span', `sum-val sum-asym${high ? ' high' : ''}`, fmtAsym(p.asymmetry[key])));
    }
    card.append(grid);
    // Contracciones breves: no cuentan, pero se dicen (pueden interesar para las mioquimias).
    const brief = (p.left.brief ?? 0) + (p.right.brief ?? 0);
    if (brief) card.append(el('div', 'sum-note', `${brief} movimiento${brief === 1 ? '' : 's'} breve${brief === 1 ? '' : 's'} del párpado (< 0,5 s) que no cuenta${brief === 1 ? '' : 'n'} como contracción.`));
    root.append(card);
  }

  // Contracciones que cuentan, por fase (el reposo es la calibración: no tiene eventos).
  const events = results.filter((s) => s.status === 'completed' && s.id !== 'rest').flatMap((s) => (s.detections ?? []).filter((e) => e.kind === 'contraction' && e.status === 'ok').map((e) => ({ phase: s.title, ...e })));
  const list = el('section', 'sum-card');
  list.append(el('div', 'sum-head', ''));
  list.firstChild.append(el('span', 'sum-title', 'Contracciones finas registradas'));
  if (!events.length) list.append(el('div', 'sum-note', 'Ninguna por encima del umbral del reposo.'));
  else {
    const ul = el('ul', 'sum-events');
    for (const e of events.slice(0, 40)) {
      const li = el('li');
      li.append(el('span', null, `${e.phase} ${at(e.t)}`), el('span', `side-${e.side}`, e.side === 'left' ? 'I' : 'D'), el('span', null, `${nf(e.duration, 0)} ms · ×${nf(e.peak, 1)}`));
      ul.append(li);
    }
    list.append(ul);
    if (events.length > 40) list.append(el('div', 'sum-note', `y ${events.length - 40} más (están en el JSON).`));
  }
  root.append(list);

  root.append(el('p', 'sum-foot', ASYM_LABEL));
  root.append(el('p', 'sum-foot', `Las asimetrías de ${nf(ASYM_HIGHLIGHT, 2)} o más se destacan (orientativo: no hay datos de referencia). Herramienta de apoyo y seguimiento, no de diagnóstico.`));
}
