// Carga MP4 en la tarjeta «Vídeo grabado» (fase 6) con Chromium, sin cámara, prueba la lectura y
// resume la ficha, el ritmo y los cuadrantes de la miniatura (para comprobar el giro). Ver docs/desarrollo.md.
//   node scripts/dev/check-video.cjs a.mp4 [b.mp4 …] salida.json
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 380, height: 900 }, acceptDownloads: true })).newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  p.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  await p.goto('http://127.0.0.1:4173/');
  for (const f of process.argv.slice(2, -1)) {
    await p.setInputFiles('#vidFile', f);
    await p.waitForFunction(() => !/Leyendo/.test(document.querySelector('#vidInfo').textContent) && document.querySelector('#vidInfo').textContent.length > 0, null, { timeout: 15000 });
    console.log('==', f.split('/').pop(), '\n' + (await p.textContent('#vidInfo')));
    if (!(await p.isDisabled('#vidProbe'))) {
      await p.click('#vidProbe');
      await p.waitForFunction(() => !/Decodificando/.test(document.querySelector('#vidResult').textContent), null, { timeout: 60000 });
      console.log(await p.textContent('#vidResult'));
      // cuadrantes de la miniatura (brillo medio)
      const q = await p.evaluate(() => {
        const c = document.querySelector('#vidThumb'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        const m = [0, 0, 0, 0], n = [0, 0, 0, 0];
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const k = (y < c.height / 2 ? 0 : 2) + (x < c.width / 2 ? 0 : 1); const i = (y * c.width + x) * 4; m[k] += d.data[i] + d.data[i + 1] + d.data[i + 2]; n[k]++; }
        return { w: c.width, h: c.height, q: m.map((v, k) => Math.round(v / n[k] / 3)) };
      });
      console.log('miniatura', JSON.stringify(q));
    }
  }
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#vidDownload')]);
  await dl.saveAs(process.argv.at(-1));
  console.log('errores', errors);
  await b.close();
})();
