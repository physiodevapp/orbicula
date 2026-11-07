import { describe, it, expect } from 'vitest';
import { RiseTracker, calibrate, EventDetector, EVENT_DEFAULTS } from '../src/protocol/events.js';
import { percentile } from '../src/metrics/blinks.js';

/** Generador pseudoaleatorio reproducible. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
/** Instantes a ~30 pares/s con algo de irregularidad, como el flujo real. */
function times(ms, rand = rng(7)) {
  const t = [];
  for (let x = 1000; x < 1000 + ms; x += 28 + rand() * 12) t.push(Math.round(x));
  return t;
}
const median = (a) => percentile(a, 0.5);

/**
 * Paso del asistente sintético, con la forma del JSON: cierre por flujo de cada ojo, movimiento de la
 * cabeza y energías. `closure(t, side)` y `head(t)` dan la señal.
 */
function fakeStep(ms, { closure = () => 0, head = () => 0.02, events = { left: [], right: [] }, brow = () => 0.05 } = {}) {
  const t = times(ms);
  const rel = t.map((x) => x - t[0]);
  const flowSide = (side) => ({ brow: { eR: t.map((x) => brow(x, side) ** 2) }, canthus: { eR: t.map(() => 0.05 ** 2) } });
  return {
    series: { t: rel, left: { ear: rel.map(() => 0.3), aperture: rel.map(() => 0.1) }, right: { ear: rel.map(() => 0.3), aperture: rel.map(() => 0.1) } },
    events,
    flow: {
      t: rel,
      dt: rel.map(() => 33),
      closure: { left: rel.map((x) => closure(x, 'left')), right: rel.map((x) => closure(x, 'right')) },
      head: { rU: rel.map((x) => head(x)), rV: rel.map(() => 0) },
      left: flowSide('left'),
      right: flowSide('right'),
    },
  };
}

/** Pasa un paso sintético por el detector, como haría la app en directo. */
function run(det, step) {
  const f = step.flow;
  const out = [];
  f.t.forEach((t, i) => out.push(...det.pushFlow({
    t,
    closure: { left: f.closure.left[i], right: f.closure.right[i] },
    headSpeed: Math.hypot(f.head.rU[i], f.head.rV[i]),
    energy: Object.fromEntries(['left', 'right'].map((s) => [s, { brow: Math.sqrt(f[s].brow.eR[i]), canthus: Math.sqrt(f[s].canthus.eR[i]) }])),
  })));
  out.push(...det.flush());
  return out;
}

describe('subida del cierre (RiseTracker)', () => {
  const rand = rng(3);
  const t = times(20000);
  let acc = 0;
  const v = t.map(() => (acc += (rand() - 0.5) * 0.004));

  it('es el valor menos el mínimo de las medianas de 0,6 s de los últimos 1,5 s', () => {
    const tr = new RiseTracker();
    const got = t.map((x, i) => tr.push(x, v[i]));
    for (let i = 0; i < t.length; i += 7) {
      const hs = t.filter((h) => h >= t[0] + 600 && h >= t[i] - 1500 && h <= t[i]);
      if (!hs.length) {
        expect(got[i]).toBeNaN();
        continue;
      }
      const meds = hs.map((h) => median(v.filter((_, j) => t[j] >= h - 600 && t[j] <= h)));
      expect(got[i]).toBeCloseTo(v[i] - Math.min(...meds), 12);
    }
  });

  it('es el máximo del estadístico por ventanas de la fase 4 (analyze-flow.mjs) con ventanas que empiezan en un par', () => {
    const tr = new RiseTracker();
    const got = t.map((x, i) => tr.push(x, v[i]));
    for (const h of t.filter((x, i) => i % 9 === 0 && x >= t[0] + 600 && x + 1500 < t.at(-1))) {
      const before = median(v.filter((_, j) => t[j] >= h - 600 && t[j] <= h));
      const inWin = t.map((x, j) => j).filter((j) => t[j] >= h && t[j] <= h + 1500);
      const stat = Math.max(...inWin.map((j) => v[j])) - before;
      expect(Math.max(...inWin.map((j) => got[j]))).toBeGreaterThanOrEqual(stat - 1e-12);
    }
  });
});

describe('calibración sobre el reposo', () => {
  const noise = (seed) => {
    const r = rng(seed);
    const memo = new Map();
    return (t, side) => {
      const k = `${t}:${side}`;
      if (!memo.has(k)) memo.set(k, (r() - 0.5) * 0.002);
      return memo.get(k);
    };
  };

  it('con la cabeza quieta es válida y el umbral es el máximo de la subida (o el suelo)', () => {
    const cal = calibrate(fakeStep(20000, { closure: noise(1) }));
    expect(cal.valid).toBe(true);
    for (const side of ['left', 'right']) {
      expect(cal.rise[side]).toBeGreaterThanOrEqual(EVENT_DEFAULTS.riseFloor);
      expect(cal.rise[side]).toBe(Math.max(EVENT_DEFAULTS.riseFloor, cal.riseNull[side].max));
      expect(cal.ear[side].baseline).toBeCloseTo(0.3, 6);
    }
    expect(cal.headStill).toBe(0.1); // 3 × 0,02 < suelo
  });

  it('el suelo manda si el reposo es muy quieto', () => {
    const cal = calibrate(fakeStep(20000));
    expect(cal.rise.left).toBe(EVENT_DEFAULTS.riseFloor);
  });

  it('no vale si la cabeza se mueve casi todo el tiempo', () => {
    const cal = calibrate(fakeStep(20000, { head: (t) => (t % 4000 < 3000 ? 0.5 : 0.02) }));
    expect(cal.valid).toBe(false);
    expect(cal.reason).toMatch(/cabeza/);
  });

  it('aparta las ventanas de los parpadeos del umbral', () => {
    // Un «salto» del cierre durante un parpadeo no debe subir el umbral.
    const closure = (t) => (t > 9000 && t < 9400 ? 0.05 : 0);
    const events = { left: [{ kind: 'blink', t: 9200, duration: 200, completeness: 0.8 }], right: [] };
    const cal = calibrate(fakeStep(20000, { closure, events }));
    expect(cal.rise.left).toBe(EVENT_DEFAULTS.riseFloor);
    const sin = calibrate(fakeStep(20000, { closure }));
    expect(sin.rise.left).toBeGreaterThan(0.04);
  });
});

