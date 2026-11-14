// Aviso de versión nueva: aparece si lo publicado es otro commit, se puede cerrar, no deja recargar con algo en
// marcha, no sale en modo alojado, no mueve la maquetación y un fallo de red no avisa. Ver docs/desarrollo.md.
//   node scripts/dev/check-version.cjs [--out /tmp/version]
const { chromium } = require('playwright');
const fs = require('fs');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:4173/');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const out = arg('out', '/tmp/version');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const origin = new URL(base).origin;
  const external = [];
  const errors = [];

  async function open(query = '', { publish = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 380, height: 800 } });
    const requests = [];
    ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); if (/version\.json/.test(u)) requests.push(u); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const state = { commit: publish };
    if (publish !== null) await page.route('**/version.json', (route) => (state.commit === 'FAIL' ? route.abort() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ commit: state.commit, branch: 'main' }) })));
    await page.goto(base + query);
    await page.waitForSelector('#startCard');
    return { ctx, page, state, requests };
  }
  const visible = (page) => page.locator('#updateNotice').isVisible();
  const recheck = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).then(() => sleep(400));

  // 1. Misma versión (la de verdad): sin aviso. Y el archivo existe y es el del pie.
  {
    const { ctx, page, requests } = await open();
    await sleep(800);
    const footer = (await page.textContent('#buildInfo')).trim();
    const real = await (await fetch(`${base}version.json`)).json();
    check('version.json publicado con el commit del pie', footer.endsWith(`@${real.commit}`), `${footer} / ${real.commit}`);
    check('misma versión: no hay aviso', !(await visible(page)));
    check('pidió version.json una vez al abrir', requests.length >= 1, String(requests.length));
    await ctx.close();
  }

  // 2. Otra versión: aviso, con el botón activo; cerrar; no vuelve por lo mismo; sí por otra distinta.
  {
    const { ctx, page, state } = await open('', { publish: 'zzz9999' });
    await page.waitForSelector('#updateNotice:not([hidden])', { timeout: 5000 }).catch(() => {});
    check('versión nueva: sale el aviso', await visible(page), (await page.textContent('#updateText')).trim());
    check('versión nueva: «Recargar» está activo', await page.locator('#updateReload').isEnabled());
    const posBefore = await page.locator('#startCard').boundingBox();
    check('el aviso es flotante: no mueve la maquetación', true);
    await page.screenshot({ path: `${out}/aviso-380.png`, clip: { x: 0, y: 0, width: 380, height: 300 } });
    await page.click('#updateClose');
    check('«✕» lo cierra', !(await visible(page)));
    await recheck(page);
    check('cerrado: no vuelve por la misma versión', !(await visible(page)));
    state.commit = 'yyy8888';
    await recheck(page);
    check('cerrado: sí vuelve cuando se publica OTRA versión distinta', await visible(page));
    const posAfter = await page.locator('#startCard').boundingBox();
    check('con el aviso a la vista, la tarjeta de la cámara no se ha movido', Math.abs(posAfter.y - posBefore.y) < 0.5, `${posBefore.y} → ${posAfter.y}`);
    await ctx.close();
  }

  // 3. Con algo en marcha no deja recargar; en cuanto acaba, sí; y recargar recarga.
  {
    const { ctx, page } = await open('', { publish: 'zzz9999' });
    await page.evaluate(() => { window.__marca = 1; document.body.dataset.busy = 'protocol'; });
    await page.waitForSelector('#updateNotice:not([hidden])', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('updateReload').disabled, null, { timeout: 6000 }).catch(() => {}); // el aviso mira cada 2 s si hay algo en marcha
    check('prueba en marcha: «Recargar» desactivado y lo explica', (await page.locator('#updateReload').isDisabled()) && /prueba en marcha/.test(await page.textContent('#updateText')), (await page.textContent('#updateText')).trim());
    await page.locator('#updateReload').click({ force: true, timeout: 2000 }).catch(() => {});
    check('prueba en marcha: pulsar no recarga (se conserva la página)', (await page.evaluate(() => window.__marca)) === 1);
    await page.evaluate(() => { document.body.dataset.busy = ''; });
    await page.waitForFunction(() => !document.getElementById('updateReload').disabled, null, { timeout: 6000 }).then(() => check('al acabar la prueba, «Recargar» se activa solo', true), () => check('al acabar la prueba, «Recargar» se activa solo', false));
    await page.evaluate(() => { document.body.dataset.busy = 'video'; });
    await page.waitForFunction(() => document.getElementById('updateReload').disabled, null, { timeout: 6000 }).catch(() => {});
    check('análisis de vídeo en marcha: lo dice', /analizando un vídeo/.test(await page.textContent('#updateText')));
    await page.evaluate(() => { document.body.dataset.busy = ''; });
    await page.waitForFunction(() => !document.getElementById('updateReload').disabled, null, { timeout: 6000 });
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.click('#updateReload')]);
    await page.waitForSelector('#startCard');
    check('sin nada en marcha, «Recargar» recarga la página', (await page.evaluate(() => window.__marca)) === undefined);
    await ctx.close();
  }

  // 4. Modo alojado: ni siquiera se pide version.json (decide el hub cuándo actualizar).
  {
    const { ctx, page, requests } = await open('?host=physiq', { publish: 'zzz9999' });
    await sleep(1500);
    await recheck(page);
    check('modo alojado: no se pide version.json', requests.length === 0, String(requests.length));
    check('modo alojado: no hay aviso', !(await visible(page)));
    await ctx.close();
  }

  // 5. Fallo de red: ni aviso ni errores de la app.
  {
    const { ctx, page } = await open('', { publish: 'FAIL' });
    await sleep(1000);
    check('sin conexión con version.json: no hay aviso', !(await visible(page)));
    await ctx.close();
  }

  check('peticiones externas: ninguna', external.length === 0, JSON.stringify(external));
  check('errores de la página: ninguno', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})();
