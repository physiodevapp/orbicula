// Protocolo con la casilla «Grabar el vídeo…» marcada y análisis posterior del vídeo grabado (fase 6c),
// con la cámara simulada. Ver docs/desarrollo.md.
//   node scripts/dev/check-protocol-video.cjs --video caras/lid.y4m --live en-directo.json --out analisis.json [--query '?escala=0.4'] [--full]
const { chromium } = require('playwright');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_BASE = arg('url', 'http://127.0.0.1:4173/');
const QUERY = arg('query', '?escala=0.4');
const FULL = process.argv.includes('--full');

(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (arg('video')) args.push(`--use-file-for-fake-video-capture=${arg('video')}`);
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
  console.log('casilla de grabar visible:', await page.isVisible('#prRecord'));
  await page.check('#prRecord');
  await page.check('#prAuto');
  await page.click('#prStart');
  await page.waitForFunction(() => document.querySelector('#protocol')?.dataset.state === 'done', null, { timeout: 600000 });
  await page.waitForSelector('#prRecBlock:not([hidden])', { timeout: 30000 });
  console.log('vídeo:', (await page.textContent('#prRecInfo')).trim());
  const [dl0] = await Promise.all([page.waitForEvent('download'), page.click('#prDownload')]);
  await dl0.saveAs(arg('live', 'en-directo.json'));
  if (FULL) await page.uncheck('#prRecCap'); else await page.check('#prRecCap'); // por defecto la prueba usa uno de cada dos
  await page.click('#prRecAnalyze');
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 1700000) {
    const p = (await page.textContent('#prRecProgress')).trim();
    if (p !== last && (Date.now() - t0) % 20000 < 1200) { console.log(p); last = p; }
    if (/^(Hecho|Cancelado|No se pudo)/.test(p)) { console.log(p); break; }
    await page.waitForTimeout(1000);
  }
  console.log((await page.$$eval('#prRecSummary .sum-card', (c) => c.map((x) => x.innerText.replace(/\n+/g, ' | ')))).join('\n'));
  if (/debug/.test(QUERY)) console.log('flujo:', JSON.stringify(await page.evaluate(() => ({ series: window.__orbicula.flowSeries.t.length, counts: window.__orbicula.flow.counts, strip: !!window.__orbicula.flow.strip, ready: window.__orbicula.flow.ready, inflight: window.__orbicula.flow.inflight, unlimited: window.__orbicula.flow.unlimited }))));
  console.log('bloque del vídeo tras analizar:', await page.isVisible('#prRecAnalyze'), '| info:', JSON.stringify((await page.textContent('#prRecInfo')).trim()));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#prRecDownload')]);
  await dl.saveAs(arg('out', 'analisis.json'));
  console.log('peticiones externas:', external);
  console.log('errores de consola:', errors);
  await browser.close();
})();
