import { describe, it, expect } from 'vitest';
import { BlinkDetector, percentile } from '../src/metrics/blinks.js';
import { Series } from '../src/metrics/series.js';
import { asymmetry } from '../src/metrics/asymmetry.js';
import { processResult, sampleOf } from '../src/landmarks/process.js';
import { makeFace } from './helpers/face.js';

// Generador de señal: reposo `base`, con parpadeos que bajan linealmente a `min` en `down` ms,
// se mantienen `hold` ms y suben en `up` ms. Con ese perfil la duración a media altura es
// down/2 + hold + up/2.
function signal({ seconds = 20, hz = 25, base = 0.3, blinks = [], noise = 0, jitter = 0, seed = 7, drift = 0 }) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
  const out = [];
  for (let t = 0; t <= seconds * 1000; t += 1000 / hz) {
    let v = base - (drift * t) / (seconds * 1000);
    for (const b of blinks) {
      const { t0, down = 60, hold = 50, up = 90, min = 0.12 } = b;
      const depth = v - min;
      if (t >= t0 && t < t0 + down) v -= (depth * (t - t0)) / down;
      else if (t >= t0 + down && t < t0 + down + hold) v = min;
      else if (t >= t0 + down + hold && t < t0 + down + hold + up) v = min + (depth * (t - t0 - down - hold)) / up;
    }
    out.push({ t: t + (jitter ? rnd() * jitter : 0), v: v + noise * rnd() });
  }
  return out;
}
const run = (det, samples) => samples.map((p) => det.push(p.t, p.v)).filter(Boolean);

