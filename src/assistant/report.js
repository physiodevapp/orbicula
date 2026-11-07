// Resumen de los pasos y construcción del JSON de la sesión de pruebas.
// Solo medidas numéricas: sin imágenes, sin nombre. Es un archivo de diagnóstico para
// compartir con quien desarrolla la app; NO es el JSON de exportación de resultados
// (ese es la interfaz pública y se define en la fase 7).

// Versión 2 (fase 4): plan del asistente, posición del iris, flujo óptico por ROI con las tres
// compensaciones y marcas de las repeticiones guiadas. Lo de la versión 1 sigue igual.
// Versión 3 (fase 5): calibración sobre el reposo (`calibration`) y eventos en directo (`detections`).
export const REPORT_SCHEMA = 'orbicula-test-session/3';

const FLOW_ROIS = ['upperLid', 'lowerLid', 'brow', 'canthus'];
const FLOW_VARIANTS = { none: 'eN', reference: 'eR', pose: 'eP', hybrid: 'eH' };

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
  const closures = events.filter((e) => e.kind === 'closure');
  return {
    blinks: blinks.length,
    closures: closures.length,
    narrowings: events.length - blinks.length - closures.length,
    blinkDurationMs: stats(blinks.map((e) => e.duration)),
    blinkCompleteness: stats(blinks.map((e) => e.completeness)),
    ear: stats(step.series[side].ear),
    aperture: stats(step.series[side].aperture),
    blendshape: stats(step.series[side].blink),
  };
}

/** Percentil p (0–1) sin contar null ni NaN. */
export function percentile(values, p) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
}

// 4 cifras significativas; por debajo de 1e-6 (DI/s o su cuadrado) es ruido numérico: 0.
const sig = (v) => (Number.isFinite(v) ? (Math.abs(v) < 1e-6 ? 0 : Number(v.toPrecision(4))) : null);

/**
 * Resumen del flujo de un paso: por lado, ROI y compensación, la mediana y el p95 de la energía
 * residual ((DI/s)²). Es lo que comparan los criterios 3 y 4 con el reposo.
 */
function flowSummary(step) {
  const f = step.flow;
  if (!f?.rel.length) return null;
  const dur = (f.rel.at(-1) - f.rel[0]) / 1000;
  const side = (s) =>
    Object.fromEntries(FLOW_ROIS.map((roi) => [roi, Object.fromEntries(Object.entries(FLOW_VARIANTS).map(([v, k]) => {
      const e = f[s][roi][k];
      return [v, { p50: sig(percentile(e, 0.5)), p95: sig(percentile(e, 0.95)), p99: sig(percentile(e, 0.99)) }];
    }))]));
  return { pairs: f.rel.length, pairsPerSecond: dur > 0 ? r3((f.rel.length - 1) / dur) : null, left: side('left'), right: side('right') };
}

export function summarizeStep(step) {
  const n = step.rel.length;
  const withFace = step.series.left.ear.filter((v, i) => v != null || step.series.right.ear[i] != null).length;
  return {
    samples: n,
    faceFraction: n ? r3(withFace / n) : null,
    left: sideSummary(step, 'left'),
    right: sideSummary(step, 'right'),
    flow: flowSummary(step),
  };
}

/** Texto corto de un paso para la pantalla de revisión. */
export function describeSummary(step) {
  const s = summarizeStep(step);
  const side = (name, x) => {
    const comp = x.blinkCompleteness.mean == null ? '' : ` · cierre medio ${Math.round(x.blinkCompleteness.mean * 100)} %`;
    const clo = x.closures ? ` · ${x.closures} cierre${x.closures > 1 ? 's' : ''} de más de 0,8 s` : '';
    const nar = x.narrowings ? ` · ${x.narrowings} entornado${x.narrowings > 1 ? 's' : ''}` : '';
    return `${name}: ${x.blinks} parpadeo${x.blinks === 1 ? '' : 's'}${comp}${clo}${nar}`;
  };
  const lines = [side('I', s.left), side('D', s.right), `Cara detectada en el ${Math.round((s.faceFraction ?? 0) * 100)} % de las muestras.`];
  if (s.flow) {
    // Velocidad (raíz de la energía) del p95, con la compensación por postura (o la referencia si falta).
    const v = (x) => {
      const e = x.pose.p95 ?? x.reference.p95;
      return e == null ? '—' : Math.sqrt(e).toFixed(2).replace('.', ',');
    };
    lines.push(`Flujo p95 (DI/s, compensado): párpado sup. I ${v(s.flow.left.upperLid)} · D ${v(s.flow.right.upperLid)}; ceja I ${v(s.flow.left.brow)} · D ${v(s.flow.right.brow)}. ${s.flow.pairs} pares (${Math.round(s.flow.pairsPerSecond ?? 0)}/s).`);
  } else if (step.wantsFlow) {
    lines.push('Sin datos de flujo en este paso.');
  }
  if (step.calibration) {
    const c = step.calibration;
    lines.push(c.valid
      ? `Calibración válida: umbral del cierre I ${c.rise.left} · D ${c.rise.right} DI.`
      : `Calibración NO válida: ${c.reason}. Repite el reposo, con la cabeza apoyada.`);
  }
  const ok = (step.detections ?? []).filter((e) => e.kind === 'contraction' && e.status === 'ok');
  const gated = (step.detections ?? []).filter((e) => e.status === 'head').length;
  if (step.detections?.length || step.calibration) {
    lines.push(`Contracciones detectadas: I ${ok.filter((e) => e.side === 'left').length} · D ${ok.filter((e) => e.side === 'right').length}${gated ? ` (${gated} descartadas por mover la cabeza)` : ''}.`);
  }
  return lines.join('\n');
}

/**
 * @param {{results: object[], startedAt: string|null, code?: string|null, build: object, device: object,
 *          capture: object, analysis: object, detector: object, includeSeries?: boolean}} ctx
 */
export function buildReport({ results, startedAt, code = null, plan = null, build, device, capture, analysis, flow = null, detector, includeSeries = true }) {
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
    flow, // configuración del flujo óptico (fase 4)
    detector,
    plan,
    steps: results.map((step) => ({
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      status: step.status,
      attempt: step.attempt,
      interruptReason: step.interruptReason,
      startedAt: step.startedAt,
      plannedMs: step.plannedMs,
      durationMs: step.durationMs,
      expect: step.expect,
      user: step.user,
      perf: step.perf,
      summary: summarizeStep(step),
      events: step.events,
      reps: step.reps ?? null,
      marks: step.marks ?? [],
      calibration: step.calibration ?? null,
      detections: step.detections ?? [],
      ...(includeSeries ? { series: { t: step.rel, left: step.series.left, right: step.series.right } } : {}),
      ...(includeSeries && step.flow?.rel.length ? { flow: { t: step.flow.rel, dt: step.flow.dt, left: step.flow.left, right: step.flow.right, head: step.flow.head, closure: step.flow.closure, frozen: step.flow.frozen } } : {}),
    })),
  };
}
