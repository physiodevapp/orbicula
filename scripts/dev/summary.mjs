// Resumen del protocolo (src/protocol/summary.js) a partir de un JSON del asistente con plan «protocol».
//   node scripts/dev/summary.mjs informe.json [--json]
import { readFileSync } from 'node:fs';
import { summarizeProtocol } from '../../src/protocol/summary.js';

const [file, flag] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file, 'utf8'));
const s = summarizeProtocol(r.steps);
if (flag === '--json') {
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
const f = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
console.log(`${file}\nplan ${r.plan} · commit ${r.build?.commit}`);
for (const w of s.warnings) console.log(`AVISO: ${w}`);
for (const [id, p] of Object.entries(s.phases)) {
  console.log(`\n${p.title}${p.quality.reliable ? '' : `  [poco fiable: ${p.quality.notes.join('; ')}]`}  (cara ${p.quality.face}, cabeza en movimiento ${p.quality.headMoving}, análisis ${p.quality.analysisFps}/s)`);
  const keys = [...new Set([...Object.keys(p.left), ...Object.keys(p.right)])];
  for (const k of keys) console.log(`  ${k.padEnd(18)} I ${f(p.left[k]).padEnd(28)} D ${f(p.right[k]).padEnd(28)} asim ${f(p.asymmetry[k])}`);
}
