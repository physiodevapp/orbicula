import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readVersion, isNewVersion, watchVersion, CHECK_EVERY_MS } from '../src/app/version.js';

describe('versión publicada', () => {
  it('lee solo lo que se espera (commit en texto, no vacío)', () => {
    expect(readVersion({ commit: 'abc1234', branch: 'main' })).toEqual({ commit: 'abc1234', branch: 'main' });
    expect(readVersion({ commit: 'abc1234' })).toEqual({ commit: 'abc1234', branch: null });
    for (const bad of [null, undefined, 'x', 5, [], {}, { commit: '' }, { commit: 5 }, { branch: 'main' }]) expect(readVersion(bad), JSON.stringify(bad)).toBeNull();
  });
  it('hay versión nueva solo si el commit publicado es otro; nunca en desarrollo', () => {
    expect(isNewVersion('abc1234', { commit: 'def5678' })).toBe(true);
    expect(isNewVersion('abc1234', { commit: 'abc1234' })).toBe(false);
    expect(isNewVersion('abc1234', null)).toBe(false);
    expect(isNewVersion('dev', { commit: 'def5678' })).toBe(false);
    expect(isNewVersion('', { commit: 'def5678' })).toBe(false);
  });
});

/** Documento y ventana simulados con sus oyentes. */
function env(visible = true) {
  const listeners = { doc: {}, win: {} };
  const reg = (box) => ({ addEventListener: (t, f) => (box[t] ??= []).push(f), removeEventListener: (t, f) => (box[t] = (box[t] ?? []).filter((x) => x !== f)) });
  const doc = { visibilityState: visible ? 'visible' : 'hidden', ...reg(listeners.doc) };
  const win = reg(listeners.win);
  const fire = (box, t) => (listeners[box][t] ?? []).forEach((f) => f());
  return { doc, win, listeners, fire };
}
const published = (commit) => vi.fn(async () => ({ ok: true, json: async () => ({ commit, branch: 'main' }) }));

describe('vigilar la versión', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pide la versión sin caché al abrir y avisa si es otra', async () => {
    const e = env();
    const fetchFn = published('def5678');
    const onNew = vi.fn();
    watchVersion({ current: 'abc1234', url: 'https://x.example/version.json', onNew, fetchFn, ...e });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledWith('https://x.example/version.json', { cache: 'no-store' });
    expect(onNew).toHaveBeenCalledWith({ commit: 'def5678', branch: 'main' });
  });

  it('no avisa si es la misma versión', async () => {
    const e = env();
    const onNew = vi.fn();
    watchVersion({ current: 'abc1234', url: 'u', onNew, fetchFn: published('abc1234'), ...e });
    await vi.advanceTimersByTimeAsync(0);
    expect(onNew).not.toHaveBeenCalled();
  });

  it('vuelve a mirar al volver a la app y cada 10 minutos, pero no avisa dos veces de lo mismo', async () => {
    const e = env();
    const fetchFn = published('def5678');
    const onNew = vi.fn();
    watchVersion({ current: 'abc1234', url: 'u', onNew, fetchFn, ...e });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    e.fire('doc', 'visibilitychange');
    e.fire('win', 'pageshow');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(onNew).toHaveBeenCalledTimes(1); // el mismo commit, un solo aviso
  });

  it('si se publica OTRA versión distinta después, avisa de nuevo', async () => {
    const e = env();
    let commit = 'def5678';
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ commit }) }));
    const onNew = vi.fn();
    watchVersion({ current: 'abc1234', url: 'u', onNew, fetchFn, ...e });
    await vi.advanceTimersByTimeAsync(0);
    commit = 'fff9999';
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(onNew.mock.calls.map((c) => c[0].commit)).toEqual(['def5678', 'fff9999']);
  });

  it('con la pestaña oculta no pide nada', async () => {
    const e = env(false);
    const fetchFn = published('def5678');
    watchVersion({ current: 'abc1234', url: 'u', onNew: vi.fn(), fetchFn, ...e });
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 2);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('un fallo no avisa de nada ni lanza: sin conexión, error del servidor, no es JSON, servidor de desarrollo', async () => {
    for (const fetchFn of [
      vi.fn(async () => { throw new TypeError('sin conexión'); }),
      vi.fn(async () => ({ ok: false, json: async () => ({ commit: 'def5678' }) })),
      vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('no es JSON'); } })),
      vi.fn(async () => ({ ok: true, json: async () => '<!doctype html>' })),
    ]) {
      const e = env();
      const onNew = vi.fn();
      watchVersion({ current: 'abc1234', url: 'u', onNew, fetchFn, ...e });
      await vi.advanceTimersByTimeAsync(0);
      expect(onNew).not.toHaveBeenCalled();
    }
  });

  it('stop() quita los oyentes y el reloj', async () => {
    const e = env();
    const fetchFn = published('def5678');
    const w = watchVersion({ current: 'abc1234', url: 'u', onNew: vi.fn(), fetchFn, ...e });
    await vi.advanceTimersByTimeAsync(0);
    w.stop();
    expect(e.listeners.doc.visibilitychange).toEqual([]);
    expect(e.listeners.win.pageshow).toEqual([]);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('publicación de version.json', () => {
  it('Cloudflare lo sirve sin caché', () => {
    expect(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')).toMatch(/\/version\.json\s*\n\s*Cache-Control: no-cache/);
  });
  it('la petición es al propio origen (sin dirección absoluta ni «*») y la CSP no se toca', () => {
    const src = readFileSync(new URL('../src/ui/update-notice.js', import.meta.url), 'utf8');
    expect(src).toMatch(/new URL\('version\.json', document\.baseURI\)/); // relativa: sirve en un subdirectorio
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    expect(headers).toMatch(/connect-src 'self';/);
  });
});
