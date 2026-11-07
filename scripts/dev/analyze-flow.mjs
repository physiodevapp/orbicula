// Análisis del JSON del asistente de la fase 4 (paso 4c): criterios 3 y 4 de docs/plan-fase-4.md.
//
//   node scripts/dev/analyze-flow.mjs informe.json
//
// - Reposo: p95 y p99 de la energía de cada ROI y compensación, y ruido del EAR (desviación típica).
//   Se quitan los parpadeos (±margen) para que la referencia sea el reposo de verdad.
// - Criterio 3 (contracción mínima): por repetición, pico de energía frente al p95 del reposo (≥ 3 veces)
//   y cierre del ojo por EAR y por flujo integrado frente a su ruido. Las ventanas se desplazan al gesto
//   real: llega ~0,5–1 s después del pitido «ahora» (latencia del audio + reacción).
// - Criterio 4 (cabeceo y giro): fracción de pares por encima del p99 del reposo, sin los parpadeos.
// - Guiños y cejas: pico de energía de cada lado y ROI.
import { readFileSync } from 'node:fs';

const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ROIS = ['upperLid', 'lowerLid', 'brow', 'canthus'];
const VAR = { eN: 'sin comp.', eR: 'dorso nasal', eP: 'postura' };
const SIDES = ['left', 'right'];
const L = { left: 'I', right: 'D' };
const step = (id) => j.steps.find((s) => s.id === id && s.status === 'completed');

const pct = (a, p) => {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const i = (v.length - 1) * p;
  return v[Math.floor(i)] + (v[Math.ceil(i)] - v[Math.floor(i)]) * (i - Math.floor(i));
};
const sd = (a) => {
  const v = a.filter(Number.isFinite);
  const m = v.reduce((x, y) => x + y, 0) / v.length;
  return Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / v.length);
};
const med = (a) => pct(a, 0.5);
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const rms = (e) => Math.sqrt(e); // energía → velocidad (DI/s)

/** Ventanas [ini, fin] (ms, reloj de las series) de los parpadeos de cualquier lado, con margen. */
function blinkWindows(s, before = 150, after = 300, minCompleteness = 0) {
  return SIDES.flatMap((side) => s.events[side].filter((e) => e.completeness >= minCompleteness).map((e) => [e.t - e.duration - before, e.t + e.duration + after]));
}
/**
 * En la detección calibrada solo se apartan los parpadeos de verdad (cierre ≥ 50 %): el detector
 * también marca eventos poco profundos (20–35 %) que son la propia contracción mínima o ruido, y
 * apartarlos quitaría sobre todo contracciones. La misma regla vale para el reposo y las repeticiones.
 */
const REAL_BLINK = 0.5;
const inAny = (t, wins) => wins.some(([a, b]) => t >= a && t <= b);

// ── Reposo ─────────────────────────────────────────────────────────────────────────────────────
const rest = step('rest');
const restWins = blinkWindows(rest);
const restKeep = rest.flow.t.map((t, i) => i).filter((i) => !inAny(rest.flow.t[i], restWins));
const base = {};
for (const side of SIDES) {
  base[side] = {};
  for (const roi of ROIS) {
    base[side][roi] = {};
    for (const k of Object.keys(VAR)) {
      const e = restKeep.map((i) => rest.flow[side][roi][k][i]);
      base[side][roi][k] = { p50: pct(e, 0.5), p95: pct(e, 0.95), p99: pct(e, 0.99) };
    }
  }
}
const earKeep = (s, side) => s.series.t.map((t, i) => i).filter((i) => !inAny(s.series.t[i], blinkWindows(s))).map((i) => s.series[side].ear[i]);
const earNoise = Object.fromEntries(SIDES.map((side) => [side, sd(earKeep(rest, side))]));

console.log(`Reposo: ${rest.flow.t.length} pares, ${restKeep.length} sin parpadeos (${rest.events.left.length}+${rest.events.right.length} eventos quitados)`);
console.log(`Ruido del EAR en reposo (DT): I ${f(earNoise.left, 4)} · D ${f(earNoise.right, 4)}`);
console.log('\nVelocidad residual en reposo, p95 (DI/s), por compensación:');
console.log('ROI         lado  ' + Object.values(VAR).map((v) => v.padStart(12)).join(''));
for (const roi of ROIS) for (const side of SIDES) console.log(`${roi.padEnd(11)} ${L[side]}     ${Object.keys(VAR).map((k) => f(rms(base[side][roi][k].p95), 3).padStart(12)).join('')}`);

