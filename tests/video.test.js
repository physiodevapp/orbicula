import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { openMp4, rotationOf, frameStats, scanBoxes } from '../src/video/mp4.js';

/** Un archivo de los fixtures con la interfaz de File que usa el lector (size y slice). */
function fakeFile(name) {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let reads = 0;
  return {
    size: ab.byteLength,
    get reads() { return reads; },
    slice: (a, b) => ({ arrayBuffer: async () => { reads += Math.min(b, ab.byteLength) - a; return ab.slice(a, b); } }),
  };
}
const M = 65536;

describe('giro de la matriz de la pista', () => {
  it('móviles (horario 90°), 180°, antihorario y sin giro', () => {
    expect(rotationOf([0, M, 0, -M, 0, 0, 0, 0, 1 << 30])).toBe(90);
    expect(rotationOf([-M, 0, 0, 0, -M, 0, 0, 0, 1 << 30])).toBe(180);
    expect(rotationOf([0, -M, 0, M, 0, 0, 0, 0, 1 << 30])).toBe(270);
    expect(rotationOf([M, 0, 0, 0, M, 0, 0, 0, 1 << 30])).toBe(0);
    expect(rotationOf(null)).toBe(0);
  });
});

describe('ritmo a partir de los tiempos', () => {
  it('60 fps constantes', () => {
    const s = frameStats(Array.from({ length: 61 }, (_, i) => (i * 1000) / 60));
    expect(s.fps).toBeCloseTo(60, 1);
    expect(s.variable).toBe(false);
    expect(s.durationMs).toBe(1017);
  });
  it('variable: mitad a 60 fps y mitad a 30', () => {
    const t = [...Array.from({ length: 30 }, (_, i) => (i * 1000) / 60), ...Array.from({ length: 30 }, (_, i) => 500 + (i * 1000) / 30)];
    expect(frameStats(t).variable).toBe(true);
  });
  it('desordenados (fotogramas B): se ordenan antes', () => {
    expect(frameStats([0, 33.3, 16.7, 50]).fps).toBeCloseTo(60, 0);
  });
});

describe('lectura del MP4 (fixtures hechos con ffmpeg)', () => {
  it('índice al final, girado 90° en horario como los móviles: ficha, giro, tamaño mostrado y muestras', async () => {
    const f = fakeFile('rot-cw90-moov-end.mp4');
    const v = await openMp4(f);
    expect(v.container.moovAtEnd).toBe(true);
    expect(v.track).toMatchObject({ codec: expect.stringMatching(/^avc1\./), codedWidth: 32, codedHeight: 16, rotation: 90, width: 16, height: 32, samples: 12 });
    expect(v.timing.fps).toBeCloseTo(60, 0);
    expect(v.timing.variable).toBe(false);
    expect(v.samples[0].key).toBe(true);
    expect(Math.min(...v.samples.map((s) => s.t))).toBe(0);
    expect(v.decoderConfig.description.length).toBeGreaterThan(10); // avcC
    // Solo se lee el índice, no los fotogramas.
    expect(f.reads).toBeLessThan(f.size);
    const first = await v.read(v.samples[0]);
    expect(first.byteLength).toBe(v.samples[0].size);
  });

  it('lee el archivo por bloques: muchas muestras con una sola lectura, y los datos son los de cada muestra', async () => {
    const { chunkReader } = await import('../src/video/mp4.js');
    const f = fakeFile('moov-start.mp4');
    const v = await openMp4(f);
    const r = chunkReader(f, 1024);
    const direct = await Promise.all(v.samples.map(async (s) => new Uint8Array(await f.slice(s.offset, s.offset + s.size).arrayBuffer())));
    for (let i = 0; i < v.samples.length; i++) expect(await r.read(v.samples[i])).toEqual(direct[i]);
    expect(r.stats.reads).toBeLessThan(v.samples.length / 2);
  });

  it('si un bloque grande no se puede leer, sigue muestra a muestra y lo anota', async () => {
    const { chunkReader } = await import('../src/video/mp4.js');
    const f = fakeFile('moov-start.mp4');
    const v = await openMp4(f);
    const picky = { size: f.size, slice: (a, b) => (b - a > 1000 ? { arrayBuffer: async () => { throw Object.assign(new Error('no'), { name: 'NotReadableError' }); } } : f.slice(a, b)) };
    const r = chunkReader(picky, 1 << 20);
    for (const s of v.samples) expect((await r.read(s)).byteLength).toBe(s.size);
    expect(r.stats.fallbacks).toBe(1);
    expect(r.stats.chunkError).toBe('NotReadableError');
  });

  it('índice al principio (faststart): el mismo vídeo sin giro', async () => {
    const v = await openMp4(fakeFile('moov-start.mp4'));
    expect(v.container.moovAtEnd).toBe(false);
    expect(v.track).toMatchObject({ rotation: 0, width: 32, height: 16, samples: 12 });
  });

  it('fps variable: tiempos reales de cada fotograma', async () => {
    const v = await openMp4(fakeFile('vfr.mp4'));
    const t = v.samples.map((s) => s.t).sort((a, b) => a - b);
    expect(t[1] - t[0]).toBeCloseTo(1000 / 60, 0);
    expect(t.at(-1) - t.at(-2)).toBeCloseTo(2000 / 60, 0);
    expect(v.timing.variable).toBe(true);
  });

  it('un archivo que no es MP4 da un error claro', async () => {
    const junk = { size: 20, slice: (a, b) => ({ arrayBuffer: async () => new Uint8Array(20).buffer.slice(a, b) }) };
    await expect(scanBoxes(junk)).rejects.toThrow(/no es un MP4/);
  });
});