describe('percentile', () => {
  it('interpola y ordena', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.9)).toBeCloseTo(9);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('BlinkDetector', () => {
  it('detecta un parpadeo y mide duración a media altura y completitud', () => {
    const det = new BlinkDetector();
    const events = run(det, signal({ blinks: [{ t0: 4000 }] }));
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('blink');
    expect(e.duration).toBeGreaterThan(110);
    expect(e.duration).toBeLessThan(140); // 125 ms teóricos
    expect(e.completeness).toBeCloseTo(0.6, 1); // (0,30 − 0,12) / 0,30
    expect(e.min).toBeCloseTo(0.12, 2);
    expect(e.baseline).toBeCloseTo(0.3, 2);
    expect(e.t).toBeGreaterThan(4050);
    expect(e.t).toBeLessThan(4150);
  });

  it('la duración no depende de la frecuencia de muestreo (24 o 50 análisis/s) ni del jitter', () => {
    for (const hz of [24, 50]) {
      const events = run(new BlinkDetector(), signal({ hz, jitter: 6, blinks: [{ t0: 4000 }] }));
      expect(events).toHaveLength(1);
      expect(Math.abs(events[0].duration - 125)).toBeLessThan(20);
    }
  });

  it('un cierre parcial da menor completitud', () => {
    const [e] = run(new BlinkDetector(), signal({ blinks: [{ t0: 4000, min: 0.2 }] }));
    expect(e.completeness).toBeCloseTo(1 / 3, 1);
  });

  it('detecta el parpadeo con ruido de medida', () => {
    const events = run(new BlinkDetector(), signal({ noise: 0.008, blinks: [{ t0: 4000 }, { t0: 9000 }] }));
    expect(events).toHaveLength(2);
  });

  it('no genera eventos con una señal quieta con ruido durante un minuto', () => {
    const det = new BlinkDetector();
    expect(run(det, signal({ seconds: 60, noise: 0.01 }))).toHaveLength(0);
    expect(det.stats(60000).count).toBe(0);
  });

  it('una deriva lenta de la apertura no cuenta como parpadeo', () => {
    expect(run(new BlinkDetector(), signal({ seconds: 30, drift: 0.06 }))).toHaveLength(0);
  });

  it('un parpadeo de un solo ojo se cuenta solo en ese lado', () => {
    const left = new BlinkDetector();
    const right = new BlinkDetector();
    const l = signal({ blinks: [{ t0: 4000 }] });
    const r = signal({});
    l.forEach((p, i) => {
      left.push(p.t, p.v);
      right.push(r[i].t, r[i].v);
    });
    expect(left.stats(20000).count).toBe(1);
    expect(right.stats(20000).count).toBe(0);
  });

  it('cuenta varios parpadeos y calcula la frecuencia por minuto solo con señal suficiente', () => {
    const det = new BlinkDetector();
    const s = signal({ seconds: 20, blinks: [{ t0: 4000 }, { t0: 10000 }, { t0: 15000 }] });
    s.filter((p) => p.t <= 8000).forEach((p) => det.push(p.t, p.v));
    expect(det.stats(8000).perMinute).toBeNull(); // menos de 10 s
    s.filter((p) => p.t > 8000).forEach((p) => det.push(p.t, p.v));
    const st = det.stats(20000);
    expect(st.count).toBe(3);
    expect(st.perMinute).toBeCloseTo(9, 5); // 3 en 20 s
    expect(st.last.t).toBeGreaterThan(15000);
  });

  it('un cierre largo es «cierre», no parpadeo, y no cuenta para la frecuencia', () => {
    const det = new BlinkDetector();
    const events = run(det, signal({ blinks: [{ t0: 4000, hold: 1500 }] }));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('closure');
    expect(det.stats(20000).count).toBe(0);
    expect(det.stats(20000).closures).toBe(1);
  });

  it('si se pierde la cara en mitad del cierre no se emite ningún evento', () => {
    const det = new BlinkDetector();
    const s = signal({ blinks: [{ t0: 4000, hold: 400 }] });
    const events = [];
    for (const p of s) {
      // La cara desaparece entre 4100 y 4600 ms, justo en mitad del cierre.
      const lost = p.t >= 4100 && p.t <= 4600;
      const e = det.push(p.t, lost ? NaN : p.v);
      if (e) events.push(e);
    }
    expect(events).toHaveLength(0);
  });

  it('un parpadeo en el primer segundo no se detecta (aún no hay reposo), salvo con línea base fija', () => {
    const s = signal({ seconds: 6, blinks: [{ t0: 500 }] });
    expect(run(new BlinkDetector(), s)).toHaveLength(0);
    expect(run(new BlinkDetector({ baseline: 0.3 }), s)).toHaveLength(1);
  });

  it('un cierre sostenido del ojo no arrastra el reposo: tras el cierre se detecta el siguiente parpadeo', () => {
    const det = new BlinkDetector();
    const events = run(det, signal({ seconds: 30, blinks: [{ t0: 4000, hold: 2000 }, { t0: 20000 }] }));
    expect(events.map((e) => e.kind)).toEqual(['closure', 'blink']);
  });

  it('reset borra eventos y reposo', () => {
    const det = new BlinkDetector();
    run(det, signal({ blinks: [{ t0: 4000 }] }));
    det.reset();
    expect(det.events).toHaveLength(0);
    expect(det.baseline).toBeNull();
  });
});

describe('asimetría', () => {
  it('(I − D) / (I + D)', () => {
    expect(asymmetry(3, 1)).toBeCloseTo(0.5);
    expect(asymmetry(1, 3)).toBeCloseTo(-0.5);
    expect(asymmetry(2, 2)).toBe(0);
    expect(asymmetry(0, 0)).toBeNull();
    expect(asymmetry(NaN, 1)).toBeNull();
  });
});

describe('Series', () => {
  it('guarda por lado, ignora NaN en las medias y recorta lo antiguo', () => {
    const s = new Series({ maxAgeMs: 1000 });
    for (let t = 0; t <= 5000; t += 100) {
      s.push(t, t === 4500 ? null : { left: { ear: 0.3, aperture: 0.2, blink: 0.1 }, right: { ear: 0.2, aperture: 0.2, blink: 0.1 } });
    }
    expect(s.t[0]).toBeGreaterThanOrEqual(5000 - 1000 * 1.25 - 100);
    expect(s.left.ear).toHaveLength(s.t.length);
    expect(s.mean('left', 'ear', 5000, 1000)).toBeCloseTo(0.3);
    expect(s.mean('right', 'ear', 5000, 1000)).toBeCloseTo(0.2);
    expect(Number.isNaN(s.left.ear[s.t.indexOf(4500)])).toBe(true);
    expect(s.mean('left', 'ear', 99999, 1000)).toBeNull();
  });
});

describe('de MediaPipe a muestras por lado', () => {
  const fake = (face, blend) => ({ faceLandmarks: [face], faceBlendshapes: [{ categories: blend }] });
  const frame = { width: 720, height: 1280 };

  it('sin cara no hay muestra', () => {
    const r = processResult({ faceLandmarks: [] }, frame);
    expect(r.face).toBe(false);
    expect(sampleOf(r)).toBeNull();
  });

  it('el ojo cerrado cae en el lado del paciente, con y sin espejo en la imagen analizada', () => {
    // Se cierra el ojo «right» del mallado (a la izquierda de la imagen sin espejo).
    const face = makeFace({ openRight: 0, openLeft: 1 });
    const blend = [
      { categoryName: 'eyeBlinkRight', score: 0.95 },
      { categoryName: 'eyeBlinkLeft', score: 0.02 },
    ];
    const plain = sampleOf(processResult(fake(face, blend), frame, { frameMirrored: false }));
    expect(plain.right.ear).toBeLessThan(0.05);
    expect(plain.left.ear).toBeGreaterThan(0.3);
    expect(plain.right.blink).toBe(0.95);

    const mirrored = sampleOf(processResult(fake(face, blend), frame, { frameMirrored: true }));
    expect(mirrored.left.ear).toBeLessThan(0.05);
    expect(mirrored.right.ear).toBeGreaterThan(0.3);
    expect(mirrored.left.blink).toBe(0.95);
  });

  it('de extremo a extremo: un parpadeo de un ojo suma en el detector del lado correcto', () => {
    const detectors = { left: new BlinkDetector(), right: new BlinkDetector() };
    const t0 = 4000;
    for (let t = 0; t <= 12000; t += 40) {
      const k = t >= t0 && t < t0 + 200 ? 0.1 : 1; // 200 ms con el ojo casi cerrado
      const sample = sampleOf(processResult(fake(makeFace({ openRight: k, openLeft: 1 }), []), frame, { frameMirrored: true }));
      detectors.left.push(t, sample.left.ear);
      detectors.right.push(t, sample.right.ear);
    }
    // Con la imagen en espejo, el ojo «right» del mallado es el izquierdo del paciente.
    expect(detectors.left.stats(12000).count).toBe(1);
    expect(detectors.right.stats(12000).count).toBe(0);
  });
});
