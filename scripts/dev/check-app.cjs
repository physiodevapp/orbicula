// Abre la app en Chromium con una cámara simulada y vuelca lo que se ve (ver docs/desarrollo.md).
//
//   node scripts/dev/check-app.cjs --video /ruta/crop.y4m [--url http://127.0.0.1:4173/] [--query '?escala=0.25']
//                                  [--wait 12000] [--shot /ruta/captura.png] [--bench /ruta/rendimiento.json] [--flow]
//
// Sin --video usa el patrón de prueba de Chromium (sin cara). Con --bench lanza la prueba de rendimiento,
// espera a que termine y guarda su JSON. Con --flow activa el flujo óptico en directo antes de esperar. Playwright está instalado de forma global: require('playwright').
const { chromium } = require('playwright');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const URL_BASE = arg('url', 'http://127.0.0.1:4173/');
const VIDEO = arg('video', null);
const QUERY = arg('query', '');
const WAIT = Number(arg('wait', 12000));
const SHOT = arg('shot', null);
const BENCH = arg('bench', null);
const FLOW = process.argv.includes('--flow');

(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (VIDEO) args.push(`--use-file-for-fake-video-capture=${VIDEO}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, permissions: ['camera'], deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const origin = new URL(URL_BASE).origin;
  const external = [];
  const errors = [];
  ctx.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/XNNPACK/.test(t)) errors.push(t.slice(0, 200));
    if (/bloqueada/.test(t)) errors.push(`[barrera] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL_BASE + QUERY);
  await page.click('#startBtn');
  if (FLOW) {
    await page.click('summary:has-text("Verificación")');
    await page.check('#flowToggle');
  }
  await page.waitForTimeout(BENCH ? 5000 : WAIT);

  if (BENCH) {
    await page.click('#bStart');
    const t0 = Date.now();
    while (Date.now() - t0 < 300000 && (await page.getAttribute('#bench', 'data-state')) !== 'done') await page.waitForTimeout(500);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bDownload')]);
    await dl.saveAs(BENCH);
    console.log('rendimiento guardado en', BENCH);
  }

  if (!FLOW) await page.click('summary:has-text("Verificación")');
  const text = async (sel) => ((await page.$(sel)) ? (await page.textContent(sel)).trim() : '—');
  for (const sel of ['#fpsPill', '#resPill', '#camPill', '#anaPill', '#roiPill', '#kvDelegate', '#kvTime', '#kvSize', '#kvEye',  '#kvBlocked', '#kvFlow', '#kvStrip', '#kvFlowLoad', '#earLv', '#earRv', '#blinkLv', '#blinkRv', '#asymVal', '#qualityBanner', '#errorBanner']) {
    console.log(sel.padEnd(16), await text(sel));
  }
  if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });
  console.log('peticiones externas:', external);
  console.log('errores de consola:', errors);
  await browser.close();
})();
