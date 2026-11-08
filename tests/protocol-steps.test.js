import { describe, it, expect } from 'vitest';
import { protocolSteps, cleanSettings, PROTOCOL_DEFAULTS, PROTOCOL_OPTIONS } from '../src/protocol/steps.js';
import { GuidedSession, repSchedule, RETRY_PAUSE_MS } from '../src/assistant/session.js';
import { buildReport, describeSummary } from '../src/assistant/report.js';
import { PROTOCOL_PLAN } from '../src/assistant/steps.js';

describe('pasos del protocolo', () => {
  const steps = protocolSteps();

  it('son las seis fases de CLAUDE.md, en orden', () => {
    expect(steps.map((s) => s.id)).toEqual(['rest', 'natural', 'soft', 'forced', 'brows', 'smile']);
  });

  it('el reposo calibra y exige que sea válido; los demás no', () => {
    expect(steps[0]).toMatchObject({ calibrates: true, requireValid: true, durationMs: 30000 });
    expect(steps.slice(1).some((s) => s.calibrates || s.requireValid)).toBe(false);
  });

  it('los gestos tienen repeticiones con pitidos y la duración justa; el reposo y el parpadeo, no', () => {
    expect(steps[0].reps).toBeUndefined();
    expect(steps[1]).toMatchObject({ durationMs: 60000, countable: true });
    for (const s of steps.slice(2)) {
      expect(s.reps).toMatchObject({ count: 3, holdMs: 3000 });
      expect(s.durationMs).toBe(s.reps.offsetMs + s.reps.count * s.reps.everyMs);
      const sched = repSchedule(s.reps);
      expect(sched.filter((e) => e.kind === 'hold')).toHaveLength(3);
      expect(sched.at(-1).at).toBeLessThan(s.durationMs); // el último «suelta» cabe en el paso
    }
  });

  it('respeta la configuración y solo admite valores permitidos', () => {
    const s = protocolSteps({ restSec: 45, naturalSec: 90, reps: 5 });
    expect(s[0].durationMs).toBe(45000);
    expect(s[1].durationMs).toBe(90000);
    expect(s[2].reps.count).toBe(5);
    expect(s[2].say).toMatch(/Cinco veces/);
    expect(cleanSettings({ restSec: 7, naturalSec: 'x', reps: 99 })).toEqual(PROTOCOL_DEFAULTS);
    expect(cleanSettings({ restSec: '60' }).restSec).toBe(60);
    for (const key of Object.keys(PROTOCOL_OPTIONS)) expect(PROTOCOL_OPTIONS[key]).toContain(PROTOCOL_DEFAULTS[key]);
  });

  it('el plan del protocolo construye sus pasos y necesita el flujo', () => {
    expect(PROTOCOL_PLAN.flow).toBe(true);
    expect(PROTOCOL_PLAN.build({ reps: 4 })[3].reps.count).toBe(4);
  });

  it('los textos hablan de «tú» y la sonrisa recuerda lo de la asimetría', () => {
    for (const s of steps) expect(`${s.instruction} ${s.say}`).not.toMatch(/\busted\b|\bcierre usted\b/i);
    expect(steps.find((s) => s.id === 'smile').hint).toMatch(/diferencia entre los dos lados/);
  });
});

describe('reposo no válido en el protocolo', () => {
  const REST = [{ id: 'rest', title: 'R', instruction: '', durationMs: 2000, calibrates: true, requireValid: true }, { id: 'b', title: 'B', instruction: '', durationMs: 1000 }];
  const sample = (e) => ({ left: { ear: e }, right: { ear: e } });

  function setup(valid, extra = {}) {
    const clock = { t: 0 };
    const cues = [];
    const s = new GuidedSession(REST, {
      now: () => clock.t, prepMs: 100, onCue: (c) => cues.push(c),
      onStepEnd: (r) => { r.calibration = { valid: valid(), reason: 'la cabeza se ha movido', rise: { left: 0.02, right: 0.02 } }; },
      ...extra,
    });
    return { s, clock, cues };
  }
  const runRest = ({ s, clock }) => {
    clock.t += 100; s.tick(); // fin de la cuenta atrás
    s.record(clock.t, sample(0.3));
    clock.t += 2000; s.tick();
  };

  it('un reposo no válido queda «invalid», avisa y no se puede dar por bueno', () => {
    const x = setup(() => false);
    x.s.start();
    runRest(x);
    expect(x.s.state).toBe('review');
    expect(x.s.cur.status).toBe('invalid');
    expect(x.cues).toContain('invalid');
    expect(x.cues).not.toContain('end');
    x.s.next();
    expect(x.s.state).toBe('review'); // «Siguiente» no hace nada
    expect(x.s.results).toHaveLength(0);
    expect(describeSummary(x.s.cur)).toMatch(/Calibración NO válida: la cabeza se ha movido/);
  });

  it('en modo seguido se repite solo, con otro intento, y si ahora vale, sigue', () => {
    let ok = false;
    const x = setup(() => ok);
    x.s.autoAdvanceMs = 2000;
    x.s.start();
    runRest(x);
    expect(x.s.autoAdvancing).toBe(true);
    x.clock.t += RETRY_PAUSE_MS - 1; x.s.tick();
    expect(x.s.state).toBe('review');
    x.clock.t += 2; x.s.tick();
    expect(x.s.state).toBe('prep');
    expect(x.s.index).toBe(0);
    expect(x.s.cur.attempt).toBe(2);
    ok = true;
    runRest(x);
    expect(x.s.cur.status).toBe('completed');
    x.clock.t += 2000; x.s.tick();
    expect(x.s.index).toBe(1);
    expect(x.s.results).toHaveLength(1);
    expect(x.s.results[0]).toMatchObject({ id: 'rest', attempt: 2, status: 'completed' });
  });

  it('avisa al empezar cada paso, también al repetirlo (para quitar los umbrales de un intento anterior)', () => {
    const started = [];
    const x = setup(() => false, { onStepStart: (st) => started.push(st.id) });
    x.s.start();
    runRest(x);
    x.s.repeat();
    expect(started).toEqual(['rest', 'rest']);
  });

  it('sin modo seguido espera al usuario, que puede repetir', () => {
    const x = setup(() => false);
    x.s.start();
    runRest(x);
    x.clock.t += 60000; x.s.tick();
    expect(x.s.state).toBe('review');
    x.s.repeat();
    expect(x.s.state).toBe('prep');
  });

  it('un paso sin requireValid no se ve afectado por una calibración no válida (asistente de la fase 4)', () => {
    const clock = { t: 0 };
    const s = new GuidedSession([{ ...REST[0], requireValid: false }], { now: () => clock.t, prepMs: 100, onStepEnd: (r) => { r.calibration = { valid: false, reason: 'x', rise: {} }; } });
    s.start();
    runRest({ s, clock });
    expect(s.cur.status).toBe('completed');
  });

  it('el informe lleva la configuración y la serie de sonrisa', () => {
    const x = setup(() => true);
    x.s.start();
    runRest(x);
    x.s.next();
    const r = buildReport({ results: x.s.results, startedAt: 'x', plan: 'protocol', settings: { restSec: 30, naturalSec: 60, reps: 3 }, build: {}, device: {}, capture: {}, analysis: {}, detector: {} });
    expect(r.schema).toBe('orbicula-test-session/3');
    expect(r.plan).toBe('protocol');
    expect(r.settings).toEqual({ restSec: 30, naturalSec: 60, reps: 3 });
    expect(r.steps[0].series.left.smile).toBeDefined();
    expect(r.steps[0].calibration.valid).toBe(true);
  });
});
