import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Workers Builds de Cloudflare expone la rama y el commit durante el build: se muestran
// en el pie para saber si la previsualización abierta es la última.
// El commit se lee de git (el clon de Workers Builds lo tiene): la variable de entorno
// no siempre trae el SHA (en producción llegó el nombre de la rama).
function gitCommit() {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}
const envSha = process.env.WORKERS_CI_COMMIT_SHA;
const commit = gitCommit() ?? (/^[0-9a-f]{7,40}$/i.test(envSha ?? '') ? envSha.slice(0, 7) : 'dev');
const branch = process.env.WORKERS_CI_BRANCH ?? 'local';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const mediapipe = JSON.parse(readFileSync('node_modules/@mediapipe/tasks-vision/package.json', 'utf8')).version;

// `version.json` con el commit de este build: la app lo vuelve a pedir (sin caché) para saber si ya hay una versión
// más nueva publicada (src/app/version.js). Es el mismo commit que muestra el pie.
const versionJson = {
  name: 'version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ commit, branch }) });
  },
};

export default defineConfig({
  plugins: [versionJson],
  // Rutas relativas: la misma build sirve en la raíz de Cloudflare y en un
  // subdirectorio (p. ej. /physiq/orbicula/ cuando la copie el hub).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __COMMIT__: JSON.stringify(commit),
    __BRANCH__: JSON.stringify(branch),
    __MEDIAPIPE_VERSION__: JSON.stringify(mediapipe),
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