// ── Picos por repetición ─────────────────────────────────────────────────────────────────────
/** Máximo de la energía en [t0, t1] de una ROI/lado/compensación. */
const peak = (s, side, roi, k, t0, t1) => {
  let m = -Infinity;
  s.flow.t.forEach((t, i) => { if (t >= t0 && t <= t1) m = Math.max(m, s.flow[side][roi][k][i] ?? -Infinity); });
  return m;
};
const earAt = (s, side, t0, t1) => s.series.t.map((t, i) => [t, s.series[side].ear[i]]).filter(([t, v]) => t >= t0 && t <= t1 && Number.isFinite(v)).map(([, v]) => v);

function reps(s) {
  const holds = s.marks.filter((m) => m.kind === 'hold');
  return holds.map((h) => ({ rep: h.rep, hold: h.t, cond: h.cond ?? 'act', release: s.marks.find((m) => m.kind === 'release' && m.rep === h.rep)?.t }));
}

/**
 * Retraso del gesto tras el pitido «ahora»: instante de bajada más rápida del EAR (media de los dos
 * ojos) en los 2 s siguientes. En el móvil del autor, ~0,5–1 s (latencia del audio + reacción).
 */
function delayOf(s, h) {
  let best = null;
  for (let i = 1; i < s.series.t.length; i++) {
    const t = s.series.t[i];
    if (t < h || t > h + 2000) continue;
    const d = (s.series.left.ear[i] + s.series.right.ear[i]) / 2 - (s.series.left.ear[i - 1] + s.series.right.ear[i - 1]) / 2;
    if (Number.isFinite(d) && (best == null || d < best.d)) best = { d, t: t - h };
  }
  return best?.t ?? 800;
}

/** Apertura por flujo integrada (DI): ∫(hacia abajo del párpado inferior − del superior) dt. */
function flowAperture(s, side, k) {
  const up = s.flow[side].upperLid[`d${k}`];
  const lo = s.flow[side].lowerLid[`d${k}`];
  let acc = 0;
  return s.flow.t.map((t, i) => (acc += ((lo[i] ?? 0) - (up[i] ?? 0)) * (s.flow.dt[i] / 1000)));
}
const within = (ts, arr, t0, t1) => ts.map((t, i) => [t, arr[i]]).filter(([t, v]) => t >= t0 && t <= t1 && Number.isFinite(v)).map(([, v]) => v);

// Ruido de la apertura por flujo en reposo: cambio en ventanas de 1,5 s.
const apNoise = {};
for (const side of SIDES) {
  for (const k of ['R', 'P']) {
    const a = flowAperture(rest, side, k);
    const d = [];
    for (let t = rest.flow.t[0]; t + 1500 < rest.flow.t.at(-1); t += 250) d.push(med(within(rest.flow.t, a, t + 1400, t + 1600)) - med(within(rest.flow.t, a, t - 100, t + 100)));
    apNoise[`${side}${k}`] = sd(d);
  }
}
console.log(`\nRuido de la apertura por flujo en reposo (DT del cambio en 1,5 s, DI): I ${f(apNoise.leftR, 4)} · D ${f(apNoise.rightR, 4)} (dorso nasal)`);

/**
 * Por repetición, con la ventana desplazada al gesto real: pico de energía de cada ROI frente al p95
 * del reposo, y cierre de cada ojo según el EAR y según la apertura por flujo, en DT de su ruido.
 */
