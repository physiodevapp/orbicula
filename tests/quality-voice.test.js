import { describe, it, expect } from 'vitest';
import { qualityVoice, gestureBusy, GESTURE_QUIET_MS, LOST_AFTER_MS, SMALL_AFTER_MS } from '../src/protocol/quality-voice.js';

const snap = (o = {}) => ({ state: 'running', index: 2, step: { calibrates: false }, rep: null, current: { attempt: 1 }, ...o });
const rest = snap({ index: 0, step: { calibrates: true } });
const holding = snap({ rep: { holding: true, sinceMs: 800 } });
const relaxing = snap({ rep: { holding: false, sinceMs: 600 } });
const pause = snap({ rep: { holding: false, sinceMs: GESTURE_QUIET_MS + 10 } });

describe('avisos de calidad por voz', () => {
  it('un gesto está en curso entre el «ahora» y el «suelta» y el segundo y medio siguiente', () => {
    expect(gestureBusy(null)).toBe(false);
    expect(gestureBusy({ holding: true, sinceMs: 100 })).toBe(true);
    expect(gestureBusy({ holding: false, sinceMs: GESTURE_QUIET_MS - 1 })).toBe(true);
    expect(gestureBusy({ holding: false, sinceMs: GESTURE_QUIET_MS })).toBe(false);
    expect(gestureBusy({ holding: false, sinceMs: null })).toBe(false);
  });

  it('cara perdida: en cualquier fase si lleva 1,5 s, pero no durante un gesto', () => {
    expect(qualityVoice('lost', snap(), LOST_AFTER_MS).speak).toBe(true);
    expect(qualityVoice('lost', rest, LOST_AFTER_MS).speak).toBe(true);
    expect(qualityVoice('lost', snap(), LOST_AFTER_MS - 1).speak).toBe(false);
    expect(qualityVoice('lost', holding, 5000).speak).toBe(false);
    expect(qualityVoice('lost', relaxing, 5000).speak).toBe(false);
    expect(qualityVoice('lost', pause, 5000).speak).toBe(true); // en la pausa tras la repetición, sí
  });

  it('cara pequeña en el reposo: como antes, sin esperar ni limitar', () => {
    expect(qualityVoice('small', rest, 0).speak).toBe(true);
    expect(qualityVoice('small', snap({ ...rest, state: 'prep' }), 0).speak).toBe(true);
  });

  it('cara pequeña en otra fase: a los 3 s, una sola vez por paso e intento y nunca en un gesto', () => {
    const warned = new Set();
    expect(qualityVoice('small', snap(), SMALL_AFTER_MS - 1, warned).speak).toBe(false);
    expect(qualityVoice('small', holding, SMALL_AFTER_MS, warned).speak).toBe(false);
    const d = qualityVoice('small', pause, SMALL_AFTER_MS, warned);
    expect(d.speak).toBe(true);
    warned.add(d.key);
    expect(qualityVoice('small', pause, 9000, warned).speak).toBe(false); // ya avisado en este paso
    expect(qualityVoice('small', snap({ index: 3 }), SMALL_AFTER_MS, warned).speak).toBe(true); // otro paso
    expect(qualityVoice('small', snap({ current: { attempt: 2 } }), SMALL_AFTER_MS, warned).speak).toBe(true); // repetido
  });

  it('no habla fuera de un paso en curso (revisión, hecho, sin empezar)', () => {
    for (const state of ['idle', 'review', 'done', 'aborted']) {
      expect(qualityVoice('lost', snap({ state }), 9000).speak).toBe(false);
      expect(qualityVoice('small', snap({ state }), 9000).speak).toBe(false);
    }
    expect(qualityVoice('otra', snap(), 9000).speak).toBe(false);
  });
});
