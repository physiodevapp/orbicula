import { describe, it, expect } from 'vitest';
import { InOrder } from '../src/landmarks/in-order.js';
import { AnalysisPool } from '../src/landmarks/pool.js';
import { processVideo, createVideoSession, videoSteps } from '../src/video/offline.js';

describe('entrega en orden', () => {
  it('retiene lo que llega antes de tiempo y lo entrega en orden', () => {
    const out = [];
    const q = new InOrder((v) => out.push(v));
    q.done(2, 'b'); q.done(3, 'c');
    expect(out).toEqual([]);
    expect(q.pending).toBe(2);
    q.done(1, 'a');
    expect(out).toEqual(['a', 'b', 'c']);
    expect(q.pending).toBe(0);
  });
  it('lo perdido (null) no se entrega, pero deja pasar a los siguientes', () => {
    const out = [];
    const q = new InOrder((v) => out.push(v));
    q.done(2, 'b'); q.done(1, null);
    expect(out).toEqual(['b']);
  });
  it('ignora repetidos, atrasados y números que no son enteros', () => {
    const out = [];
    const q = new InOrder((v) => out.push(v));
    q.done(1, 'a'); q.done(1, 'a2'); q.done(0, 'x'); q.done(2.5, 'y'); q.done(undefined, 'z'); q.done(null, 'w');
    expect(out).toEqual(['a']);
  });
  it('si un número no llega nunca (un análisis que no contesta), no atasca todo: se da por perdido', () => {
    const out = [];
    const q = new InOrder((v) => out.push(v), { maxWaiting: 3 });
    for (const t of [2, 3, 4]) q.done(t, t);
    expect(out).toEqual([]);
    q.done(5, 5); // ya son 4 retenidos: el 1 se da por perdido
    expect(out).toEqual([2, 3, 4, 5]);
    expect(q.skipped).toBe(1);
  });
});

