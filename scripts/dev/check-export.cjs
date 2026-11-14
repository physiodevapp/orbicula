// Protocolo con la cámara simulada → botones «Resultados (JSON)» y «CSV» → valida el JSON contra el
// esquema documentado (criterio de aceptación 5). Ver docs/desarrollo.md.
//   node scripts/dev/check-export.cjs --video caras/lid.y4m --out /tmp/export [--query '?escala=0.2']
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };

(async () => {
  const out = arg('out', '/tmp/export');
  fs.mkdirSync(out, { recursive: true });
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (arg('video')) args.push(`--use-file-for-fake-video-capture=${arg('video')}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 380, height: 900 }, permissions: ['camera'], acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  const external = [];
  const origin = new URL(arg('url', 'http://127.0.0.1:4173/')).origin;
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(arg('url', 'http://127.0.0.1:4173/') + arg('query', '?escala=0.2'));
  await page.click('#startBtn');
  await page.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 60000 });
  await page.fill('#prCode', 'P01');
  await page.check('#prAuto');
  await page.click('#prStart');
  await page.waitForFunction(() => document.querySelector('#protocol')?.dataset.state === 'done', null, { timeout: 600000 });
  const save = async (selector, name) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(selector)]); const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); console.log(name, d.suggestedFilename(), fs.statSync(f).size, 'bytes'); return f; };
  const jsonFile = await save('#prExportJson', 'JSON');
  const dls = [];
  page.on('download', (d) => dls.push(d));
  await page.click('#prExportCsv');
  await page.waitForTimeout(1500);
  for (const d of dls) { const f = path.join(out, d.suggestedFilename()); await d.saveAs(f); console.log('CSV', d.suggestedFilename(), fs.statSync(f).size, 'bytes'); }
  console.log('mensaje:', (await page.textContent('#prExportMsg')).trim());
  console.log('peticiones externas:', external);
  console.log('errores de consola:', errors);
  await browser.close();

  const Ajv2020 = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
  const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  (addFormats.default ?? addFormats)(ajv);
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/orbicula-result.schema.json'), 'utf8'));
  const doc = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const ok = ajv.validate(schema, doc);
  console.log('valida contra el esquema:', ok, ok ? '' : JSON.stringify(ajv.errors?.slice(0, 5)));
  console.log('resumen:', JSON.stringify({ schemaVersion: doc.schemaVersion, code: doc.participantCode, capture: doc.capture, protocol: doc.protocol.map((p) => `${p.phase} ${p.start}-${p.end}`), muestras: doc.timeseries.t.length, eventos: doc.events.length, calibracion: doc.calibration?.valid }));
})();
