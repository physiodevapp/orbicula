import { describe, it, expect } from 'vitest';
import { videoSteps, createVideoSession, processVideo } from '../src/video/offline.js';

describe('tramos del análisis libre de un vídeo', () => {
  it('reposo de 30 s que calibra y el resto del vídeo', () => {
    const s = videoSteps(95000, 30);
    expect(s.map((x) => [x.id, x.durationMs, !!x.calibrates])).toEqual([['rest', 30000, true], ['free', 65000, false]]);
  });
  it('un vídeo más corto que el reposo: el reposo se acorta y queda un segundo de resto', () => {
    const s = videoSteps(20000, 30);
    expect(s[0].durationMs).toBe(19000);
    expect(s[1].durationMs).toBe(1000);
  });
});

describe('sesión con el reloj del vídeo', () => {
  it('pasa del reposo al resto según el tiempo de los fotogramas, calibra al acabar el reposo y registra en cada tramo', () => {
    const ended = [];
    const v = createVideoSession(videoSteps(10000, 4), { onStepEnd: (r, step) => { ended.push(step.id); r.calibration = { valid: true }; } });
    v.session.start();
    for (let t = 0; t < 10000; t += 100) {
      v.advance(t);
      v.recorder.record(t, { left: { ear: 0.3 }, right: { ear: 0.3 } });
      v.recorder.recordFlow({ t, dt: 100, left: {}, right: {}, head: {}, closure: { left: 0, right: 0 }, closureFrozen: false });
    }
    v.finish(10000);
    expect(v.session.state).toBe('done');
    expect(ended).toEqual(['rest', 'free']);
    const [rest, free] = v.session.results;
    expect(rest.id).toBe('rest');
    expect(rest.calibration.valid).toBe(true);
    expect(rest.rel.length).toBeGreaterThanOrEqual(39);
    expect(rest.rel.at(-1)).toBeLessThan(4000);
    expect(free.rel.length).toBeGreaterThanOrEqual(58); // pierde como mucho un fotograma en el cambio de tramo
    expect(rest.rel.length + free.rel.length).toBeGreaterThanOrEqual(99);
  });
});

describe('procesado fotograma a fotograma (decodificador y análisis simulados)', () => {
  function setup(n, fps) {
    globalThis.EncodedVideoChunk = class { constructor(o) { Object.assign(this, o); } };
    globalThis.VideoDecoder = class {
      constructor({ output }) { this.output = output; this.state = 'configured'; this.decodeQueueSize = 0; }
      addEventListener() {}
      configure() {}
      decode(c) { queueMicrotask(() => this.output({ timestamp: c.timestamp, close() {} })); }
      async flush() {}
      close() { this.state = 'closed'; }
    };
    const mp4 = {
      decoderConfig: { codec: 'avc1' },
      track: { rotation: 0 },
      timing: { fps, durationMs: (n * 1000) / fps },
      samples: Array.from({ length: n }, (_, i) => ({ t: (i * 1000) / fps, durationMs: 1000 / fps, key: i === 0, offset: 0, size: 1 })),
      read: async () => new Uint8Array(1),
    };
    // Análisis y flujo que tardan un poco y avisan con inflight, como los workers.
    const seen = { analysis: [], flow: [], maxInflight: 0 };
    const worker = (name) => ({
      inflight: 0,
      submit(frame, t) {
        this.inflight++;
        seen.maxInflight = Math.max(seen.maxInflight, analysis.inflight + flow.inflight);
        seen[name].push(t);
        // Como los workers: devuelve el resultado con su tiempo (el reloj de la sesión avanza con ellos).
        setTimeout(() => { this.inflight--; this.onResult?.({ t }); }, 2);
      },
    });
    const analysis = worker('analysis');
    const flow = worker('flow');
    return { mp4, analysis, flow, seen };
  }

  it('manda todos los fotogramas, de uno en uno, con su tiempo del vídeo', async () => {
    const { mp4, analysis, flow, seen } = setup(60, 30);
    const video = createVideoSession(videoSteps(mp4.timing.durationMs, 1));
    const stats = await processVideo({ mp4, analysis, flow, video, pipeline: 1 });
    expect(stats.frames).toBe(60);
    expect(seen.analysis).toHaveLength(60);
    expect(seen.flow).toEqual(seen.analysis);
    expect(seen.maxInflight).toBeLessThanOrEqual(2); // un fotograma a la vez (análisis + flujo)
    expect(seen.analysis[1] - seen.analysis[0]).toBeCloseTo(1000 / 30, 3);
    expect(video.session.state).toBe('done');
  });

  it('con el tope de 30 fotogramas/s, un vídeo a 60 fps se procesa uno de cada dos', async () => {
    const { mp4, analysis, flow, seen } = setup(60, 60);
    const progress = [];
    const stats = await processVideo({ mp4, analysis, flow, video: createVideoSession(videoSteps(1000, 1)), maxFps: 30, onProgress: (p) => progress.push(p) });
    expect(stats.every).toBe(2);
    expect(stats.frames).toBe(30);
    expect(seen.analysis[1] - seen.analysis[0]).toBeCloseTo(2000 / 60, 3);
    expect(progress.at(-1)).toMatchObject({ done: 30, total: 30 });
  });

  it('con pipeline 2, los workers admiten un fotograma más en vuelo; con 1 va de uno en uno; y se espera al final', async () => {
    const a = setup(30, 30);
    const s2 = await processVideo({ mp4: a.mp4, analysis: a.analysis, flow: a.flow, video: createVideoSession(videoSteps(1000, 1)), pipeline: 2 });
    expect(s2.pipeline).toBe(2);
    expect(a.seen.maxInflight).toBeGreaterThan(2); // análisis + flujo, con dos fotogramas en vuelo
    expect(a.analysis.inflight + a.flow.inflight).toBe(0); // todo recogido al terminar
    expect(s2.msPerFrame).toBeGreaterThan(0);
    const b = setup(30, 30);
    const s1 = await processVideo({ mp4: b.mp4, analysis: b.analysis, flow: b.flow, video: createVideoSession(videoSteps(1000, 1)), pipeline: 1 });
    expect(s1.pipeline).toBe(1);
    expect(b.seen.maxInflight).toBeLessThanOrEqual(2);
  });

  it('`every` manda sobre maxFps: a ~34 fps, «como mucho 30» no salta nada pero uno de cada dos sí', async () => {
    const a = setup(40, 34);
    const sA = await processVideo({ mp4: a.mp4, analysis: a.analysis, flow: a.flow, video: createVideoSession(videoSteps(1000, 1)), maxFps: 30 });
    expect(sA.every).toBe(1);
    const b = setup(40, 34);
    const sB = await processVideo({ mp4: b.mp4, analysis: b.analysis, flow: b.flow, video: createVideoSession(videoSteps(1000, 1)), every: 2 });
    expect(sB.every).toBe(2);
    expect(sB.frames).toBe(20);
  });

  it('se puede cancelar', async () => {
    const { mp4, analysis, flow } = setup(300, 30);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    await expect(processVideo({ mp4, analysis, flow, video: createVideoSession(videoSteps(10000, 1)), signal: ac.signal })).rejects.toThrow(/cancelado/);
  });
});
