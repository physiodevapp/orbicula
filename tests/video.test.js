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
