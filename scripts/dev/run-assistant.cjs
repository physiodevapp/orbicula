// Recorre solo el asistente de pruebas en Chromium (cámara simulada) y guarda su JSON.
// Pulsa «Siguiente» en cada revisión hasta terminar. Ver docs/desarrollo.md.
//
//   node scripts/dev/run-assistant.cjs --video /ruta/lid.y4m --out /ruta/informe.json
//        [--plan phase4|phase3] [--query '?escala=0.25'] [--url http://127.0.0.1:4173/] [--auto]
// Con --auto usa el modo seguido y no pulsa nada entre pasos (comprueba que avanza solo).
const { chromium } = require('playwright');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL_BASE = arg('url', 'http://127.0.0.1:4173/');
const VIDEO = arg('video', null);
const OUT = arg('out', 'informe.json');
const PLAN = arg('plan', 'phase4');
const QUERY = arg('query', '?escala=0.25');
const AUTO = process.argv.includes('--auto');

(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (VIDEO) args.push(`--use-file-for-fake-video-capture=${VIDEO}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, permissions: ['camera'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const origin = new URL(URL_BASE).origin;
  const external = [];
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL_BASE + QUERY);
  await page.click('#startBtn');
  await page.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 60000 });
  await page.selectOption('#asPlan', PLAN);
  if (AUTO) await page.check('#asAuto');
  else await page.uncheck('#asAuto');
  await page.click('#asStart');
  const t0 = Date.now();
  let reviews = 0;
  while (Date.now() - t0 < 600000) {
    const st = await page.getAttribute('#assistant', 'data-state');
    if (st === 'done') break;
    if (st === 'review' && !AUTO) {
      reviews++;
      console.log(`— ${await page.textContent('#asRevTitle')}\n${(await page.textContent('#asSummary')).trim()}`);
      await page.click('#asNext');
    }
    await page.waitForTimeout(300);
  }
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#asDownload')]);
  await dl.saveAs(OUT);
  if (AUTO) {
    const steps = JSON.parse(require('fs').readFileSync(OUT, 'utf8')).steps;
    console.log(`modo seguido: ${steps.length} pasos guardados sin pulsar nada (${steps.map((x) => x.status).join(', ')})`);
  }
  console.log(`pasos revisados: ${reviews}; informe en ${OUT}`);
  console.log('peticiones externas:', external);
  console.log('errores de consola:', errors);
  await browser.close();
})();
