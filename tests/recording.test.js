import { describe, it, expect, afterEach } from 'vitest';
import { FrameRecorder, recordingType, MAX_BYTES } from '../src/video/recorder.js';
import { protocolSteps } from '../src/protocol/steps.js';
import { protocolWindows, windowedSteps, createVideoSession } from '../src/video/offline.js';
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
    const blob = await r.stop();
    expect(blob.size).toBe(1500);
    expect(r.active).toBe(false);
    r.discard();
    expect(r.blob()).toBeNull();
    expect(r.bytes).toBe(0);
    expect(r.startedAt).toBeNull();
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
