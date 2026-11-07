// Copia el WASM de MediaPipe a public/mediapipe/<versión>/ para servirlo desde el propio
// sitio (sin CDN: funciona sin red y la CSP no abre ningún origen externo).
// Se ejecuta solo antes de `npm run dev` y `npm run build` (predev / prebuild).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('node_modules/@mediapipe/tasks-vision/package.json', 'utf8'));
const dir = `public/mediapipe/${pkg.version}`;
mkdirSync(dir, { recursive: true });
for (const f of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  copyFileSync(`node_modules/@mediapipe/tasks-vision/wasm/${f}`, `${dir}/${f}`);
}
console.log(`WASM de MediaPipe ${pkg.version} copiado a ${dir}`);
