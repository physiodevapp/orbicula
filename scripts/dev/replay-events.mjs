// Repite la calibración y el detector de eventos de la fase 5 (src/protocol/events.js) sobre un JSON
// del asistente de pruebas, como si fuera en directo, e informa por paso y por repetición.
//
//   node scripts/dev/replay-events.mjs informe.json ['{"riseFloor":0.004}'] [--fix micro-1:1=act]
//
// --fix corrige la condición de una repetición (si quien hizo la prueba se equivocó de gesto).
//
// Con marcas de repeticiones (pitidos), una repetición se da por detectada si hay una contracción
// válida de ese ojo entre el pitido «ahora» y 1 s después del «suelta» (el gesto llega ~0,5–1 s tarde).
// En los pasos con controles da aciertos (contracciones) y falsas alarmas (controles). En el cabeceo
// y el giro, cualquier contracción válida es una falsa alarma (criterio 4).
import { readFileSync } from 'node:fs';
import { calibrate, EventDetector, stepView } from '../../src/protocol/events.js';
import { CLOSURE_TAU_MS, SHUT_FRACTION, SHUT_PAD_MS } from '../../src/flow/processor.js';

const argv = process.argv.slice(2);
const fixes = {};
for (let i = argv.indexOf('--fix'); i >= 0; i = argv.indexOf('--fix')) {
  const [, id, rep, cond] = argv[i + 1].match(/^(.+):(\d+)=(act|control)$/) ?? [];
  if (id) fixes[`${id}:${rep}`] = cond;
  argv.splice(i, 2);
}
const [file, optJson] = argv;
if (!file) {
  console.error('Uso: node scripts/dev/replay-events.mjs informe.json [opciones JSON]');
  process.exit(1);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
const options = optJson ? JSON.parse(optJson) : {};
const SIDES = ['left', 'right'];
const L = { left: 'I', right: 'D' };
const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const steps = report.steps.filter((s) => s.status === 'completed' && s.flow);
const rest = steps.find((s) => s.id === 'rest');
if (!rest) {
  console.error('El JSON no tiene un paso «rest» con flujo.');
  process.exit(1);
}

/**
 * Los JSON anteriores a la fase 5a no congelan el cierre durante los parpadeos (ver SHUT_FRACTION en
 * processor.js): se recalcula desde el flujo de los párpados (dR) congelándolo igual que en directo, con
 * el reposo del EAR de una primera calibración. También sirve para los JSON sin `closure` (17:47).
 */
function refreeze(steps, earBase) {
  for (const s of steps) {
    const f = s.flow;
    const shut = s.series.t.filter((t, i) => ['left', 'right'].some((x) => Number.isFinite(s.series[x].ear[i]) && s.series[x].ear[i] < SHUT_FRACTION * earBase[x]));
    f.closure = { left: [], right: [] };
    f.frozen = [];
    let j = 0;
    const acc = { left: 0, right: 0 };
    f.t.forEach((t, i) => {
      const dt = f.dt[i];
      while (j < shut.length && shut[j] < t - dt - SHUT_PAD_MS) j++;
      const frozen = j < shut.length && shut[j] <= t + SHUT_PAD_MS;
      f.frozen.push(frozen ? 1 : 0);
      for (const side of ['left', 'right']) {
        const step = (((f[side].upperLid.dR[i] ?? NaN) - (f[side].lowerLid.dR[i] ?? NaN)) * dt) / 1000;
        acc[side] = acc[side] * Math.exp(-dt / CLOSURE_TAU_MS) + (!frozen && Number.isFinite(step) ? step : 0);
        f.closure[side].push(acc[side]);
      }
    });
  }
}
const legacy = !rest.flow.frozen;
if (legacy) refreeze(steps, Object.fromEntries(SIDES.map((x) => [x, calibrate(rest, { minValidMs: 0 }).ear[x].baseline])));

// Una tolerancia más baja para los JSON de la fase 4 (reposo de 20 s); el protocolo pedirá 15 s.
const cal = calibrate(rest, { minValidMs: 8000, ...options });
console.log(`${file}\nplan ${report.plan ?? '—'} · commit ${report.build?.commit ?? '—'}${legacy ? ' · JSON anterior a la 5a: cierre recalculado y congelado en los parpadeos' : ''}`);
console.log(`Calibración: ${cal.valid ? 'válida' : `NO VÁLIDA (${cal.reason})`} · tiempo válido ${f(cal.validMs / 1000, 1)} s · ventanas limpias ${f(cal.cleanMs / 1000, 1)} s · cabeza quieta < ${f(cal.headStill)} DI/s`);
for (const side of SIDES) {
  const n = cal.riseNull[side];
  console.log(`  ${L[side]}: umbral ${f(cal.rise[side], 4)} DI (máx. del reposo ${f(n.max, 4)}, p95 ${f(n.p95, 4)}, ${n.n} pares) · EAR reposo ${f(cal.ear[side].baseline)} ± ${f(cal.ear[side].noise, 4)} · ceja p99 ${f(cal.energy[side].brow)} · canto p99 ${f(cal.energy[side].canthus)} DI/s`);
}

/** Repite el detector sobre un paso; los parpadeos del JSON entran cuando el detector los habría cerrado. */
function replay(step) {
  const v = stepView(step);
  const blinks = SIDES.flatMap((side) => v.events[side].map((e) => ({ side, ...e, tDown: e.t - e.duration / 2, tUp: e.t + e.duration / 2 })));
  let now = 0;
  const det = new EventDetector(cal, {
    ...options,
    isClosing: (side) => blinks.some((b) => b.side === side && b.completeness >= 0.5 && now >= b.tDown - 100 && now < b.tUp + 150),
  });
  const pending = [...blinks].sort((a, b) => a.tUp - b.tUp);
  const out = [];
  v.ft.forEach((t, i) => {
    now = t;
    while (pending.length && pending[0].tUp + 150 <= t) {
      const b = pending.shift();
      out.push(...det.pushBlink(b.side, b));
    }
    out.push(...det.pushFlow({
      t,
      closure: { left: v.closure.left[i], right: v.closure.right[i] },
      headSpeed: v.head[i],
      energy: Object.fromEntries(SIDES.map((side) => [side, { brow: v.energy(side, 'brow')[i], canthus: v.energy(side, 'canthus')[i] }])),
    }));
  });
  out.push(...det.flush());
  return out;
}

/** Repeticiones con sus marcas: { rep, cond, hold, release }. */
function repsOf(step) {
  const r = {};
  for (const m of step.marks ?? []) {
    r[m.rep] ??= { rep: m.rep, cond: fixes[`${step.id}:${m.rep}`] ?? m.cond ?? 'act' };
    r[m.rep][m.kind] = m.t;
  }
  return Object.values(r).filter((x) => x.hold != null && x.release != null);
}

const totals = { act: { n: 0, hit: { left: 0, right: 0 } }, control: { n: 0, hit: { left: 0, right: 0 } } };
for (const step of steps) {
  const ev = replay(step);
  const count = (kind, status) => SIDES.map((side) => ev.filter((e) => e.kind === kind && e.side === side && e.status === status).length);
  const [cl, cr] = count('contraction', 'ok');
  const [hl, hr] = count('contraction', 'head');
  const [bl, br] = count('contraction', 'blink');
  const [wl, wr] = count('brow', 'ok');
  const [kl, kr] = count('canthus', 'ok');
  console.log(`\n${step.id}: contracciones I ${cl} · D ${cr} (descartadas por la cabeza ${hl}+${hr}, eran parpadeos ${bl}+${br}) · ceja ${wl}+${wr} · canto ${kl}+${kr}`);
  const reps = repsOf(step);
  if (!reps.length) continue;
  const line = reps.map((r) => {
    const hit = SIDES.map((side) => ev.some((e) => e.kind === 'contraction' && e.status === 'ok' && e.side === side && e.tEnd >= r.hold && e.tStart <= r.release + 1000));
    // Repeticiones apartadas: un parpadeo de verdad (≥ 50 %) dentro de la ventana, como en analyze-flow.mjs.
    const blink = SIDES.some((side) => (step.events[side] ?? []).some((e) => e.completeness >= 0.5 && e.t >= r.hold && e.t <= r.release + 1000));
    if (!blink && step.marks.some((m) => m.cond)) {
      totals[r.cond].n++;
      SIDES.forEach((side, k) => { if (hit[k]) totals[r.cond].hit[side]++; });
    }
    const mark = blink ? 'p' : `${hit[0] ? 'I' : '·'}${hit[1] ? 'D' : '·'}`;
    return `${r.rep}${r.cond === 'control' ? 'c' : ''}:${mark}`;
  });
  console.log(`  repeticiones (c = control; I/D = detectada en ese ojo; p = apartada por un parpadeo): ${line.join(' ')}`);
}
if (totals.act.n + totals.control.n) {
  const a = totals.act;
  const c = totals.control;
  console.log(`\nCON CONTROLES (sin las repeticiones con parpadeos): aciertos I ${a.hit.left}/${a.n} · D ${a.hit.right}/${a.n}; falsas alarmas I ${c.hit.left}/${c.n} · D ${c.hit.right}/${c.n}`);
}