function repTable(id, rois, k, { label } = {}) {
  const s = step(id);
  if (!s) return console.log(`\n${id}: no hay paso completado`);
  console.log(`\n${label} (${VAR[k]}). Pico de energía en la repetición / p95 del reposo; cierre del ojo por EAR y por flujo (en DT del ruido del reposo).`);
  for (const r of reps(s)) {
    const d = delayOf(s, r.hold);
    const t0 = r.hold + d - 200;
    const t1 = r.release + d + 600;
    const parts = SIDES.flatMap((side) => rois.map((roi) => `${L[side]} ${roi.slice(0, 5)} ×${f(peak(s, side, roi, k, t0, t1) / base[side][roi][k].p95, 0)}`));
    const close = SIDES.map((side) => {
      const before = med(within(s.series.t, s.series[side].ear, r.hold - 800, r.hold + 200));
      const dEar = before - Math.min(...within(s.series.t, s.series[side].ear, r.hold + d, r.release + d));
      const a = flowAperture(s, side, k.slice(1));
      const dFlow = med(within(s.flow.t, a, r.hold - 400, r.hold + 200)) - Math.min(...within(s.flow.t, a, r.hold + d, r.release + d));
      return `${L[side]} EAR ${f(dEar, 3)} (${f(dEar / earNoise[side], 0)} DT) flujo ${f(dFlow, 3)} DI (${f(dFlow / apNoise[side + k.slice(1)], 0)} DT)`;
    });
    console.log(`  rep ${r.rep} (+${d} ms): ${parts.join(' ')} | ${close.join(' | ')}`);
  }
}

for (const k of ['eR', 'eP']) repTable('minimal', ['upperLid', 'lowerLid', 'canthus'], k, { label: 'CRITERIO 3 · contracción mínima' });
repTable('more', ['upperLid', 'lowerLid', 'canthus'], 'eR', { label: 'Contracción algo mayor' });
repTable('brows', ['brow', 'upperLid'], 'eR', { label: 'Cejas' });
repTable('wink-left', ['upperLid', 'lowerLid'], 'eR', { label: 'Guiño izquierdo' });
repTable('wink-right', ['upperLid', 'lowerLid'], 'eR', { label: 'Guiño derecho' });

// ── Criterio 4 ─────────────────────────────────────────────────────────────────────────────────
for (const id of ['nod', 'turn']) {
  const s = step(id);
  if (!s) continue;
  const wins = blinkWindows(s);
  const keep = s.flow.t.map((t, i) => i).filter((i) => !inAny(s.flow.t[i], wins));
  const head = keep.map((i) => Math.hypot(s.flow.head.rU[i] ?? NaN, s.flow.head.rV[i] ?? NaN));
  console.log(`\nCRITERIO 4 · ${id}: ${keep.length} pares sin parpadeos (${s.events.left.length}+${s.events.right.length} eventos). Cabeza (dorso nasal): mediana ${f(med(head))} DI/s, p95 ${f(pct(head, 0.95))}.`);
  console.log('% de pares por encima del p99 del reposo (esperado ~1 %), y p99 del paso / p99 del reposo:');
  console.log('ROI         lado  ' + Object.values(VAR).map((v) => v.padStart(18)).join(''));
  for (const roi of ROIS) {
    for (const side of SIDES) {
      const cells = Object.keys(VAR).map((k) => {
        const e = keep.map((i) => s.flow[side][roi][k][i]);
        const over = e.filter((v) => v > base[side][roi][k].p99).length / e.length;
        return `${f(over * 100, 0)} % ×${f(pct(e, 0.99) / base[side][roi][k].p99, 1)}`.padStart(18);
      });
      console.log(`${roi.padEnd(11)} ${L[side]}     ${cells.join('')}`);
    }
  }
}