/** Análisis simulado con la interfaz de WorkerAnalysis: tarda `ms` y devuelve el resultado (o lo pierde). */
function fakeWorker(name, ms, { lose = () => false } = {}) {
  return {
    name, delegate: name, ready: true, inflight: 0, capacity: 2, ms, frameMirrored: false, swapNames: false,
    analysed: [], onResult: null, onDrop: null,
    submit(frame, t, tag) {
      if (this.inflight >= this.capacity) return false;
      this.inflight++;
      this.analysed.push(t);
      setTimeout(() => {
        this.inflight--;
        if (lose(t)) this.onDrop?.(tag);
        else this.onResult?.({ t, tag, by: name });
      }, ms);
      return true;
    },
    async setImageMode(on) { this.image = on; },
    async setBlendshapes() {},
  };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('pool de análisis', () => {
  it('reparte entre los análisis y entrega en orden de envío aunque uno vaya más rápido', async () => {
    const fast = fakeWorker('GPU', 5);
    const slow = fakeWorker('CPU', 20);
    const pool = new AnalysisPool([fast, slow]);
    const got = [];
    pool.onResult = (m) => got.push(m);
    for (let i = 0; i < 4; i++) expect(pool.submit({}, i * 10)).toBe(true); // 2 y 2
    expect(pool.submit({}, 99)).toBe(false); // los dos llenos
    expect(pool.inflight).toBe(4);
    await wait(40);
    expect(got.map((m) => m.t)).toEqual([0, 10, 20, 30]);
    expect(new Set(got.map((m) => m.by))).toEqual(new Set(['GPU', 'CPU'])); // los dos trabajaron
    expect(pool.inflight).toBe(0);
  });

  it('manda al menos ocupado', () => {
    const a = fakeWorker('A', 50);
    const b = fakeWorker('B', 50);
    const pool = new AnalysisPool([a, b]);
    pool.submit({}, 0); pool.submit({}, 1); pool.submit({}, 2);
    expect([a.analysed.length, b.analysed.length].sort()).toEqual([1, 2]);
  });

  it('un fotograma perdido no atasca a los siguientes', async () => {
    const a = fakeWorker('A', 15, { lose: (t) => t === 0 });
    const b = fakeWorker('B', 2);
    const pool = new AnalysisPool([a, b]);
    const got = [];
    pool.onResult = (m) => got.push(m.t);
    pool.submit({}, 0); pool.submit({}, 1); pool.submit({}, 2);
    await wait(40);
    expect(got).toEqual([1, 2]);
  });

  it('propaga el espejo, el cambio de nombres y el modo IMAGE a todos; describe cada análisis', async () => {
    const a = fakeWorker('GPU', 1);
    const b = fakeWorker('CPU', 1);
    const pool = new AnalysisPool([a, b]);
    pool.frameMirrored = true;
    pool.swapNames = true;
    await pool.setImageMode(true);
    expect([a.frameMirrored, b.frameMirrored, a.swapNames, b.swapNames, a.image, b.image]).toEqual([true, true, true, true, true, true]);
    expect(pool.delegate).toBe('GPU + CPU');
    expect(pool.lanes).toBe(2);
    expect(pool.capacity).toBe(4);
    pool.submit({}, 0); pool.submit({}, 1);
    expect(pool.describe()).toMatchObject({ lanes: 2, workers: [{ delegate: 'GPU', frames: 1 }, { delegate: 'CPU', frames: 1 }], lostInOrder: 0 });
  });

  it('detach() deja de escuchar a los análisis', () => {
    const a = fakeWorker('A', 1);
    const pool = new AnalysisPool([a]);
    pool.detach();
    expect(a.onResult).toBeNull();
    expect(a.onDrop).toBeNull();
  });
});

describe('vídeo con dos análisis a la vez', () => {
  function decoder() {
    globalThis.EncodedVideoChunk = class { constructor(o) { Object.assign(this, o); } };
    globalThis.VideoDecoder = class {
      constructor({ output }) { this.output = output; this.state = 'configured'; this.decodeQueueSize = 0; }
      addEventListener() {}
      configure() {}
      decode(c) { queueMicrotask(() => this.output({ timestamp: c.timestamp, close() {} })); }
      async flush() {}
      close() { this.state = 'closed'; }
    };
  }
  const mp4Of = (n, fps) => ({
    decoderConfig: { codec: 'avc1' }, track: { rotation: 0 }, timing: { fps, durationMs: (n * 1000) / fps },
    samples: Array.from({ length: n }, (_, i) => ({ t: (i * 1000) / fps, durationMs: 1000 / fps, key: i === 0, offset: 0, size: 1 })),
    read: async () => new Uint8Array(1),
  });
  const flowOf = () => ({ inflight: 0, sent: [], submit(f, t) { this.inflight++; this.sent.push(t); setTimeout(() => { this.inflight--; }, 1); } });

  it('analiza todos los fotogramas, los dos análisis trabajan a la vez y los resultados salen en orden de tiempo', async () => {
    decoder();
    const gpu = fakeWorker('GPU', 6);
    const cpu = fakeWorker('CPU', 9);
    const pool = new AnalysisPool([gpu, cpu]);
    const emitted = [];
    let concurrent = 0;
    pool.onResult = (m) => emitted.push(m.t);
    const flow = flowOf();
    const origSubmit = pool.submit.bind(pool);
    pool.submit = (f, t) => { const ok = origSubmit(f, t); if (gpu.inflight > 0 && cpu.inflight > 0) concurrent++; return ok; };
    const mp4 = mp4Of(60, 30);
    const stats = await processVideo({ mp4, analysis: pool, flow, video: createVideoSession(videoSteps(mp4.timing.durationMs, 1)), pipeline: 2 });
    expect(stats.frames).toBe(60);
    expect(emitted).toHaveLength(60);
    expect(emitted).toEqual([...emitted].sort((a, b) => a - b)); // en orden
    expect(flow.sent).toHaveLength(60); // el flujo recibe todos
    expect(gpu.analysed.length).toBeGreaterThan(10);
    expect(cpu.analysed.length).toBeGreaterThan(10);
    expect(concurrent).toBeGreaterThan(0); // hubo momentos con los dos analizando a la vez
    expect(stats.face).toMatchObject({ lanes: 2 });
    expect(stats.face.workers.reduce((n, w) => n + w.frames, 0)).toBe(60);
    expect(pool.inflight).toBe(0);
  });

  it('ninguna muestra cae en el paso equivocado ni se pierde, aunque un análisis vaya lento', async () => {
    // El fallo que se vio en la nube: con el reloj avanzando al ENVIAR, las últimas muestras del reposo llegaban
    // cuando la sesión ya estaba en el tramo libre. Ahora el reloj avanza con los resultados, en orden.
    decoder();
    const pool = new AnalysisPool([fakeWorker('A', 3), fakeWorker('B', 25)]);
    const mp4 = mp4Of(60, 30); // 2 s; el reposo es el primer segundo
    const video = createVideoSession(videoSteps(mp4.timing.durationMs, 1));
    pool.onResult = (m) => video.recorder.record(m.t, { left: { ear: 0.3 }, right: { ear: 0.3 } }, {});
    await processVideo({ mp4, analysis: pool, flow: flowOf(), video, pipeline: 2 });
    const [rest, free] = video.session.results;
    const abs = (s) => s.rel.map((r) => s.t0 + r);
    expect(rest.id).toBe('rest');
    expect(abs(rest).every((t) => t < 1000)).toBe(true);
    expect(abs(free).every((t) => t >= 1000)).toBe(true);
    expect(rest.rel.length + free.rel.length).toBe(60); // ninguna perdida
    expect(rest.rel.length).toBe(30);
  });

  it('con un solo análisis (sin pool) el informe dice uno, como antes', async () => {
    decoder();
    const one = fakeWorker('GPU', 2);
    one.onResult = () => {};
    const mp4 = mp4Of(10, 30);
    const stats = await processVideo({ mp4, analysis: one, flow: flowOf(), video: createVideoSession(videoSteps(mp4.timing.durationMs, 1)), pipeline: 2 });
    expect(stats.face).toMatchObject({ lanes: 1, workers: [{ delegate: 'GPU', frames: 10 }] });
  });
});
