import { describe, it, expect } from 'vitest';
import { assessPhase, neededReps } from '../src/protocol/phase-quality.js';
import { GuidedSession, RETRY_PAUSE_MS } from '../src/assistant/session.js';
import { summarizeProtocol, usableReps } from '../src/protocol/summary.js';

// Paso grabado: muestras cada 33 ms con la cara en `face(t)`; 3 repeticiones (hold 2000 + 7000k, release +3000).
const REPS = { count: 3, everyMs: 7000, holdMs: 3000, offsetMs: 2000 };
const marks = () => [0, 1, 2].flatMap((k) => [{ rep: k + 1, kind: 'hold', t: 2000 + 7000 * k }, { rep: k + 1, kind: 'release', t: 5000 + 7000 * k }]);
function recorded({ ms = 23000, face = () => true, reps = REPS } = {}) {
  const t = [];
  for (let x = 0; x < ms; x += 33) t.push(x);
  const ear = t.map((x) => (face(x) ? 0.3 : null));
  return { id: 'soft', status: 'completed', durationMs: ms, series: { t, left: { ear }, right: { ear: ear.slice() } }, marks: reps ? marks() : [], reps, events: { left: [], right: [] }, flow: {}, perf: { analysisFps: 28 } };
}
const lostIn = (a, b) => (x) => !(x >= a && x <= b);

describe('calidad de una fase', () => {
  it('cuántas repeticiones tienen que valer: 2 de 3, dos tercios de las demás, todas si son 1 o 2', () => {
    expect([1, 2, 3, 5, 6].map(neededReps)).toEqual([1, 2, 2, 4, 4]);
  });

  it('sin repeticiones: vale si la cara se vio el 90 % del tiempo', () => {
    expect(assessPhase(recorded({ reps: null })).ok).toBe(true);
    const bad = assessPhase(recorded({ reps: null, face: lostIn(4000, 7000) })); // 3 s de 23: se ve el 87 %
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('face-lost');
    expect(bad.text).toMatch(/87 %/);
  });

  it('con repeticiones: una repetición se descarta si la cara faltó en su ventana, y la fase vale con 2 de 3', () => {
    const q = assessPhase(recorded({ face: lostIn(2000, 6000) })); // se pierde en la repetición 1
    expect(q.reps.map((r) => r.ok)).toEqual([false, true, true]);
    expect(q.ok).toBe(true);
    expect(q.valid).toBe(2);
  });

  it('con repeticiones: sin 2 de 3 la fase no vale, aunque la cara se viera casi todo el tiempo', () => {
    const q = assessPhase(recorded({ face: (x) => !((x >= 2500 && x <= 4000) || (x >= 9500 && x <= 11000)) })); // 1,5 s en dos repeticiones
    expect(q.reps.map((r) => r.ok)).toEqual([false, false, true]);
    expect(q.ok).toBe(false);
    expect(q.text).toMatch(/2 de 3/);
    expect(q.face).toBeGreaterThan(0.85); // en la fase entera no llama la atención: por eso se mira por repetición
  });

  it('huecos cortos de la cara (menos del 10 % de la ventana) no cuentan', () => {
    expect(assessPhase(recorded({ face: lostIn(3000, 3300) })).ok).toBe(true);
  });
});

