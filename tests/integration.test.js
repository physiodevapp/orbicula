import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { allowedOrigins, originOf, DEFAULT_ORIGINS } from '../src/integration/origins.js';
import { parseConfig, buildReady, buildResult, MSG, HUB } from '../src/integration/messages.js';
import { createBridge } from '../src/integration/bridge.js';
import { SCHEMA_VERSION } from '../src/export/result.js';

const HUB_ORIGIN = 'https://physiodevapp.github.io';
const SELF = 'https://orbicula.example';
const allowed = allowedOrigins({ self: SELF });

/** Ventana de orbicula dentro de un iframe, con su padre simulado. */
function frames({ ancestors = [HUB_ORIGIN], referrer = '', standalone = false } = {}) {
  const posted = [];
  const listeners = [];
  const parent = { postMessage: (msg, target) => posted.push({ msg, target }) };
  // ancestors: null = navegador sin location.ancestorOrigins (Firefox, Safari)
  const win = { location: { ancestorOrigins: ancestors === null ? undefined : ancestors, origin: SELF }, document: { referrer }, addEventListener: (_t, f) => listeners.push(f) };
  win.parent = standalone ? win : parent;
  const deliver = (data, { origin = HUB_ORIGIN, source = parent } = {}) => listeners.forEach((f) => f({ data, origin, source }));
  return { win, parent, posted, deliver };
}
const bridgeOf = (f, handlers = {}) => createBridge({ win: f.win, allowed, appVersion: '0.1.0', handlers });

describe('orígenes permitidos', () => {
  it('el propio origen y el hub; los extras de la construcción, si son orígenes válidos', () => {
    expect([...allowed].sort()).toEqual([HUB_ORIGIN, SELF].sort());
    const withExtra = allowedOrigins({ self: SELF, extra: 'https://a.example, http://localhost:5173/ruta ,javascript:alert(1), no-es-url,,' });
    expect(withExtra.has('https://a.example')).toBe(true);
    expect(withExtra.has('http://localhost:5173')).toBe(true); // normalizado: sin ruta
    expect([...withExtra].some((o) => /javascript|no-es-url/.test(o))).toBe(false);
    expect(DEFAULT_ORIGINS).toEqual([HUB_ORIGIN]);
  });
  it('originOf solo admite http(s)', () => {
    expect(originOf('https://x.example/a/b?c#d')).toBe('https://x.example');
    for (const bad of ['', 'x', 'file:///a', 'data:text/html,a', 'javascript:1', null, undefined]) expect(originOf(bad)).toBeNull();
  });
});

describe('configuración del hub (orbicula:config)', () => {
  it('aplica lo válido', () => {
    expect(parseConfig({ theme: 'light', lang: 'es', protocol: { restSec: 45, naturalSec: 30, reps: 5 } })).toEqual({ applied: { theme: 'light', lang: 'es', protocol: { restSec: 45, naturalSec: 30, reps: 5 } }, rejected: [] });
    expect(parseConfig({ theme: 'auto' }).applied).toEqual({ theme: 'auto' });
    expect(parseConfig({ protocol: { reps: '4' } }).applied.protocol).toEqual({ reps: 4 }); // acepta números como texto
  });
  it('ignora cada valor malo con su motivo y aplica el resto', () => {
    const r = parseConfig({ theme: 'rosa', lang: 'en', protocol: { restSec: 31, naturalSec: 60, reps: null, otra: 1 }, extra: 1 });
    expect(r.applied).toEqual({ protocol: { naturalSec: 60 } });
    expect(r.rejected.map((x) => x.key).sort()).toEqual(['extra', 'lang', 'protocol.otra', 'protocol.reps', 'protocol.restSec', 'theme']);
    expect(r.rejected.find((x) => x.key === 'protocol.restSec').reason).toMatch(/30, 45, 60/);
  });
  it('lo que no es un objeto se rechaza entero', () => {
    for (const bad of [null, undefined, 'light', 5, [1], true]) expect(parseConfig(bad).rejected[0].key).toBe('payload');
    expect(parseConfig({ protocol: 'x' }).rejected[0].key).toBe('protocol');
  });
});

describe('mensajes salientes', () => {
  it('ready lleva la versión de la app y del esquema, y los permisos concedidos si se conocen', () => {
    expect(buildReady('0.1.0')).toEqual({ type: 'orbicula:ready', payload: { appVersion: '0.1.0', schemaVersion: SCHEMA_VERSION } });
    expect(buildReady('0.1.0', { camera: true, screenWakeLock: false }).payload.permissions).toEqual({ camera: true, screenWakeLock: false });
  });
  it('result lleva el JSON en payload y el sessionId fuera de él', () => {
    expect(buildResult({ app: 'orbicula' }, '2026-11-10T10:00:00.000Z')).toEqual({ type: 'orbicula:result', sessionId: '2026-11-10T10:00:00.000Z', payload: { app: 'orbicula' } });
    expect(buildResult({}).sessionId).toBeNull();
  });
});

