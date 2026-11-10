import { describe, it, expect } from 'vitest';
import { fingerprintKey, fingerprintOf } from '../src/persistence/fingerprint.js';
import { createStore, memoryAdapter, MAX_ITEMS, TTL_DAYS, SCHEMA } from '../src/persistence/store.js';
import { buildPublicResult } from '../src/export/result.js';
import { provenance } from '../src/export/provenance.js';

const DAY = 86400000;
const results = [{ id: 'rest', status: 'completed', t0: 0, durationMs: 1000, plannedMs: 1000, perf: {}, events: { left: [], right: [] }, detections: [], marks: [], rel: [0, 33], series: { left: { ear: [0.3, 0.3] }, right: { ear: [0.3, 0.3] } }, flow: { rel: [], closure: { left: [], right: [] }, frozen: [], head: {} } }];
const capture = { source: 'live', analysis: 'live', camera: 'rear', fps: 30, width: 720, height: 1280, mirrored: false };
const rec = (id, o = {}) => ({ id, kind: 'protocol', appVersion: '0.1.0', build: 'abc1234', results, capture, flowConfig: 'farneback-320-vf-30', meta: { phases: 1, durationMs: 1000 }, ...o });

describe('huella del vídeo', () => {
  it('no depende del nombre del archivo: el mismo vídeo con otro nombre tiene la misma huella', () => {
    const mp4 = { track: { samples: 2040 }, timing: { durationMs: 68012.4 } };
    const a = fingerprintOf({ size: 91234567, name: 'VID_20261017_101500.mp4' }, mp4);
    const b = fingerprintOf({ size: 91234567, name: '1000012345.mp4' }, mp4);
    expect(a).toBe(b);
    expect(a).toBe('91234567:2040:68012');
  });
  it('cambia con el tamaño, los fotogramas o la duración', () => {
    const base = { size: 100, frames: 10, durationMs: 1000 };
    const k = fingerprintKey(base);
    for (const d of [{ size: 101 }, { frames: 11 }, { durationMs: 1001 }]) expect(fingerprintKey({ ...base, ...d })).not.toBe(k);
  });
  it('absorbe el ruido de coma flotante de la duración', () => {
    expect(fingerprintKey({ size: 1, frames: 1, durationMs: 68012.2 })).toBe(fingerprintKey({ size: 1, frames: 1, durationMs: 68011.8 }));
  });
});

