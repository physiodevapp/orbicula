import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { hostFrom, currentHost, HOSTS } from '../src/integration/host.js';

const early = readFileSync(new URL('../public/host.js', import.meta.url), 'utf8');

/** Ejecuta public/host.js con una dirección y devuelve el <html> simulado. */
function runEarly(search, dataset = {}) {
  const root = { dataset: { ...dataset } };
  vm.runInNewContext(early, { URLSearchParams, location: { search }, document: { documentElement: root } });
  return root.dataset;
}

describe('modo alojado', () => {
  it('?host=physiq activa el modo alojado; cualquier otra cosa, no', () => {
    expect(hostFrom('?host=physiq')).toBe('physiq');
    expect(hostFrom('?escala=0.2&host=physiq')).toBe('physiq');
    for (const q of ['', '?host=', '?host=otro', '?host=PHYSIQ', '?hosted=physiq', '?x=host=physiq']) expect(hostFrom(q)).toBeNull();
    expect(HOSTS).toEqual(['physiq']);
  });

  it('el script temprano (public/host.js) y el módulo deciden lo mismo en todas las direcciones', () => {
    for (const q of ['?host=physiq', '?escala=0.2&host=physiq', '', '?host=', '?host=otro', '?host=PHYSIQ', '?hosted=physiq']) {
      const d = runEarly(q);
      expect(d.host ?? null, q).toBe(hostFrom(q));
    }
  });

  it('en modo alojado fuerza el tema oscuro (el hub es solo oscuro) y respeta uno ya elegido', () => {
    expect(runEarly('?host=physiq')).toMatchObject({ host: 'physiq', theme: 'dark' });
    expect(runEarly('?host=physiq', { theme: 'light' })).toMatchObject({ host: 'physiq', theme: 'light' });
  });

  it('en modo autónomo no toca nada', () => {
    expect(runEarly('')).toEqual({});
    expect(runEarly('?host=otro')).toEqual({});
  });

  it('currentHost lee lo que dejó el script temprano', () => {
    expect(currentHost({ documentElement: { dataset: { host: 'physiq' } } })).toBe('physiq');
    expect(currentHost({ documentElement: { dataset: {} } })).toBeNull();
    expect(currentHost({ documentElement: { dataset: { host: 'otro' } } })).toBeNull();
  });

  it('los tokens del hub y la cabecera oculta están en el CSS', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
    expect(tokens).toMatch(/:root\[data-host='physiq'\]:not\(\[data-theme='light'\]\)\s*\{[^}]*--text: #e8edf2;[^}]*--text2: #8aa4bc;/);
    expect(app).toMatch(/:root\[data-host='physiq'\] \.app-header,\s*:root\[data-host='physiq'\] \.app-footer \{ display: none; \}/);
  });

  it('privacidad: el script temprano no hace ninguna llamada de red y la CSP lo permite (script-src \'self\')', () => {
    expect(early).not.toMatch(/fetch|XMLHttpRequest|WebSocket|sendBeacon|import\(|eval\(/);
    expect(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')).toMatch(/script-src 'self' 'wasm-unsafe-eval'/);
  });
});