describe('puente postMessage', () => {
  it('avisa con ready al origen del padre (nunca con «*»)', () => {
    const f = frames();
    bridgeOf(f).start();
    expect(f.posted).toEqual([{ msg: buildReady('0.1.0'), target: HUB_ORIGIN }]);
  });

  it('el resultado va solo al origen del padre, con su sessionId', () => {
    const f = frames();
    const b = bridgeOf(f);
    b.start();
    expect(b.sendResult({ app: 'orbicula', x: 1 }, 'S1')).toBe('sent');
    expect(f.posted.at(-1)).toEqual({ msg: { type: MSG.result, sessionId: 'S1', payload: { app: 'orbicula', x: 1 } }, target: HUB_ORIGIN });
    expect(f.posted.every((p) => p.target !== '*')).toBe(true);
  });

  it('el propio origen también vale (el hub copia orbicula en su mismo origen)', () => {
    const f = frames({ ancestors: [SELF] });
    const b = bridgeOf(f);
    b.start();
    expect(f.posted[0].target).toBe(SELF);
  });

  it('fuera de un iframe no manda ni escucha nada', () => {
    const f = frames({ standalone: true });
    const b = bridgeOf(f);
    b.start();
    expect(b.embedded).toBe(false);
    expect(b.sendResult({}, 'S')).toBe('standalone');
    expect(f.posted).toEqual([]);
  });

  it('con un padre que no está en la lista, no manda ni acepta NADA', () => {
    const f = frames({ ancestors: ['https://intruso.example'] });
    let config = 0;
    const b = bridgeOf(f, { config: () => config++ });
    b.start();
    expect(b.blocked).toBe(true);
    expect(b.sendResult({ secreto: 1 }, 'S')).toBe('blocked');
    f.deliver({ type: MSG.config, payload: { theme: 'light' } }, { origin: 'https://intruso.example' });
    f.deliver({ type: MSG.config, payload: { theme: 'light' } }, { origin: HUB_ORIGIN }); // aunque diga ser el hub
    expect(f.posted).toEqual([]);
    expect(config).toBe(0);
  });

  it('solo acepta mensajes del marco padre y de un origen permitido', () => {
    const f = frames();
    const got = [];
    bridgeOf(f, { config: (p) => got.push(p), hidden: () => got.push('hidden'), visible: () => got.push('visible') }).start();
    f.deliver({ type: MSG.config, payload: { theme: 'light' } }); // bueno
    f.deliver({ type: MSG.config, payload: { theme: 'dark' } }, { source: { otro: true } }); // otro marco
    f.deliver({ type: MSG.config, payload: { theme: 'dark' } }, { origin: 'https://intruso.example' }); // otro origen
    f.deliver({ type: MSG.config, payload: { theme: 'dark' } }, { origin: SELF }); // permitido, pero no es el padre
    f.deliver({ type: HUB.hidden });
    f.deliver({ type: HUB.visible });
    f.deliver('texto'); f.deliver(null); f.deliver({ sin: 'tipo' }); f.deliver({ type: 5 });
    f.deliver({ type: 'otra:cosa' });
    expect(got).toEqual([{ theme: 'light' }, 'hidden', 'visible']);
  });

  it('sin ancestorOrigins usa el referrer', () => {
    const f = frames({ ancestors: null, referrer: `${HUB_ORIGIN}/physiq/?sat=orbicula` });
    bridgeOf(f).start();
    expect(f.posted).toEqual([{ msg: buildReady('0.1.0'), target: HUB_ORIGIN }]);
  });

  it('un referrer de un origen no permitido no sirve: espera al primer mensaje válido', () => {
    const f = frames({ ancestors: null, referrer: 'https://intruso.example/x' });
    const b = bridgeOf(f);
    b.start();
    expect(f.posted).toEqual([]);
    expect(b.parentOrigin).toBeNull();
  });

  it('sin ancestorOrigins ni referrer: lo que se envía espera y sale, ya con destino, al primer mensaje válido', () => {
    const f = frames({ ancestors: null, referrer: '' });
    const b = bridgeOf(f);
    b.start();
    expect(b.sendResult({ n: 1 }, 'S1')).toBe('queued');
    expect(b.sendResult({ n: 2 }, 'S1')).toBe('queued'); // reemplaza al anterior con el mismo sessionId
    expect(f.posted).toEqual([]);
    f.deliver({ type: MSG.config, payload: {} }, { origin: 'https://intruso.example' }); // no vale
    expect(f.posted).toEqual([]);
    f.deliver({ type: MSG.config, payload: {} });
    expect(f.posted.map((p) => [p.msg.type, p.target])).toEqual([[MSG.ready, HUB_ORIGIN], [MSG.result, HUB_ORIGIN]]);
    expect(f.posted[1].msg.payload).toEqual({ n: 2 });
  });

  it('una vez conocido el origen del padre, otro origen permitido ya no vale', () => {
    const f = frames();
    const got = [];
    bridgeOf(f, { config: (p) => got.push(p) }).start();
    f.deliver({ type: MSG.config, payload: 1 }, { origin: SELF });
    expect(got).toEqual([]);
  });
});

describe('código de la integración', () => {
  const dir = new URL('../src/integration/', import.meta.url);
  const sources = readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => [n, readFileSync(new URL(n, dir), 'utf8')]);

  it('ningún postMessage usa «*» como destino', () => {
    for (const [name, src] of sources) expect(src, name).not.toMatch(/postMessage\([^)]*['"`]\*['"`]/);
    expect(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')).not.toMatch(/postMessage\([^)]*['"`]\*['"`]/);
  });

  it('ningún módulo de orbicula importa nada de PhysiQ', () => {
    const walk = (u) => readdirSync(u, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, u)) : [new URL(e.name, u)]));
    for (const f of walk(new URL('../src/', import.meta.url)).filter((u) => u.pathname.endsWith('.js'))) {
      expect(readFileSync(f, 'utf8'), f.pathname).not.toMatch(/from\s+['"][^'"]*physiq/i);
    }
  });
});
