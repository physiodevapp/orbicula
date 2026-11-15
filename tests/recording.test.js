import { describe, it, expect, afterEach } from 'vitest';
import { FrameRecorder, recordingType, MAX_BYTES } from '../src/video/recorder.js';
import { protocolSteps } from '../src/protocol/steps.js';
import { protocolWindows, windowedSteps, createVideoSession, mediaClock, alignmentLag } from '../src/video/offline.js';
import { repSchedule } from '../src/assistant/session.js';

class FakeRecorder {
  static types = ['video/mp4;codecs=avc1'];
  static isTypeSupported(t) { return FakeRecorder.types.includes(t); }
  constructor(stream, opt) { this.stream = stream; this.mimeType = opt.mimeType; this.state = 'inactive'; FakeRecorder.last = this; this.listeners = {}; }
  start() { this.state = 'recording'; queueMicrotask(() => this.onstart?.()); }
  stop() { this.state = 'inactive'; this.listeners.stop?.forEach((f) => f()); this.onstop?.(); }
  addEventListener(n, f) { (this.listeners[n] ??= []).push(f); }
  emit(bytes) { this.ondataavailable?.({ data: { size: bytes } }); }
}
const saved = { MediaRecorder: globalThis.MediaRecorder, Blob: globalThis.Blob };
afterEach(() => { globalThis.MediaRecorder = saved.MediaRecorder; });

describe('grabador del vídeo del protocolo', () => {
  it('solo graba MP4: sin soporte, no se ofrece', () => {
    globalThis.MediaRecorder = class { static isTypeSupported() { return false; } };
    expect(recordingType()).toBeNull();
    globalThis.MediaRecorder = FakeRecorder;
    expect(recordingType()).toBe('video/mp4;codecs=avc1');
  });

  it('arranca, junta los trozos, para y entrega un Blob; discard lo borra todo', async () => {
    globalThis.MediaRecorder = FakeRecorder;
    const r = new FrameRecorder();
    await r.start({});
    expect(r.active).toBe(true);
    expect(r.startedAt).toBeGreaterThan(0);
    FakeRecorder.last.ondataavailable({ data: new Blob([new Uint8Array(1000)]) });
    FakeRecorder.last.ondataavailable({ data: new Blob([new Uint8Array(500)]) });
    expect(r.timeline.map((c) => c.bytes)).toEqual([1000, 1500]); // bytes acumulados al llegar cada trozo
    const blob = await r.stop();
    expect(blob.size).toBe(1500);
    expect(r.active).toBe(false);
    r.discard();
    expect(r.blob()).toBeNull();
    expect(r.bytes).toBe(0);
    expect(r.startedAt).toBeNull();
    expect(r.timeline).toEqual([]);
  });

  it('si la memoria pasa del tope, corta la grabación y lo avisa', async () => {
    globalThis.MediaRecorder = FakeRecorder;
    const r = new FrameRecorder();
    await r.start({});
    FakeRecorder.last.ondataavailable({ data: { size: MAX_BYTES + 1 } });
    expect(r.overflow).toBe(true);
    expect(FakeRecorder.last.state).toBe('inactive');
  });

  it('sin MP4 disponible, start falla con un mensaje claro', async () => {
    globalThis.MediaRecorder = class { static isTypeSupported() { return false; } };
    await expect(new FrameRecorder().start({})).rejects.toThrow(/MP4/);
  });
});

