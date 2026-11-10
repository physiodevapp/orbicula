// Integración con el hub por postMessage (criterio 6), con un «hub» en otro origen:
//   · origen NO permitido (orbicula con la lista por defecto): no hay ready, y la configuración se ignora;
//   · origen permitido (orbicula construida con VITE_ORBICULA_ORIGINS): ready, configuración, protocolo → result
//     válido contra el esquema, reenvío con otro código, y el hub que oculta orbicula (cámara apagada).
// Ver docs/desarrollo.md.   node scripts/dev/check-hub.cjs --video /tmp/caras/lid.y4m [--out /tmp/hub]
// Necesita: orbicula con la lista por defecto en :4173 (npm run build && vite preview) y se encarga del resto.
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.join(__dirname, '../..');
const HUB_PORT = 4174; // el «hub»
const DEFAULT_PORT = 4173; // orbicula con la lista por defecto
const ALLOWED_PORT = 4175; // orbicula que permite el origen del «hub»
const HUB = `http://127.0.0.1:${HUB_PORT}`;
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${name}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];

/** El «hub»: sirve public/hub-prueba/ en otro origen. */
function hubServer() {
  const dir = path.join(ROOT, 'public/hub-prueba');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = new URL(req.url, HUB).pathname.replace(/^\/hub-prueba\/?/, '') || 'index.html';
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'text/plain' });
      res.end(fs.readFileSync(f));
    }).listen(HUB_PORT, '127.0.0.1', () => resolve(s));
  });
}
async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const r = await fetch(url); if (r.ok) return; } catch { /* aún no */ } await sleep(300); }
  throw new Error(`no responde ${url}`);
}

