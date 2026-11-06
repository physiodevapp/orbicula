import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Workers Builds de Cloudflare expone la rama y el commit durante el build: se muestran
// en el pie para saber si la previsualización abierta es la última.
const commit = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ?? 'dev';
const branch = process.env.WORKERS_CI_BRANCH ?? 'local';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

export default defineConfig({
  // Rutas relativas: la misma build sirve en la raíz de Cloudflare y en un
  // subdirectorio (p. ej. /physiq/orbicula/ cuando la copie el hub).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __COMMIT__: JSON.stringify(commit),
    __BRANCH__: JSON.stringify(branch),
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
