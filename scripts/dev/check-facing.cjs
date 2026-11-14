// El selector Trasera / Frontal de la tarjeta de inicio: elige sin encender la cámara, comparte el estado con
// el de los controles y se respeta al activarla. Ver docs/desarrollo.md.
//   node scripts/dev/check-facing.cjs --video /tmp/caras/lid.y4m
const { chromium } = require('playwright');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:4173/');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
(async () => {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (arg('video')) args.push(`--use-file-for-fake-video-capture=${arg('video')}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base + '?escala=0.2');
  const pressed = (sel) => page.$$eval(sel, (bs) => bs.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.facing));
  check('en la tarjeta de inicio hay un selector con «Trasera» marcada', JSON.stringify(await pressed('#startCard [data-facing]')) === '["rear"]');
  await page.click('#startCard [data-facing="front"]');
  check('elegir «Frontal» NO enciende la cámara', await page.evaluate(() => !document.querySelector('video').srcObject) && (await page.locator('#startCard').isVisible()));
  check('y queda marcada también en los controles de la cámara', JSON.stringify(await pressed('#controls [data-facing]')) === '["front"]');
  await page.click('#startBtn');
  await page.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 90000 });
  check('al activar, la cámara usa lo elegido (frontal)', (await page.textContent('#camPill')).trim() === 'frontal');
  check('el selector de los controles también dice «Frontal»', JSON.stringify(await pressed('#controls [data-facing]')) === '["front"]');
  await page.click('#controls [data-facing="rear"]'); // con la cámara encendida, sí la reinicia
  await page.waitForFunction(() => document.getElementById('camPill').textContent.trim() === 'trasera', null, { timeout: 30000 }).then(() => check('con la cámara encendida, cambiar de cámara la reinicia (trasera)', true), () => check('con la cámara encendida, cambiar de cámara la reinicia (trasera)', false));
  check('errores de consola: ninguno', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})();