describe('repetir una fase en la que no se vio la cara', () => {
  const STEPS = [{ id: 'natural', title: 'Parpadeo', durationMs: 1000, prepMs: 0, retryOnFaceLoss: true }, { id: 'x', title: 'X', durationMs: 500, prepMs: 0 }];
  function make({ seguido = false } = {}) {
    let t = 0;
    const cues = [];
    const s = new GuidedSession(STEPS, { now: () => t, prepMs: 0, onCue: (c) => cues.push(c) });
    if (seguido) s.autoAdvanceMs = 2000;
    const at = (v) => { t = v; s.tick(); };
    // Graba el paso (1000 ms) con la cara o sin ella.
    const run = (start, withFace) => {
      s.state === 'prep' && at(start + 1);
      for (let x = 0; x < 1000; x += 33) { at(start + 1 + x); s.record(start + x, withFace ? { left: { ear: 0.3 }, right: { ear: 0.3 } } : null); }
      at(start + 1002);
    };
    return { s, cues, at, run };
  }

  it('el primer intento sin cara: se avisa («retry»), se anota el descarte y, sin modo seguido, se puede seguir o repetir', () => {
    const { s, cues, run } = make();
    s.start();
    run(0, false);
    expect(s.state).toBe('review');
    expect(cues.at(-1)).toBe('retry');
    expect(s.cur.status).toBe('completed'); // se puede dar por buena
    expect(s.cur.retry.code).toBe('face-lost');
    s.repeat();
    expect(s.rejections).toHaveLength(1);
    expect(s.rejections[0]).toMatchObject({ step: 'natural', attempt: 1 });
    expect(s.state).toBe('prep');
  });

  it('en modo seguido se repite sola pasada la pausa; el segundo intento no se repite más', () => {
    const { s, cues, at, run } = make({ seguido: true });
    s.start();
    run(0, false);
    expect(s.state).toBe('review');
    const t0 = 1002;
    at(t0 + RETRY_PAUSE_MS - 1);
    expect(s.state).toBe('review');
    at(t0 + RETRY_PAUSE_MS);
    expect(s.state).toBe('prep');
    expect(s.cur.attempt).toBe(2);
    run(t0 + RETRY_PAUSE_MS, false);
    expect(cues.filter((c) => c === 'retry')).toHaveLength(1); // el segundo fallo ya no pide repetir
    expect(s.cur.retry).toBeNull();
    expect(s.cur.phaseQuality.ok).toBe(false);
    expect(s.state).toBe('review');
  });

  it('la pausa de la repetición puede alargarla quien dice el aviso (retry.pauseMs)', () => {
    const { s, at, run } = make({ seguido: true });
    s.start();
    run(0, false);
    s.cur.retry.pauseMs = 12000; // lo que tarda la voz en decir el motivo
    at(1002 + RETRY_PAUSE_MS + 100);
    expect(s.state).toBe('review'); // con los 7 s de siempre ya habría repetido
    at(1002 + 12000);
    expect(s.state).toBe('prep');
  });

  it('un reposo no válido también puede esperar más (retryPauseMs)', () => {
    let t = 0;
    const steps = [{ id: 'rest', title: 'Reposo', durationMs: 1000, prepMs: 0, requireValid: true }];
    const s = new GuidedSession(steps, { now: () => t, prepMs: 0, onStepEnd: (r) => { r.calibration = { valid: false }; } });
    s.autoAdvanceMs = 2000;
    s.start();
    t = 1; s.tick();
    t = 1001; s.tick();
    expect(s.cur.status).toBe('invalid');
    s.cur.retryPauseMs = 11000;
    t = 1001 + RETRY_PAUSE_MS + 100; s.tick();
    expect(s.state).toBe('review');
    t = 1001 + 11000; s.tick();
    expect(s.state).toBe('prep');
  });

  it('con la cara a la vista no pasa nada', () => {
    const { s, cues, run } = make({ seguido: true });
    s.start();
    run(0, true);
    expect(cues.at(-1)).toBe('end');
    expect(s.cur.retry).toBeNull();
    expect(s.cur.phaseQuality.ok).toBe(true);
  });

  it('los pasos sin retryOnFaceLoss (el reposo, las pruebas sueltas) no se evalúan', () => {
    const { s, run } = make();
    s.steps[0].retryOnFaceLoss = false;
    s.start();
    run(0, false);
    expect(s.cur.phaseQuality).toBeNull();
    expect(s.cur.retry).toBeNull();
  });
});

