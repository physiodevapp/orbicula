// Repite el detector de parpadeos sobre las series reales de un JSON del asistente de pruebas
// (orbicula-test-session/1), para ajustar umbrales sin repetir la prueba en el móvil.
//
//   node scripts/dev/replay-blinks.mjs informe.json ['{"startRatio":0.8}']
//
// Cada paso empieza con el detector en frío (sin el reposo que traía de pasos anteriores), así que
// los primeros 1,5 s de cada paso pueden diferir de lo que vio la app.
import { readFileSync } from 'node:fs';
import { BlinkDetector } from '../../src/metrics/blinks.js';

const [file, optsJson] = process.argv.slice(2);
if (!file) throw new Error('Uso: node scripts/dev/replay-blinks.mjs informe.json [opciones JSON]');
const report = JSON.parse(readFileSync(file, 'utf8'));
const opts = optsJson ? JSON.parse(optsJson) : {};

const count = (events) => {
  const c = { blink: 0, closure: 0, narrowing: 0 };
  for (const e of events) c[e.kind]++;
  return `${c.blink}p ${c.closure}c ${c.narrowing}e`;
};

console.log(`opciones: ${JSON.stringify(opts)}   (p = parpadeo, c = cierre, e = entornado)`);
console.log('paso          app I / D              repetido I / D         anotado');
for (const step of report.steps) {
  if (!step.series) continue;
  const replayed = {};
  for (const side of ['left', 'right']) {
    const det = new BlinkDetector(opts);
    replayed[side] = [];
    step.series.t.forEach((t, i) => {
      const v = step.series[side].ear[i];
      const e = det.push(t, v == null ? NaN : v);
      if (e) replayed[side].push(e);
    });
  }
  const app = `${count(step.events.left)} / ${count(step.events.right)}`;
  const rep = `${count(replayed.left)} / ${count(replayed.right)}`;
  const note = [step.user?.counted != null ? `contados ${step.user.counted}` : '', step.expect ? `esperado ${JSON.stringify(step.expect)}` : ''].filter(Boolean).join(' · ');
  console.log(`${step.id.padEnd(13)} ${app.padEnd(22)} ${rep.padEnd(22)} ${note}`);
}
