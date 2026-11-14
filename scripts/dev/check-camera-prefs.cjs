// Preferencias de la cámara y del análisis en directo. Ver docs/desarrollo.md.
//   node scripts/dev/check-camera-prefs.cjs
// 1) Si el navegador da la frontal al pedir la trasera (un ordenador), la próxima vez se preselecciona la
//    frontal; si alguna vez da la trasera, se olvida. Se simula con getSettings().facingMode.
// 2) El selector «Análisis en directo» (GPU / CPU) recarga el modelo con ese acelerador y se recuerda.
const { chromium } = require('playwright');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:4173/');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, permissions: ['camera'] });
  // La cámara simulada no dice su lado: se hace que diga «user» (frontal), como la de un ordenador.
  await ctx.addInitScript(() => {
    const orig = MediaStreamTrack.prototype.getSettings;
    MediaStreamTrack.prototype.getSettings = function () {
      const s = orig.call(this);
      return localStorage.getItem('test.facing') ? { ...s, facingMode: localStorage.getItem('test.facing') } : s;
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const pressed = () => page.$$eval('#startCard [data-facing]', (bs) => bs.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.facing).join());
  const startAndWait = async () => {
    await page.click('#startBtn');
    await page.waitForFunction(() => /análisis|Modelo listo/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 90000 });
  };

  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('test.facing', 'user'); });
  await page.reload();
  check('al principio, la trasera preseleccionada', (await pressed()) === 'rear');
  await startAndWait();
  check('se pide la trasera y el navegador da la frontal', (await page.textContent('#camPill')).trim() === 'frontal');
  await page.reload();
  check('al volver, la frontal ya viene preseleccionada', (await pressed()) === 'front');
  await page.evaluate(() => localStorage.setItem('test.facing', 'environment'));
  await page.reload();
  await page.click('#startCard [data-facing="rear"]');
  await startAndWait();
  await page.reload();
  check('si alguna vez da la trasera, se olvida', (await pressed()) === 'rear');

  // Análisis en directo con la CPU.
  await page.evaluate(() => localStorage.removeItem('test.facing'));
  await page.reload();
  await startAndWait();
  await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => (d.open = true)); });
  await page.selectOption('#liveDelegate', 'cpu');
  await page.waitForFunction(() => /CPU/.test(document.getElementById('kvDelegate')?.textContent ?? ''), null, { timeout: 90000 })
    .then(() => check('«CPU» recarga el modelo en la CPU', true), async () => check('«CPU» recarga el modelo en la CPU', false, await page.textContent('#kvDelegate')));
  await page.reload();
  check('y se recuerda', (await page.inputValue('#liveDelegate')) === 'cpu');
  check('errores de consola: ninguno', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})();