// ── Detección frente al reposo (calibrada) ───────────────────────────────────────────────────
// El «cierre» (mediana de antes − mínimo durante) sale positivo aunque no pase nada: el mínimo de una
// señal con ruido siempre queda por debajo. Por eso se calcula el mismo estadístico en ventanas de
// reposo sin parpadeos (reposo, comprobación y parpadeo espontáneo) y cada repetición se expresa como
// percentil de esa distribución nula: ≥ 95 = detectada. Se compara el EAR con la apertura por flujo
// integrada (dorso nasal).
{
  const HOLD = 1500;
  const D = 800;
  const statsAt = (s, h, r = h + HOLD) => {
    const out = {};
    for (const side of SIDES) {
      out[`ear.${side}`] = med(within(s.series.t, s.series[side].ear, h - 800, h + 200)) - Math.min(...within(s.series.t, s.series[side].ear, h + D, r + D));
      const a = flowAperture(s, side, 'R');
      out[`flujo.${side}`] = med(within(s.flow.t, a, h - 400, h + 200)) - Math.min(...within(s.flow.t, a, h + D, r + D));
    }
    return out;
  };
  const nul = [];
  for (const id of ['check', 'rest', 'natural', 'rest-end']) {
    const s = step(id);
    if (!s) continue;
    const bw = blinkWindows(s, 200, 400, REAL_BLINK);
    for (let h = 1000; h + HOLD + D + 800 < s.series.t.at(-1); h += 250) {
      if (bw.some(([a, b]) => b >= h - 800 && a <= h + HOLD + D + 600)) continue;
      nul.push(statsAt(s, h));
    }
  }
  const keys = ['ear.left', 'ear.right', 'flujo.left', 'flujo.right'];
  const rank = (k, v) => Math.round((100 * nul.filter((x) => x[k] < v).length) / nul.length);
  console.log(`\nDETECCIÓN FRENTE AL REPOSO: percentil de cada repetición en ${nul.length} ventanas de reposo sin parpadeos (≥ 95 = detectada; las ventanas se solapan, así que es orientativo).`);
  console.log(`  p95 nulo: ${keys.map((k) => `${k} ${f(pct(nul.map((x) => x[k]), 0.95), 3)}`).join(' · ')}`);
  // Prueba con controles (plan «micro»): aciertos, falsas alarmas y AUC de cada medida.
  const micro = ['micro-1', 'micro-2'].map(step).filter(Boolean);
  if (micro.length) {
    // Se apartan las repeticiones con un parpadeo dentro de la ventana (falsearían las dos medidas).
    const all = micro.flatMap((s) => {
      const bw = blinkWindows(s, 200, 400, REAL_BLINK);
      return reps(s).map((r) => ({ ...r, blink: bw.some(([a, b]) => b >= r.hold - 800 && a <= r.release + 800 + 600), x: statsAt(s, r.hold, r.release) }));
    });
    const trials = all.filter((t) => !t.blink);
    const act = trials.filter((t) => t.cond === 'act');
    const ctl = trials.filter((t) => t.cond === 'control');
    console.log(`\n(${all.length - trials.length} de ${all.length} repeticiones apartadas por un parpadeo de verdad —cierre ≥ 50 %— en la ventana: ${all.filter((t) => t.blink).map((t) => t.cond).join(', ') || 'ninguna'})`);
    // AUC = probabilidad de que una contracción dé más que un control (0,5 = azar, 1 = separación perfecta).
    const auc = (k) => {
      let w = 0;
      for (const a of act) for (const c of ctl) w += a.x[k] > c.x[k] ? 1 : a.x[k] === c.x[k] ? 0.5 : 0;
      return w / (act.length * ctl.length);
    };
    console.log(`\nCRITERIO 3 CON CONTROLES: ${act.length} contracciones mínimas y ${ctl.length} controles. Detectada = por encima del p95 del reposo.`);
    console.log('medida        aciertos   falsas alarmas   AUC (contracción frente a control)');
    for (const k of keys) {
      const p95 = pct(nul.map((x) => x[k]), 0.95);
      const hit = act.filter((t) => t.x[k] > p95).length;
      const fa = ctl.filter((t) => t.x[k] > p95).length;
      console.log(`${k.padEnd(12)}  ${`${hit}/${act.length}`.padStart(7)}   ${`${fa}/${ctl.length}`.padStart(13)}   ${f(auc(k), 2).padStart(6)}`);
    }
    console.log('Por repetición (orden de la prueba):');
    for (const t of all) console.log(`${t.blink ? '  [parpadeo] ' : ''}` + `  ${t.cond === 'act' ? 'CONTRAE ' : 'control '} ${keys.map((k) => `${k} ${f(t.x[k], 3)} (${rank(k, t.x[k])})`).join(' · ')}`);
  }

  for (const id of ['minimal', 'more']) {
    const s = step(id);
    if (!s) continue;
    for (const r of reps(s)) {
      const x = statsAt(s, r.hold, r.release);
      const det = (k) => (rank(k, x[k]) >= 95 ? '✔' : ' ');
      console.log(`  ${id.padEnd(8)} rep ${r.rep}: ${keys.map((k) => `${k} ${f(x[k], 3)} (${rank(k, x[k])})${det(k)}`).join(' · ')}`);
    }
  }
}
