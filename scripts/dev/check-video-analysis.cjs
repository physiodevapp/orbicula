// Analiza un MP4 en la tarjeta «Vídeo grabado» (fase 6b) con Chromium, sin cámara, y guarda el JSON.
// Ver docs/desarrollo.md.
//   node scripts/dev/check-video-analysis.cjs video.mp4 salida.json [--mirror] [--rest 20] [--cap]
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d);
const [file, out] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--rest'));
const URL_BASE = opt('url', 'http://127.0.0.1:4173/');

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const origin = new URL(URL_BASE).origin;
  const external = [];
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL_BASE);
  await page.setInputFiles('#vidFile', file);
  await page.waitForFunction(() => /decodificar/.test(document.querySelector('#vidInfo').textContent), null, { timeout: 30000 });
  console.log((await page.textContent('#vidInfo')).trim());
  if (flag('mirror')) await page.check('#vidMirror');
  await page.selectOption('#vidRest', opt('rest', '30'));
  if (flag('cap')) await page.check('#vidCap'); else await page.uncheck('#vidCap');
  await page.click('#vidAnalyze');
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 1500000) {
    const p = (await page.textContent('#vidProgress')).trim();
    if (p !== last && (Date.now() - t0) % 30000 < 1200) { console.log(p); last = p; }
    if (/^(Hecho|Cancelado|No se pudo)/.test(p)) { console.log(p); break; }
    await page.waitForTimeout(1000);
  }
  const summary = await page.$$eval('#vidSummary .sum-card', (cards) => cards.map((c) => c.innerText.replace(/\n+/g, ' | ')));
  console.log(summary.join('\n'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#vidDownload')]);
  await dl.saveAs(out);
  console.log('peticiones externas:', external);
  console.log('errores de consola:', errors);
  await browser.close();
})();
