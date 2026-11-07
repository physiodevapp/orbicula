// Copia el WASM de MediaPipe a public/mediapipe/<versión>/ y OpenCV.js (con el WASM embebido)
// a public/opencv/<versión>/, para servirlos desde el propio sitio (sin CDN: funciona sin red y la
// CSP no abre ningún origen externo). OpenCV.js se parchea para que no necesite 'unsafe-eval'
// (ver scripts/opencv-patch.mjs).
// Se ejecuta solo antes de `npm run dev` y `npm run build` (predev / prebuild).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { patchOpenCv } from './opencv-patch.mjs';

const version = (name) => JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;

const mp = version('@mediapipe/tasks-vision');
const dir = `public/mediapipe/${mp}`;
mkdirSync(dir, { recursive: true });
for (const f of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  copyFileSync(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `${dir}/${f}`);
}
console.log(`WASM de MediaPipe ${mp} copiado a ${dir}`);

const cv = version('@techstark/opencv-js');
const cvDir = `public/opencv/${cv}`;
mkdirSync(cvDir, { recursive: true });
const src = readFileSync('node_modules/@techstark/opencv-js/dist/opencv.js', 'latin1');
writeFileSync(`${cvDir}/opencv.js`, patchOpenCv(src), 'latin1');
console.log(`OpenCV.js ${cv} (parcheado sin eval) copiado a ${cvDir}`);