describe('el protocolo grabado se analiza en las mismas fases y marcas que en directo', () => {
  // «En directo»: los pasos reales con sus cuentas atrás, y los t0 (marca de la cámara) de cada uno.
  const live = protocolSteps({ restSec: 30, naturalSec: 30, reps: 3 });
  const recStart = 5000; // la grabación arrancó a los 5 s del reloj de la cámara
  // Cada paso empezó tras su cuenta atrás (7 s) y 2 s de pausa; el reposo se repitió una vez antes.
  let cam = recStart + 40000; // el primer intento (inválido) y su repetición pasaron antes
  const results = live.map((s) => {
    cam += 9000; // pausa + cuenta atrás
    const r = { id: s.id, status: 'completed', t0: cam + 40, plannedMs: s.durationMs };
    cam += s.durationMs;
    return r;
  });

  it('las ventanas van del primer fotograma de cada paso, en el tiempo del vídeo', () => {
    const w = protocolWindows(results, recStart);
    expect(w).toHaveLength(6);
    expect(w[0]).toEqual({ id: 'rest', runStart: 40000 + 9000 + 40, runEnd: 49040 + 30000 });
    expect(w[1].runStart - w[0].runEnd).toBe(9000); // pausa + cuenta atrás entre pasos
  });

  it('con esas ventanas, la sesión del vídeo da cada paso donde cayó y repite las marcas de las repeticiones', () => {
    const windows = protocolWindows(results, recStart);
    const steps = windowedSteps(live, windows);
    expect(steps[0].prepMs).toBe(windows[0].runStart);
    expect(steps[1].prepMs).toBe(0);
    expect(steps[0].pauseAfterMs).toBe(windows[1].runStart - windows[0].runEnd);
    expect(steps.at(-1).pauseAfterMs).toBeUndefined();
    expect(steps.every((s) => s.requireValid === false)).toBe(true);

    const v = createVideoSession(steps);
    v.session.start();
    const end = windows.at(-1).runEnd + 500;
    for (let t = windows[0].runStart - 500; t < end; t += 33) {
      v.advance(t);
      v.recorder.record(t, { left: { ear: 0.3 }, right: { ear: 0.3 } });
    }
    v.finish(end);
    expect(v.session.state).toBe('done');
    expect(v.session.results.map((r) => r.id)).toEqual(live.map((s) => s.id));
    v.session.results.forEach((r, i) => {
      // El primer fotograma del paso, en el reloj del vídeo, casi donde estuvo en directo: cada cambio de
      // paso se nota en el primer fotograma tras su hora, así que el desvío crece hasta ~1 fotograma por
      // paso (≈ 0,2 s tras seis pasos; nada frente a gestos de 3 s y ventanas de ±1 s).
      expect(Math.abs(r.t0 - windows[i].runStart)).toBeLessThanOrEqual(33 * (i + 2));
      expect(Math.abs(r.plannedMs - (windows[i].runEnd - windows[i].runStart))).toBeLessThanOrEqual(1);
    });
    // Las marcas de «ahora»/«suelta» de un gesto: las del calendario, relativas al inicio del paso.
    const soft = v.session.results.find((r) => r.id === 'soft');
    const plan = repSchedule(soft.reps);
    expect(soft.marks.filter((m) => m.kind === 'hold')).toHaveLength(3);
    soft.marks.forEach((m, i) => expect(Math.abs(m.t - plan[i].at)).toBeLessThanOrEqual(100));
  });
});