describe('sesiones guardadas', () => {
  it('guarda y recupera los resultados sin pérdida, con la cabecera ligera aparte', async () => {
    const store = createStore(memoryAdapter());
    const h = await store.save(rec('protocol-1', { code: 'P01' }));
    expect(h).toMatchObject({ id: 'protocol-1', kind: 'protocol', code: 'P01', schema: SCHEMA, appVersion: '0.1.0', build: 'abc1234' });
    expect(h.meta.kb).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(h)).not.toContain('"series"'); // la cabecera no lleva los datos
    const loaded = await store.load('protocol-1');
    expect(loaded.data.results).toEqual(results);
    expect(loaded.data.capture).toEqual(capture);
    expect(loaded.data.flowConfig).toBe('farneback-320-vf-30');
    expect((await store.list()).map((x) => x.id)).toEqual(['protocol-1']);
  });

  it('el mismo id reemplaza (rehacer el último paso no duplica la sesión)', async () => {
    const store = createStore(memoryAdapter());
    await store.save(rec('protocol-1'));
    await store.save(rec('protocol-1', { code: 'P02' }));
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].code).toBe('P02');
  });

  it(`conserva solo las ${MAX_ITEMS} últimas y borra también sus datos`, async () => {
    let t = 1000;
    const adapter = memoryAdapter();
    const store = createStore(adapter, { now: () => (t += 10) });
    for (let i = 1; i <= MAX_ITEMS + 2; i++) await store.save(rec(`protocol-${i}`));
    const ids = (await store.list()).map((h) => h.id);
    expect(ids).toEqual(Array.from({ length: MAX_ITEMS }, (_, i) => `protocol-${MAX_ITEMS + 2 - i}`));
    expect(await store.load('protocol-1')).toBeNull();
    expect((await adapter.all('data')).map((d) => d.id).sort()).toEqual([...ids].sort());
  });

  it(`caduca a los ${TTL_DAYS} días`, async () => {
    let t = 0;
    const store = createStore(memoryAdapter(), { now: () => t });
    await store.save(rec('protocol-1'));
    t = (TTL_DAYS - 1) * DAY;
    expect(await store.list()).toHaveLength(1);
    t = TTL_DAYS * DAY + 1;
    expect(await store.list()).toHaveLength(0);
    expect(await store.load('protocol-1')).toBeNull();
  });

  it('encuentra el análisis de un vídeo por su huella y no confunde otro vídeo', async () => {
    const store = createStore(memoryAdapter());
    await store.save(rec('video-91:2040:68012', { kind: 'video', fingerprintKey: '91:2040:68012' }));
    expect((await store.find('91:2040:68012')).id).toBe('video-91:2040:68012');
    expect(await store.find('91:2040:68013')).toBeNull();
  });

  it('el código solo se guarda si es válido (nunca un nombre)', async () => {
    const store = createStore(memoryAdapter());
    expect((await store.save(rec('a', { code: 'Juan Pérez' }))).code).toBeNull();
    await store.save(rec('b'));
    expect(await store.patchCode('b', 'P07')).toBe(true);
    expect(await store.patchCode('b', 'Ana María')).toBe(false);
    expect((await store.list()).find((h) => h.id === 'b').code).toBe('P07');
    expect(await store.patchCode('b', '')).toBe(true);
    expect((await store.list()).find((h) => h.id === 'b').code).toBeNull();
  });

  it('borrar una sesión y borrar todo', async () => {
    const adapter = memoryAdapter();
    const store = createStore(adapter);
    await store.save(rec('a'));
    await store.save(rec('b'));
    await store.remove('a');
    expect((await store.list()).map((h) => h.id)).toEqual(['b']);
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(await adapter.all('data')).toEqual([]);
  });

  it('una sesión de una versión más nueva se lista (para borrarla) pero no se abre ni se encuentra', async () => {
    const adapter = memoryAdapter();
    const store = createStore(adapter);
    await store.save(rec('a', { fingerprintKey: 'k' }));
    await adapter.put('sessions', { ...(await adapter.get('sessions', 'a')), schema: SCHEMA + 1 });
    expect((await store.list())[0].readable).toBe(false);
    expect(await store.load('a')).toBeNull();
    expect(await store.find('k')).toBeNull();
    expect(await store.patchCode('a', 'P01')).toBe(false);
  });

  it('datos dañados: no se abre y no rompe la lista', async () => {
    const adapter = memoryAdapter();
    const store = createStore(adapter);
    await store.save(rec('a'));
    await adapter.put('data', { id: 'a', json: '{"results": [' });
    expect(await store.load('a')).toBeNull();
    expect(await store.list()).toHaveLength(1);
  });

  it('no guarda nombres de archivo, imágenes ni el modelo del dispositivo', async () => {
    const store = createStore(memoryAdapter());
    await store.save(rec('video-1', { kind: 'video', fingerprintKey: '1:2:3', extra: { settings: { restSec: 30 } } }));
    const json = JSON.stringify([await store.list(), await store.load('video-1')]);
    expect(json).not.toMatch(/\.mp4|data:image|userAgent|fileName/i);
  });
});

describe('exportar una sesión recuperada', () => {
  it('conserva la procedencia de cuando se analizó, aunque la app haya cambiado después', () => {
    const old = { ...provenance({ flowConfig: 'lite-320-vf' }), mediapipe: { version: '0.9.0', model: 'face_landmarker_old' }, detector: { riseMargin: 2 } };
    const doc = buildPublicResult({ results, capture, appVersion: '0.1.0', analysis: old });
    expect(doc.analysis.mediapipe).toEqual({ version: '0.9.0', model: 'face_landmarker_old' });
    expect(doc.analysis.detector).toEqual({ riseMargin: 2 });
    expect(doc.analysis.flow.config).toBe('lite-320-vf');
    expect(doc.analysis.summary).toEqual(provenance().summary); // el resumen se recalcula con la versión actual
    expect(buildPublicResult({ results, capture, appVersion: '0.1.0' }).analysis.mediapipe.model).toBe('face_landmarker_float16_1');
  });
});