describe('el resumen no cuenta las repeticiones sin cara', () => {
  const CAL = { valid: true, headStill: 0.1, ear: { left: { baseline: 0.3, noise: 0.007 }, right: { baseline: 0.3, noise: 0.007 } }, aperture: { left: { baseline: 0.3 }, right: { baseline: 0.3 } }, rise: { left: 0.03, right: 0.03 }, energy: { left: { brow: 0.1, canthus: 0.1 }, right: { brow: 0.1, canthus: 0.1 } } };
  // La repetición 1 se cierra a 0,1 pero sin cara (NaN no se guarda: la cara faltó); la 2 y la 3, a 0,03.
  function softStep(withLoss) {
    const s = recorded({ face: withLoss ? lostIn(2000, 6000) : () => true });
    const ear = (x) => (x >= 2500 && x <= 5000 ? 0.1 : x >= 9500 && x <= 12000 ? 0.03 : x >= 16500 && x <= 19000 ? 0.03 : 0.3);
    s.series.left.ear = s.series.t.map((x, i) => (s.series.left.ear[i] == null ? null : ear(x)));
    s.series.right.ear = s.series.left.ear.slice();
    return s;
  }
  const rest = { ...recorded({ reps: null, ms: 20000 }), id: 'rest', calibration: CAL };

  it('usableReps quita las repeticiones sin cara si quedan las necesarias', () => {
    expect(usableReps(softStep(true)).reps.map((r) => r.rep)).toEqual([2, 3]);
    expect(usableReps(softStep(false)).reps.map((r) => r.rep)).toEqual([1, 2, 3]);
  });

  it('el cierre del resumen sale de las repeticiones buenas y la nota lo dice', () => {
    const full = summarizeProtocol([rest, softStep(false)]).phases.soft;
    const dropped = summarizeProtocol([rest, softStep(true)]).phases.soft;
    expect(full.left.closure).toBeCloseTo((1 - 0.1 / 0.3 + 0.9 + 0.9) / 3, 2); // con la repetición 1 (0,67) baja la media
    expect(dropped.left.closure).toBeCloseTo(0.9, 2); // sin ella, las dos buenas
    expect(dropped.quality.noteCodes).toContain('reps-discarded');
    expect(dropped.quality.notes.join()).toMatch(/1 de 3 repeticiones descartada/);
    expect(full.quality.noteCodes).not.toContain('reps-discarded');
  });
});

describe('fase fiable con una repetición descartada', () => {
  const CAL = { valid: true, headStill: 0.1, ear: { left: { baseline: 0.3, noise: 0.007 }, right: { baseline: 0.3, noise: 0.007 } }, aperture: { left: { baseline: 0.3 }, right: { baseline: 0.3 } }, rise: { left: 0.03, right: 0.03 }, energy: { left: { brow: 0.1, canthus: 0.1 }, right: { brow: 0.1, canthus: 0.1 } } };
  const rest = { ...recorded({ reps: null, ms: 20000 }), id: 'rest', calibration: CAL };
  const q = (step) => summarizeProtocol([rest, step]).phases.soft.quality;

  it('si quedan las repeticiones necesarias, no es poco fiable ni dice «se ha perdido la cara»', () => {
    // La cara falta 4 s en la repetición 1 (el 83 % de la fase): antes salía «poco fiable».
    const r = q(recorded({ face: lostIn(2000, 6000) }));
    expect(r.face).toBeLessThan(0.9);
    expect(r.reliable).toBe(true);
    expect(r.noteCodes).toEqual(['reps-discarded']);
  });

  it('si no quedan las necesarias, sí lo es (face-lost)', () => {
    const r = q(recorded({ face: (x) => !((x >= 2500 && x <= 4000) || (x >= 9500 && x <= 11000)) }));
    expect(r.reliable).toBe(false);
    expect(r.noteCodes).toContain('face-lost');
    expect(r.noteCodes).not.toContain('reps-discarded');
  });

  it('una fase sin repeticiones sigue mirando la cara de toda la fase', () => {
    expect(summarizeProtocol([rest, { ...recorded({ reps: null, face: lostIn(4000, 7000) }), id: 'natural' }]).phases.natural.quality.noteCodes).toContain('face-lost');
  });
});