describe('deriva del reloj del vídeo grabado', () => {
  // Vídeo de 30 fps cuyo reloj avanza un 0,5 % más despacio que el de la sesión; un trozo por segundo de sesión,
  // que llega 80 ms después de su último fotograma. Cada fotograma ocupa 1000 bytes.
  const RATE = 0.995;
  const LAT = 80;
  const recStart = 5000;
  function fakeRecording(seconds, rate = RATE) {
    const samples = [];
    const timeline = [];
    let byte = 0;
    for (let k = 0; k * 33.333 < seconds * 1000; k++) {
      const wall = k * 33.333; // instante de captura (sesión, desde el arranque)
      samples.push({ byte, size: 1000, t: wall * rate, durationMs: 33.333 * rate, wall });
      byte += 1000;
    }
    for (let s = 1; s <= seconds; s++) {
      const bytes = samples.filter((x) => x.wall <= s * 1000 - 33.333).length * 1000;
      timeline.push({ at: recStart + s * 1000 + LAT, bytes });
    }
    return { samples, timeline };
  }

  it('corrige la deriva: un instante de la sesión cae en su tiempo del vídeo (error < 60 ms tras 4 min)', () => {
    const { samples, timeline } = fakeRecording(270);
    const clock = mediaClock(timeline, samples, recStart);
    expect(clock.method).toBe('chunks');
    expect(clock.driftMs).toBeGreaterThan(1000); // ~1,3 s en 4,5 min
    for (const w of [20000, 120000, 250000]) expect(Math.abs(clock.map(w) - w * RATE)).toBeLessThan(60);
    // Sin corregir, a los 250 s el error sería de 1,25 s.
    expect(Math.abs(250000 - 250000 * RATE)).toBeGreaterThan(1000);
  });

  it('con anchorMs, la corrección vale 0 en ese instante (el arranque del codificador no cuenta como deriva)', () => {
    const { samples, timeline } = fakeRecording(120);
    // Los tres primeros trozos llegan 400 ms antes (cola del codificador vacía al arrancar).
    const early = timeline.map((c, i) => (i < 3 ? { ...c, at: c.at - 400 } : c));
    const anchored = mediaClock(early, samples, recStart, { anchorMs: 16000 });
    expect(Math.abs(anchored.map(16000) - 16000)).toBeLessThan(5);
    // Desde ahí corrige solo la deriva del reloj: a los 100 s, lo que se ha quedado atrás desde los 16 s.
    expect(Math.abs(anchored.map(100000) - (100000 - (100000 - 16000) * (1 - RATE)))).toBeLessThan(60);
    expect(anchored.curve.length).toBeGreaterThan(5);
  });

  it('sin deriva, no mueve nada', () => {
    const { samples, timeline } = fakeRecording(60, 1);
    const clock = mediaClock(timeline, samples, recStart);
    for (const w of [1000, 30000, 59000]) expect(Math.abs(clock.map(w) - w)).toBeLessThan(5);
  });

  it('sin tiempos de los trozos o con algo que no cuadra, deja el reloj como estaba', () => {
    const { samples, timeline } = fakeRecording(60);
    expect(mediaClock([], samples, recStart).method).toBe('identity');
    expect(mediaClock(timeline, samples.map(({ byte, ...x }) => x), recStart).method).toBe('identity');
    const absurd = fakeRecording(60, 0.8);
    expect(mediaClock(absurd.timeline, absurd.samples, recStart).method).toBe('identity');
    expect(mediaClock(timeline, samples, recStart).map(1234)).not.toBe(NaN);
  });

  it('protocolWindows usa el reloj corregido', () => {
    const results = [{ id: 'rest', status: 'completed', t0: recStart + 100000, plannedMs: 30000 }];
    const [w] = protocolWindows(results, recStart, (ms) => ms * RATE);
    expect(w.runStart).toBeCloseTo(100000 * RATE, 3);
    expect(w.runEnd).toBeCloseTo(130000 * RATE, 3);
  });

  it('alignmentLag mide el desfase que queda entre el EAR del directo y el del vídeo', () => {
    const t = Array.from({ length: 900 }, (_, i) => i * 33);
    const ear = (x) => (Math.floor(x / 3000) % 2 ? 0.1 : 0.3) + 0.01 * Math.sin(x / 170);
    const step = (shift) => ({ series: { t, left: { ear: t.map((x) => ear(x - shift)) }, right: { ear: t.map((x) => ear(x - shift)) } } });
    expect(Math.abs(alignmentLag(step(0), step(400)).lagMs - 400)).toBeLessThanOrEqual(20); // en el vídeo pasa 0,4 s más tarde
    expect(Math.abs(alignmentLag(step(0), step(-700)).lagMs + 700)).toBeLessThanOrEqual(20);
    expect(alignmentLag(step(0), step(0)).r).toBeGreaterThan(0.99);
    // Sin nada que correlacionar (EAR plano con ruido), no se da desfase.
    const flat = (seed) => ({ series: { t, left: { ear: t.map((x, i) => 0.3 + 0.001 * Math.sin(i * seed)) }, right: { ear: t.map(() => 0.3) } } });
    expect(alignmentLag(flat(1.3), flat(2.7))?.lagMs ?? null).toBeNull();
  });
});
