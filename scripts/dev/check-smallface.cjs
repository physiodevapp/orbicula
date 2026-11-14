// Aviso de cara pequeña (por los píxeles del ojo), por pantalla y por voz. Con la foto entera (cara pequeña)
// debe avisar, solo durante el reposo y sin repetirse a cada rato; con la cara ampliada, no.
// Ver docs/desarrollo.md.   node scripts/dev/check-smallface.cjs --small /tmp/caras/portrait.y4m --big /tmp/caras/crop.y4m
const { chromium } = require('playwright');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:4173/');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(video, label) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', `--use-file-for-fake-video-capture=${video}`] });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, permissions: ['camera'] });
  const page = await ctx.newPage();
  // Voz simulada: una voz local en español que apunta lo que se dice.
  await page.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ localService: true, lang: 'es-ES', name: 'fake' }], speak: (u) => window.__spoken.push(u.text), cancel() {}, onvoiceschanged: null } });
  });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base);
  await page.click('#startBtn');
  await page.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 90000 });
  await sleep(2500);
  const out = { banner: (await page.textContent('#qualityBanner')).trim(), bannerVisible: await page.locator('#qualityBanner').isVisible(), pill: (await page.textContent('#roiPill')).trim() };
  // Sin protocolo en marcha, la voz no habla (no debe molestar mientras se encuadra).
  out.spokenBefore = await page.evaluate(() => window.__spoken.slice());
  await page.check('#prAuto');
  await page.click('#prStart');
  await sleep(8000); // cuenta atrás y primeros segundos del reposo
  out.spoken = await page.evaluate(() => window.__spoken.slice());
  await sleep(9000);
  out.spokenLater = await page.evaluate(() => window.__spoken.slice());
  out.errors = errors;
  await browser.close();
  return out;
}

(async () => {
  const small = await run(arg('small', '/tmp/caras/portrait.y4m'), 'pequeña');
  console.log('cara pequeña →', JSON.stringify({ pill: small.pill, banner: small.banner }));
  check('cara pequeña: el aviso sale en pantalla con los píxeles del ojo', small.bannerVisible && /Cara pequeña/.test(small.banner) && /el ojo mide \d+ px; conviene más de 60/.test(small.banner));
  check('cara pequeña: el indicador dice lo mismo que el aviso', (small.pill.match(/(\d+) px/)?.[1] ?? '') === (small.banner.match(/mide (\d+) px/)?.[1] ?? 'x'), `${small.pill} / ${small.banner}`);
  check('cara pequeña: sin protocolo en marcha, la voz no habla', small.spokenBefore.length === 0);
  const said = (a) => a.filter((t) => /Cara pequeña\. Acércate un poco/.test(t)).length;
  check('cara pequeña: durante el reposo la voz avisa (y detrás de la instrucción del paso)', said(small.spoken) >= 1 && small.spoken.findIndex((t) => /^Paso 1/.test(t)) >= 0 && small.spoken.findIndex((t) => /^Paso 1/.test(t)) < small.spoken.findIndex((t) => /Cara pequeña\. Acércate/.test(t)), JSON.stringify(small.spoken.map((t) => t.slice(0, 30))));
  check('cara pequeña: no se repite a cada rato (como mucho una vez cada 15 s)', said(small.spokenLater) <= said(small.spoken) + 1 && said(small.spokenLater) <= 2, `${said(small.spoken)} → ${said(small.spokenLater)}`);
  check('cara pequeña: errores de consola: ninguno', small.errors.length === 0, JSON.stringify(small.errors));

  const big = await run(arg('big', '/tmp/caras/crop.y4m'), 'grande');
  console.log('cara grande →', JSON.stringify({ pill: big.pill, banner: big.banner }));
  check('cara grande: no hay aviso de cara pequeña', !/Cara pequeña/.test(big.banner));
  check('cara grande: la voz no avisa', said(big.spokenLater) === 0, JSON.stringify(big.spokenLater.map((t) => t.slice(0, 30))));
  check('cara grande: errores de consola: ninguno', big.errors.length === 0, JSON.stringify(big.errors));
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})();