describe('decodificación fotograma a fotograma (decodificador simulado)', () => {
  /**
   * Decodificador falso que, como el de H.264 con fotogramas B, retiene `hold` muestras antes de dar el
   * primer fotograma, y que entrega en orden de presentación.
   */
  function installFakeDecoder(hold) {
    const made = [];
    globalThis.EncodedVideoChunk = class { constructor(o) { Object.assign(this, o); } };
    globalThis.VideoDecoder = class {
      constructor({ output }) { this.output = output; this.pending = []; this.state = 'unconfigured'; this.decodeQueueSize = 0; made.push(this); }
      addEventListener() {}
      configure() { this.state = 'configured'; }
      decode(chunk) {
        this.pending.push(chunk);
        this.decodeQueueSize = this.pending.length; // la cola no baja hasta que suelta fotogramas
        if (this.pending.length > hold) this.#emit(1);
      }
      #emit(n) {
        this.pending.sort((a, b) => a.timestamp - b.timestamp);
        for (const c of this.pending.splice(0, n)) {
          const frame = { timestamp: c.timestamp, closed: false, close() { this.closed = true; } };
          made.frames = [...(made.frames ?? []), frame];
          queueMicrotask(() => this.output(frame));
        }
        this.decodeQueueSize = this.pending.length;
      }
      async flush() { this.#emit(this.pending.length); await Promise.resolve(); }
      close() { this.state = 'closed'; }
    };
    return made;
  }

  // 30 muestras a 60 fps, en orden de decodificación con un fotograma B entre cada dos P.
  const mp4 = {
    decoderConfig: { codec: 'avc1.640015' },
    samples: Array.from({ length: 30 }, (_, i) => ({ t: (i * 1000) / 60, durationMs: 1000 / 60, key: i % 10 === 0, offset: 0, size: 1 })),
    read: async () => new Uint8Array(1),
  };

  it('no se bloquea aunque el decodificador retenga 8 muestras, y da todos los fotogramas en orden', async () => {
    const { decodeFrames } = await import('../src/video/decode.js');
    const made = installFakeDecoder(8);
    const ts = [];
    for await (const { frame, t } of decodeFrames(mp4, { maxAhead: 3 })) {
      ts.push(t);
      frame.close();
    }
    expect(ts).toHaveLength(30);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(made.frames.every((f) => f.closed)).toBe(true);
    expect(made[0].state).toBe('closed');
  });

  it('no se bloquea al final con un decodificador de hardware (pocos fotogramas sin devolver a la vez)', async () => {
    // Como MediaCodec en Android: solo puede tener `pool` fotogramas sin cerrar; con el cupo lleno no da
    // más, y flush() no termina hasta darlos todos. Esperar a flush() sin recoger fotogramas lo bloquea.
    const pool = 2;
    let open = 0;
    const pending = [];
    let flushWaiter = null;
    globalThis.EncodedVideoChunk = class { constructor(o) { Object.assign(this, o); } };
    globalThis.VideoDecoder = class {
      constructor({ output }) { this.output = output; this.state = 'configured'; this.decodeQueueSize = 0; this.flushing = false; }
      addEventListener() {}
      configure() {}
      pump() {
        const keep = this.flushing ? 0 : 3; // retiene 3 por los fotogramas B, salvo al vaciarse
        while (open < pool && pending.length > keep) {
          pending.sort((a, b) => a.timestamp - b.timestamp);
          const c = pending.shift();
          open++;
          const dec = this;
          this.output({ timestamp: c.timestamp, close() { open--; queueMicrotask(() => dec.pump()); } });
        }
        if (this.flushing && !pending.length && flushWaiter) { flushWaiter(); flushWaiter = null; }
      }
      decode(c) { pending.push(c); this.pump(); }
      flush() { this.flushing = true; return new Promise((r) => { flushWaiter = r; this.pump(); }); }
      close() { this.state = 'closed'; }
    };
    const { decodeFrames } = await import('../src/video/decode.js');
    let n = 0;
    const done = (async () => {
      for await (const { frame } of decodeFrames(mp4, { maxAhead: 3 })) {
        await new Promise((r) => setTimeout(r, 1)); // el consumidor tarda algo (girar, analizar)
        frame.close();
        n++;
      }
      return n;
    })();
    const res = await Promise.race([done, new Promise((r) => setTimeout(() => r('bloqueado'), 2000))]);
    expect(res).toBe(30);
  });

  it('para en toMs y cierra lo que quede sin recoger', async () => {
    const { decodeFrames } = await import('../src/video/decode.js');
    const made = installFakeDecoder(2);
    const ts = [];
    for await (const { frame, t } of decodeFrames(mp4, { toMs: 200 })) {
      ts.push(t);
      frame.close();
    }
    expect(Math.max(...ts)).toBeLessThanOrEqual(200);
    expect(ts.length).toBe(13); // 0 … 200 ms a 60 fps
    expect(made.frames.every((f) => f.closed)).toBe(true);
  });
});

describe('grabación de MediaRecorder (MP4 fragmentado)', () => {
  it('openRecording extrae todos los fotogramas con su tiempo, su tipo y los datos', async () => {
    const { openRecording } = await import('../src/video/mp4.js');
    const buf = readFileSync(new URL('./fixtures/frag.mp4', import.meta.url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    // En trozos pequeños, como si el archivo fuera enorme.
    const blob = { size: ab.byteLength, slice: (a, b) => ({ arrayBuffer: async () => ab.slice(a, b) }) };
    const v = await openRecording(blob);
    expect(v.container.fragmented).toBe(true);
    expect(v.samples).toHaveLength(24);
    expect(v.track).toMatchObject({ codec: expect.stringMatching(/^avc1\./), rotation: 0, width: 32, height: 16, keyframes: 2 });
    expect(v.samples[0]).toMatchObject({ t: 0, key: true });
    expect(v.timing.fps).toBeCloseTo(30, 0);
    expect(v.samples.every((s, i) => i === 0 || s.t > v.samples[i - 1].t)).toBe(true);
    expect((await v.read(v.samples[3])).byteLength).toBe(v.samples[3].size);
    expect(v.decoderConfig.description.length).toBeGreaterThan(10);
  });
});
