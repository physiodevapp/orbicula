// Modo alojado (?host=physiq): sin cabecera ni pie, tema oscuro forzado y los tokens del hub; y el modo
// autónomo sin cambios. Ver docs/desarrollo.md.   node scripts/dev/check-host.cjs [--out /tmp/host]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:4173/');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

(async () => {
  const out = arg('out', '/tmp/host');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const origin = new URL(base).origin;
  const external = [];
  const errors = [];

  async function open(query, colorScheme) {
    const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, colorScheme });
    ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(base + query);
    await page.waitForSelector('#startCard');
    const info = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const shown = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
      return {
        host: document.documentElement.dataset.host ?? null, theme: document.documentElement.dataset.theme ?? null,
        header: shown('appHeader'), footer: shown('appFooter'),
        text: css.getPropertyValue('--text').trim(), text2: css.getPropertyValue('--text2').trim(), danger: css.getPropertyValue('--danger').trim(),
        accent: css.getPropertyValue('--accent').trim(), headerH: css.getPropertyValue('--header-h').trim(),
        bg: getComputedStyle(document.body).backgroundColor,
        scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      };
    });
    return { ctx, page, info };
  }

  // Autónomo
  for (const scheme of ['dark', 'light']) {
    const { ctx, info } = await open('', scheme);
    check(`autónomo (${scheme}): cabecera y pie visibles, sin data-host`, info.header && info.footer && info.host === null, JSON.stringify({ header: info.header, footer: info.footer }));
    check(`autónomo (${scheme}): el tema sigue al sistema`, scheme === 'dark' ? info.bg === 'rgb(10, 13, 18)' : info.bg === 'rgb(245, 247, 251)', info.bg);
    await ctx.close();
  }
  // Un anfitrión desconocido se ignora
  { const { ctx, info } = await open('?host=otro', 'dark'); check('?host=otro se ignora', info.host === null && info.header && info.footer); await ctx.close(); }

  // Alojado, con el sistema en claro Y en oscuro: siempre oscuro (el hub es solo oscuro)
  for (const scheme of ['light', 'dark']) {
    const { ctx, page, info } = await open('?host=physiq', scheme);
    check(`alojado (sistema ${scheme}): sin cabecera ni pie`, !info.header && !info.footer, JSON.stringify({ header: info.header, footer: info.footer }));
    check(`alojado (sistema ${scheme}): data-host=physiq y tema oscuro forzado`, info.host === 'physiq' && info.theme === 'dark' && info.bg === 'rgb(10, 13, 18)', `${info.host}/${info.theme}/${info.bg}`);
    check(`alojado (sistema ${scheme}): tokens del hub (texto, texto atenuado, error)`, info.text === '#e8edf2' && info.text2 === '#8aa4bc' && info.danger === '#ef4444', `${info.text} ${info.text2} ${info.danger}`);
    check(`alojado (sistema ${scheme}): el acento sigue siendo el de orbicula`, info.accent === '#5ec8d8', info.accent);
    check(`alojado (sistema ${scheme}): sin desbordamiento horizontal a 380 px`, info.scrollW <= info.innerW, `${info.scrollW}/${info.innerW}`);
    check(`alojado (sistema ${scheme}): la tarjeta de la cámara va arriba, sin hueco de cabecera`, (await page.locator('#startCard').boundingBox()).y < 40);
    if (scheme === 'light') await page.screenshot({ path: path.join(out, 'alojado-380.png') });
    await ctx.close();
  }
  // Cambiar el tema después de cargar (lo que hará `orbicula:config { theme }` en 7c): pasa a claro, y a oscuro otra vez.
  { const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, colorScheme: 'dark' }); const page = await ctx.newPage();
    await page.goto(base + '?host=physiq'); await page.waitForSelector('#startCard');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    const light = await bg();
    const headerHidden = (await page.evaluate(() => getComputedStyle(document.getElementById('appHeader')).display)) === 'none';
    const textLight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text').trim());
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    check('alojado: cambiar el tema a claro funciona (con los colores claros de orbicula) y sigue sin cabecera', light === 'rgb(245, 247, 251)' && headerHidden && textLight === '#121826', `${light} ${textLight}`);
    check('alojado: y vuelve a oscuro', (await bg()) === 'rgb(10, 13, 18)');
    await ctx.close(); }

  check('peticiones externas: ninguna', external.length === 0, JSON.stringify(external));
  check('errores de consola: ninguno', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})();
