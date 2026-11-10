// Sesiones guardadas en el dispositivo (IndexedDB real): protocolo → recarga → «Abrir» → mismo JSON;
// un vídeo con la misma huella ofrece «Recuperar el análisis»; borrar; modo alojado sin guardado.
// Ver docs/desarrollo.md.   node scripts/dev/check-saved.cjs --video /tmp/caras/lid.y4m [--out /tmp/saved] [--query '?escala=0.2']
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('url', 'http://127.0.0.1:4173/');
const query = arg('query', '?escala=0.2');
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

(async () => {
  const out = arg('out', '/tmp/saved');
  fs.mkdirSync(out, { recursive: true });
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (arg('video')) args.push(`--use-file-for-fake-video-capture=${arg('video')}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, permissions: ['camera'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  const origin = new URL(base).origin;
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept()); // los «¿Borrar?» de la tarjeta

  const download = async (selector) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(selector)]); const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); return JSON.parse(fs.readFileSync(f, 'utf8')); };
  const strip = (doc) => { const { createdAt, ...rest } = doc; return JSON.stringify(rest); };

  // 1. Protocolo en directo → se guarda solo.
  await page.goto(base + query);
  check('sin sesiones guardadas, la tarjeta no aparece', await page.locator('#savedCard').isHidden());
  await page.click('#startBtn');
  await page.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 60000 });
  await page.fill('#prCode', 'P01');
  await page.check('#prAuto');
  await page.click('#prStart');
  await page.waitForFunction(() => document.querySelector('#protocol')?.dataset.state === 'done', null, { timeout: 600000 });
  await page.waitForSelector('#savedCard:not([hidden])', { timeout: 10000 });
  check('el campo de Resultados trae el código escrito antes de empezar', (await page.inputValue('#prExportCode')) === 'P01');
  // Un nombre en el campo de Resultados: aviso visible al escribir, justo bajo el campo, sin tener que pulsar nada.
  await page.fill('#prExportCode', 'Juan Pérez');
  const err = page.locator('#prExportCode').locator('xpath=ancestor::label/following-sibling::p[contains(@class,"field-error")]');
  check('al escribir un nombre sale el aviso bajo el campo', (await err.isVisible()) && /no es válido|no válido/i.test(await err.textContent()) && (await page.getAttribute('#prExportCode', 'aria-invalid')) === 'true');
  const inView = await err.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).catch(() => false);
  await err.scrollIntoViewIfNeeded();
  await page.click('#prExportJson');
  check('exportar con un nombre no descarga y lo dice en pantalla', /solo admite letras sin tilde/.test(await page.textContent('#prExportMsg')));
  check('el mensaje de exportar queda a la vista', await page.locator('#prExportMsg').evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 2; }));
  await page.fill('#prExportCode', 'P01');
  check('al corregir el código, el aviso desaparece', await err.isHidden());
  const before = await download('#prExportJson');
  check('al terminar el protocolo se guarda la sesión', (await page.locator('#savedList .sum-card').count()) === 1, (await page.textContent('#savedList .step-title')).trim());

  // 2. Recarga: sin cámara ni protocolo, la sesión sigue ahí y se abre.
  await page.reload();
  await page.waitForSelector('#savedCard:not([hidden])', { timeout: 10000 });
  check('tras recargar, la sesión sigue guardada', (await page.locator('#savedList .sum-card').count()) === 1);
  await page.click('#savedList button:has-text("Abrir")');
  await page.waitForSelector('#savedSummary:not([hidden])');
  check('«Abrir» muestra el resumen y el código', (await page.inputValue('#savedCode')) === 'P01' && (await page.textContent('#savedSummary')).length > 100);
  const after = await download('#savedExportJson');
  check('el JSON exportado tras recargar es idéntico al de antes (salvo la fecha)', strip(before) === strip(after));

  // 3. Un código que parece un nombre se rechaza y no descarga.
  await page.fill('#savedCode', 'Juan Pérez');
  check('en sesiones guardadas, el aviso sale al escribir y se ve sin pulsar nada', await page.locator('#savedCode').locator('xpath=ancestor::label/following-sibling::p[contains(@class,"field-error")]').isVisible());
  await page.click('#savedExportJson');
  check('un código con nombre se rechaza', /solo admite letras sin tilde/.test(await page.textContent('#savedViewMsg')));
  await page.fill('#savedCode', 'P02');
  await page.click('#savedExportCsv');
  await page.waitForTimeout(800);
  await page.waitForFunction(() => /P02/.test(document.querySelector('#savedList .step-title')?.textContent ?? ''), null, { timeout: 5000 }).then(() => check('el código nuevo queda guardado', true), () => check('el código nuevo queda guardado', false));

  // 4. Un vídeo con la misma huella ofrece recuperar el análisis (se inyecta una sesión de vídeo con la huella del archivo).
  const fixture = path.join(__dirname, '../../tests/fixtures/rot-cw90-moov-end.mp4');
  const { openMp4 } = await import('../../src/video/mp4.js');
  const { fingerprintOf } = await import('../../src/persistence/fingerprint.js');
  const buf = fs.readFileSync(fixture);
  const fileLike = { size: buf.length, slice: (a, b) => ({ arrayBuffer: async () => buf.buffer.slice(buf.byteOffset + a, buf.byteOffset + b) }) };
  const key = fingerprintOf(fileLike, await openMp4(fileLike));
  await page.evaluate(async (key) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('orbicula', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
    const [h] = await get('sessions');
    const [d] = await get('data');
    const data = JSON.parse(d.json);
    data.extra = { stats: { frames: 123 }, context: { build: { version: '0.1.0' } }, settings: { restSec: 30, facing: 'front', mirrored: true }, startedAt: null };
    const id = `video-${key}`;
    await new Promise((res) => { const tx = db.transaction(['sessions', 'data'], 'readwrite'); tx.objectStore('data').put({ id, json: JSON.stringify(data) }); tx.objectStore('sessions').put({ ...h, id, kind: 'video', fingerprintKey: key }); tx.oncomplete = res; });
  }, key);
  await page.reload();
  await page.waitForSelector('#savedList .sum-card');
  check('la lista muestra la sesión del protocolo y la del vídeo', (await page.locator('#savedList .sum-card').count()) === 2);
  // El mismo archivo con otro nombre (el selector de Android lo cambia) sigue siendo el mismo vídeo.
  const renamed = path.join(out, '1000012345.mp4');
  fs.copyFileSync(fixture, renamed);
  await page.setInputFiles('#vidFile', renamed);
  await page.waitForSelector('#vidSaved:not([hidden])', { timeout: 10000 });
  check('el vídeo, con otro nombre, ofrece recuperar el análisis', /Ya analizaste este vídeo/.test(await page.textContent('#vidSavedText')));
  await page.click('#vidSavedRestore');
  await page.waitForSelector('#vidSummary:not([hidden])');
  check('«Recuperar» muestra el resumen, los ajustes y los botones de exportar', (await page.locator('#vidExport').isVisible()) && (await page.inputValue('#vidFacing')) === 'front' && (await page.isChecked('#vidMirror')) && /recuperado/.test(await page.textContent('#vidProgress')));
  const doc = await download('#vidExportJson');
  check('el JSON del vídeo recuperado es de captura «file / frame-by-frame»', doc.capture.source === 'file' && doc.capture.analysis === 'frame-by-frame' && doc.capture.mirrored === true);
  // Otro vídeo (otra huella) no ofrece nada.
  await page.setInputFiles('#vidFile', path.join(__dirname, '../../tests/fixtures/vfr.mp4'));
  await page.waitForSelector('#vidInfo:not(:empty)');
  await page.waitForTimeout(500);
  check('otro vídeo no ofrece recuperar nada', await page.locator('#vidSaved').isHidden());

  // 5. Borrar.
  await page.locator('#savedList .sum-card').first().locator('button:has-text("Borrar")').click();
  await page.waitForFunction(() => document.querySelectorAll('#savedList .sum-card').length === 1);
  await page.click('#savedClear');
  await page.waitForSelector('#savedCard[hidden]', { state: 'attached' });
  check('«Borrar todo» vacía la lista y oculta la tarjeta', await page.locator('#savedCard').isHidden());
  const left = await page.evaluate(async () => { const db = await new Promise((res) => { const r = indexedDB.open('orbicula', 1); r.onsuccess = () => res(r.result); }); const n = (s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => res(q.result); }); return [await n('sessions'), await n('data')]; });
  check('no queda nada en IndexedDB', left[0] === 0 && left[1] === 0, JSON.stringify(left));

  // 6. Modo alojado: no se guarda ni se abre la base.
  const hosted = await ctx.newPage();
  await hosted.goto(`${base}?host=physiq&escala=0.2`);
  await hosted.waitForTimeout(800);
  const dbs = await hosted.evaluate(async () => (await indexedDB.databases?.())?.map((d) => d.name) ?? []);
  check('con ?host=physiq no hay tarjeta de guardado', await hosted.locator('#savedCard').isHidden());
  check('peticiones externas: ninguna', external.length === 0, JSON.stringify(external));
  check('errores de consola: ninguno', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})();
