// Resumen de los pasos y construcción del JSON de la sesión de pruebas.
// Solo medidas numéricas: sin imágenes, sin nombre. Es un archivo de diagnóstico para
// compartir con quien desarrolla la app; NO es el JSON de exportación de resultados
// (ese es la interfaz pública y se define en la fase 7).

export const REPORT_SCHEMA = 'orbicula-test-session/1';

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/** n, media, desviación típica, mínimo y máximo, sin contar null ni NaN. */
export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { n: v.length, mean: r3(mean), sd: r3(sd), min: r3(Math.min(...v)), max: r3(Math.max(...v)) };
}

function sideSummary(step, side) {
  const events = step.events[side];
  const blinks = events.filter((e) => e.kind === 'blink');
  return {
    blinks: blinks.length,
    closures: events.length - blinks.length,
    blinkDurationMs: stats(blinks.map((e) => e.duration)),
    blinkCompleteness: stats(blinks.map((e) => e.completeness)),
    ear: stats(step.series[side].ear),
    aperture: stats(step.series[side].aperture),
    blendshape: stats(step.series[side].blink),
  };
}

export function summarizeStep(step) {
  const n = step.rel.length;
  const withFace = step.series.left.ear.filter((v, i) => v != null || step.series.right.ear[i] != null).length;
  return {
    samples: n,
    faceFraction: n ? r3(withFace / n) : null,
    left: sideSummary(step, 'left'),
    right: sideSummary(step, 'right'),
  };
}

/** Texto corto de un paso para la pantalla de revisión. */
export function describeSummary(step) {
  const s = summarizeStep(step);
  const side = (name, x) => {
    const comp = x.blinkCompleteness.mean == null ? '' : ` · cierre medio ${Math.round(x.blinkCompleteness.mean * 100)} %`;
    const clo = x.closures ? ` · ${x.closures} cierre${x.closures > 1 ? 's' : ''} largo${x.closures > 1 ? 's' : ''}` : '';
    return `${name}: ${x.blinks} parpadeo${x.blinks === 1 ? '' : 's'}${comp}${clo}`;
  };
  return `${side('I', s.left)}\n${side('D', s.right)}\nCara detectada en el ${Math.round((s.faceFraction ?? 0) * 100)} % de las muestras.`;
}

/**
 * @param {{results: object[], startedAt: string|null, code?: string|null, build: object, device: object,
 *          capture: object, analysis: object, detector: object, includeSeries?: boolean}} ctx
 */
export function buildReport({ results, startedAt, code = null, build, device, capture, analysis, detector, includeSeries = true }) {
  return {
    app: 'orbicula',
    kind: 'test-session',
    schema: REPORT_SCHEMA,
    createdAt: new Date().toISOString(),
    startedAt,
    note: 'Registro del asistente de pruebas. Solo medidas numéricas: sin imágenes ni identificación del paciente.',
    participantCode: code || null,
    build,
    device,
    capture,
    analysis,
    detector,
    steps: results.map((step) => ({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      status: step.status,
      interruptReason: step.interruptReason,
      startedAt: step.startedAt,
      plannedMs: step.plannedMs,
      durationMs: step.durationMs,
      expect: step.expect,
      user: step.user,
      perf: step.perf,
      summary: summarizeStep(step),
      events: step.events,
      ...(includeSeries ? { series: { t: step.rel, left: step.series.left, right: step.series.right } } : {}),
    })),
  };
}