describe('detector de eventos', () => {
  const cal = calibrate(fakeStep(20000));
  // Contracción del ojo derecho de 0,02 DI (≈ 7 veces el umbral) entre 8 y 9,5 s del paso.
  const squeeze = (t, side) => (side === 'right' && t > 8000 && t < 9500 ? 0.02 : 0);

  it('una contracción de un ojo da un evento en ese ojo y ninguno en el otro', () => {
    const ev = run(new EventDetector(cal), fakeStep(15000, { closure: squeeze }));
    const c = ev.filter((e) => e.kind === 'contraction');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ side: 'right', status: 'ok' });
    expect(c[0].peak).toBeGreaterThan(5);
    expect(c[0].tStart).toBeGreaterThan(7990);
    expect(c[0].tStart).toBeLessThan(8100);
    expect(c[0].tEnd).toBeGreaterThan(9400);
  });

  it('sin contracción no hay eventos', () => {
    expect(run(new EventDetector(cal), fakeStep(15000))).toHaveLength(0);
  });

  it('con la cabeza en movimiento el evento se descarta', () => {
    const head = (t) => (t > 7700 && t < 8300 ? 0.6 : 0.02);
    const c = run(new EventDetector(cal), fakeStep(15000, { closure: squeeze, head })).filter((e) => e.kind === 'contraction');
    expect(c).toHaveLength(1);
    expect(c[0].status).toBe('head');
  });

  it('un pico suelto de la velocidad de la cabeza no descarta nada (mediana de 3 pares)', () => {
    const step = fakeStep(15000, { closure: squeeze });
    const i = step.flow.t.findIndex((t) => t > 8200);
    step.flow.head.rU[i] = 0.9;
    const c = run(new EventDetector(cal), step).filter((e) => e.kind === 'contraction');
    expect(c[0].status).toBe('ok');
  });

  it('si coincide con un parpadeo de verdad del mismo ojo, cuenta como parpadeo', () => {
    const det = new EventDetector(cal);
    det.pushBlink('right', { kind: 'blink', t: 9050, tDown: 9000, tUp: 9150, duration: 150, completeness: 0.75 });
    const c = run(det, fakeStep(15000, { closure: squeeze })).filter((e) => e.kind === 'contraction');
    expect(c[0].status).toBe('blink');
  });

  it('un parpadeo poco profundo (< 50 %) no se fusiona ni se registra', () => {
    const det = new EventDetector(cal);
    expect(det.pushBlink('right', { kind: 'blink', t: 9050, tDown: 9000, tUp: 9150, duration: 150, completeness: 0.3 })).toHaveLength(0);
    const c = run(det, fakeStep(15000, { closure: squeeze })).filter((e) => e.kind === 'contraction');
    expect(c[0].status).toBe('ok');
  });

  it('espera a que termine un cierre en curso del detector de parpadeos', () => {
    let closing = true;
    const det = new EventDetector(cal, { isClosing: (side) => side === 'right' && closing });
    const f = fakeStep(15000, { closure: squeeze }).flow;
    let c = null;
    let at = null;
    f.t.forEach((t, i) => {
      // El detector de parpadeos lleva un cierre desde 9,3 s y lo da por terminado a 10,8 s.
      if (closing && t > 10800) {
        closing = false;
        det.pushBlink('right', { kind: 'closure', t: 9600, tDown: 9300, tUp: 10700, duration: 1400, completeness: 0.8 });
      }
      for (const e of det.pushFlow({ t, closure: { left: f.closure.left[i], right: f.closure.right[i] }, headSpeed: 0.02 })) {
        if (e.kind === 'contraction') { c = e; at = t; }
      }
    });
    // La contracción acaba hacia 9,5 s: sin el cierre en curso se habría dado por buena a 10 s.
    expect(at).toBeGreaterThan(10800);
    expect(c.status).toBe('blink');
  });

  it('energía de la ceja por encima de su umbral: evento experimental de ceja', () => {
    const brow = (t, side) => (side === 'left' && t > 5000 && t < 5600 ? 1 : 0.05);
    const calB = calibrate(fakeStep(20000));
    const ev = run(new EventDetector(calB), fakeStep(10000, { brow })).filter((e) => e.kind === 'brow');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ side: 'left', status: 'ok' });
  });
});
