// Comprueba el flujo por ROI con un vídeo sintético de respuesta conocida (ver make-face-videos.py
// y docs/desarrollo.md). Activa la curva «Flujo», graba un ciclo del vídeo (16 s) y resume, por
// tramos de 0,5 s, el MÁXIMO de la velocidad residual (DI/s) del párpado superior de cada lado con
// las tres compensaciones (un movimiento breve, como las rampas del vídeo del párpado, dura pocos
// pares y la mediana lo ocultaría), y la mediana del EAR.
//
//   node scripts/dev/check-flow.cjs --video /ruta/lid.y4m [--url http://127.0.0.1:4173/] [--seconds 17]
const { chromium } = require('playwright');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL_BASE = arg('url', 'http://127.0.0.1:4173/');
const VIDEO = arg('video', null);
const SECONDS = Number(arg('seconds', 17));

(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (VIDEO) args.push(`--use-file-for-fake-video-capture=${VIDEO}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${URL_BASE}?debug`);
  await page.click('#startBtn');
  await page.click('[data-metric="flow"]'); // enciende el flujo
  await page.waitForFunction(() => window.__orbicula?.flowSeries.t.length > 10, null, { timeout: 30000 });
  await page.evaluate(() => { window.__orbicula.flowSeries.clear(); window.__orbicula.series.clear(); });
  await page.waitForTimeout(SECONDS * 1000);
  const data = await page.evaluate(() => {
    const { flowSeries: f, series: s } = window.__orbicula;
    return { ft: f.t, fl: f.left, fr: f.right, st: s.t, el: s.left.ear, er: s.right.ear };
  });
  await browser.close();

  const t0 = data.ft[0];
  const bins = {};
  const add = (t, key, v) => {
    if (!Number.isFinite(v)) return;
    const b = Math.floor((t - t0) / 500);
    ((bins[b] ??= {})[key] ??= []).push(v);
  };
  data.ft.forEach((t, i) => {
    for (const v of ['none', 'reference', 'pose']) {
      add(t, `I.${v}`, data.fl[`upperLid:${v}`][i]);
      add(t, `D.${v}`, data.fr[`upperLid:${v}`][i]);
    }
  });
  data.st.forEach((t, i) => { add(t, 'earI', data.el[i]); add(t, 'earD', data.er[i]); });
  const med = (a) => (a?.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
  const max = (a) => (a?.length ? Math.max(...a) : NaN);
  const f = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '  —  ').padStart(6);
  console.log('   s   | máx. párpado sup. I: none  ref  pose | D: none   ref   pose |  EAR I   EAR D');
  for (const b of Object.keys(bins).map(Number).sort((a, c) => a - c)) {
    const x = bins[b];
    console.log(`${(b / 2).toFixed(1).padStart(5)}  |  ${f(max(x['I.none']))} ${f(max(x['I.reference']))} ${f(max(x['I.pose']))} | ${f(max(x['D.none']))} ${f(max(x['D.reference']))} ${f(max(x['D.pose']))} | ${f(med(x.earI))} ${f(med(x.earD))}`);
  }
  console.log(`pares de flujo: ${data.ft.length} en ${((data.ft.at(-1) - t0) / 1000).toFixed(1)} s`);
  console.log('errores de consola:', errors);
})();