(async () => {
  const out = arg('out', '/tmp/hub');
  fs.mkdirSync(out, { recursive: true });
  // orbicula que permite el origen del hub (se construye aparte, con la variable de la construcción)
  const altDir = '/tmp/orbicula-hub-dist';
  execSync(`npx vite build --outDir ${altDir} --emptyOutDir`, { cwd: ROOT, env: { ...process.env, VITE_ORBICULA_ORIGINS: HUB }, stdio: 'ignore' });
  children.push(spawn('npx', ['vite', 'preview', '--outDir', altDir, '--port', String(ALLOWED_PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: ROOT, stdio: 'ignore' }));
  const server = await hubServer();
  await waitFor(`http://127.0.0.1:${ALLOWED_PORT}/`);
  await waitFor(`http://127.0.0.1:${DEFAULT_PORT}/`);

  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
  if (arg('video')) args.push(`--use-file-for-fake-video-capture=${arg('video')}`);
  const browser = await chromium.launch({ args });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 1000 }, permissions: ['camera'], colorScheme: 'light' });
  const external = [];
  const errors = [];
  const warnings = [];
  ctx.on('request', (r) => { const u = r.url(); if (!/^(http:\/\/127\.0\.0\.1:417[345]|data:|blob:)/.test(u)) external.push(u); });
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' && !/XNNPACK/.test(m.text())) errors.push(m.text().slice(0, 160)); if (m.type() === 'warning') warnings.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  };
  const inFrame = (page, port) => page.frames().find((f) => f.url().startsWith(`http://127.0.0.1:${port}/`));
  const lines = (page) => page.evaluate(() => window.__hub.lines.slice());
  const theme = (f) => f.evaluate(() => document.documentElement.dataset.theme ?? null);

  // ── 1. Origen NO permitido ──────────────────────────────────────────────────────────────────────────────────
  {
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${HUB}/hub-prueba/?orbicula=${encodeURIComponent(`http://127.0.0.1:${DEFAULT_PORT}/?host=physiq`)}`);
    const f = await (async () => { for (let i = 0; i < 50; i++) { const x = inFrame(page, DEFAULT_PORT); if (x) return x; await sleep(100); } })();
    await f.waitForSelector('#startCard');
    await sleep(2500);
    check('origen no permitido: orbicula no manda ready', !(await lines(page)).some((l) => /orbicula:ready/.test(l)));
    await page.click('#sendConfig'); // sin nada elegido manda solo lang
    await page.selectOption('#theme', 'light');
    await page.click('#sendConfig');
    await page.click('#hide');
    await sleep(800);
    check('origen no permitido: la configuración se ignora (sigue oscuro)', (await theme(f)) === 'dark');
    check('origen no permitido: el hub no recibe ningún mensaje', !(await lines(page)).some((l) => l.includes('←')));
    await page.close();
  }

  // ── 1b. Un hub que olvida `allow="screen-wake-lock"`: se ve en el ready y no hay errores en la consola ─────────
  {
    const page = await ctx.newPage();
    watch(page);
    const errorsBefore = errors.length;
    await page.goto(`${HUB}/hub-prueba/?orbicula=${encodeURIComponent(`http://127.0.0.1:${ALLOWED_PORT}/?host=physiq`)}`);
    await page.evaluate(() => { const fr = document.getElementById('frame'); fr.setAttribute('allow', 'camera'); fr.src = fr.src; });
    await page.waitForFunction(() => window.__hub.lines.filter((l) => /orbicula:ready/.test(l)).length >= 1 && window.__hub.lines.some((l) => /"screenWakeLock":false/.test(l)), null, { timeout: 15000 }).catch(() => {});
    const l = (await lines(page)).filter((x) => /orbicula:ready/.test(x)).at(-1) ?? '';
    check('sin allow="screen-wake-lock", el ready lo dice (camera sí, screenWakeLock no)', /"camera":true/.test(l) && /"screenWakeLock":false/.test(l), l);
    check('y el hub simulado lo avisa en pantalla', /FALTAN permisos/.test(await page.textContent('#status')));
    const f = inFrame(page, ALLOWED_PORT);
    await f.click('#startBtn');
    await f.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 90000 });
    await f.check('#prAuto');
    await f.click('#prStart');
    await sleep(3000);
    check('sin ese permiso no se pide el bloqueo de pantalla: sin errores de «permissions policy»', errors.length === errorsBefore, JSON.stringify(errors.slice(errorsBefore)));
    await page.close();
  }

  // ── 2. Origen permitido ─────────────────────────────────────────────────────────────────────────────────────
  const page = await ctx.newPage();
  watch(page);
  await page.goto(`${HUB}/hub-prueba/?orbicula=${encodeURIComponent(`http://127.0.0.1:${ALLOWED_PORT}/?host=physiq`)}`);
  const f = await (async () => { for (let i = 0; i < 50; i++) { const x = inFrame(page, ALLOWED_PORT); if (x) return x; await sleep(100); } })();
  await f.waitForSelector('#startCard');
  await page.waitForFunction(() => window.__hub.lines.some((l) => /orbicula:ready/.test(l)), null, { timeout: 15000 });
  const ready = (await lines(page)).find((l) => /orbicula:ready/.test(l));
  check('origen permitido: ready con la versión de la app y del esquema', /"appVersion":"[\d.]+"/.test(ready) && /"schemaVersion":"1"/.test(ready), ready);
  check('orbicula en el hub: sin cabecera ni pie y tema oscuro (aunque el sistema esté en claro)', (await theme(f)) === 'dark' && (await f.evaluate(() => getComputedStyle(document.getElementById('appHeader')).display)) === 'none');

  // Configuración: se manda sola al recibir ready (casilla marcada) con lo elegido
  await page.selectOption('#theme', 'light');
  await page.click('#short');
  await page.click('#sendConfig');
  await sleep(500);
  check('config: el tema pasa a claro', (await theme(f)) === 'light');
  check('config: el protocolo corto se aplica (30 / 30 / 3)', (await f.evaluate(() => [prRest.value, prNatural.value, prReps.value].join('/'))) === '30/30/3');
  warnings.length = 0;
  await page.click('#bad');
  await sleep(500);
  check('config no válida: no cambia nada y avisa en la consola', (await theme(f)) === 'light' && (await f.evaluate(() => prRest.value)) === '30' && warnings.some((w) => /configuración del hub/.test(w)), warnings[0]?.slice(0, 100));
  await page.selectOption('#theme', 'dark');
  await page.click('#sendConfig');
  await sleep(300);
  check('config: vuelve a oscuro', (await theme(f)) === 'dark');

  // El hub oculta orbicula a mitad de un protocolo: cámara apagada y protocolo detenido, conservando lo hecho
  await f.click('#startBtn');
  await f.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 90000 });
  await f.fill('#prCode', 'P01');
  await f.check('#prAuto');
  await f.click('#prStart');
  await f.waitForFunction(() => document.querySelector('#protocol')?.dataset.state === 'active', null, { timeout: 20000 });
  await sleep(5000);
  const camOn = () => f.evaluate(() => !!document.querySelector('video')?.srcObject?.getTracks().some((t) => t.readyState === 'live'));
  check('antes de ocultar: la cámara está encendida y el protocolo en marcha', (await camOn()));
  await page.click('#hide');
  await sleep(1500);
  check('el hub oculta orbicula: la cámara se apaga', !(await camOn()));
  check('el hub oculta orbicula: el protocolo se detiene (ya no está en marcha) y se puede volver a encender la cámara', (await f.evaluate(() => document.querySelector('#protocol')?.dataset.state)) !== 'active' && (await f.locator('#startCard').isVisible()));
  await page.click('#show');
  // Vuelve, y hace el protocolo completo
  await f.click('#startBtn');
  await f.waitForFunction(() => /análisis/.test(document.querySelector('#anaPill')?.textContent ?? ''), null, { timeout: 90000 });
  const resumeBtn = f.locator('#prResume');
  if (await resumeBtn.isVisible()) { /* sesión detenida: se empieza de nuevo */ }
  await f.evaluate(() => { document.getElementById('prDone')?.click?.(); });
  await f.click('#prStart').catch(() => {});
  if (!(await f.evaluate(() => document.querySelector('#protocol')?.dataset.state === 'active'))) {
    await f.click('#prAbort').catch(() => {});
    await f.click('#prStart').catch(() => {});
  }
  await f.waitForFunction(() => document.querySelector('#protocol')?.dataset.state === 'done', null, { timeout: 600000 });
  await page.waitForFunction(() => window.__hub.lastResult, null, { timeout: 20000 });

  const r1 = await page.evaluate(() => window.__hub.lastResult);
  const Ajv2020 = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
  const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  (addFormats.default ?? addFormats)(ajv);
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/orbicula-result.schema.json'), 'utf8'));
  const valid = ajv.validate(schema, r1.payload);
  fs.writeFileSync(path.join(out, 'resultado-recibido.json'), JSON.stringify(r1.payload));
  check('al terminar el protocolo, el hub recibe orbicula:result', r1.type === 'orbicula:result' && typeof r1.sessionId === 'string' && r1.payload.app === 'orbicula');
  check('el resultado recibido valida contra el esquema', valid, valid ? '' : JSON.stringify(ajv.errors?.slice(0, 3)));
  check('el resultado trae el código y la captura en directo', r1.payload.participantCode === 'P01' && r1.payload.capture.analysis === 'live', `${r1.payload.participantCode}/${r1.payload.capture.analysis}`);
  check('el estado en pantalla dice que se envió', /enviado al hub/i.test(await f.textContent('#prHubStatus')));

  // Corregir el código y reenviar: llega otro resultado con el mismo sessionId
  const before = (await page.evaluate(() => window.__hub.lines.filter((l) => /orbicula:result/.test(l)).length));
  await f.fill('#prExportCode', 'P02');
  await f.click('#prSendHub');
  await page.waitForFunction((n) => window.__hub.lines.filter((l) => /orbicula:result/.test(l)).length > n, before, { timeout: 10000 });
  const r2 = await page.evaluate(() => window.__hub.lastResult);
  check('«Enviar al hub» reenvía con el código corregido y el mismo sessionId', r2.payload.participantCode === 'P02' && r2.sessionId === r1.sessionId);
  await f.fill('#prExportCode', 'Juan Pérez');
  await f.click('#prSendHub');
  await sleep(500);
  const r3 = await page.evaluate(() => window.__hub.lastResult);
  check('un código que parece un nombre NO viaja al hub (se manda sin código)', r3.payload.participantCode === null);

  check('peticiones externas: ninguna', external.length === 0, JSON.stringify(external));
  check('errores de consola: ninguno', errors.length === 0, JSON.stringify(errors));
  await browser.close();
  server.close();
  for (const c of children) c.kill();
  console.log(failed ? `\n${failed} comprobaciones fallan` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); for (const c of children) c.kill(); process.exit(2); });
