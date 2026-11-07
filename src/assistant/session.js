// Motor de una sesión guiada: una lista de pasos con cuenta atrás, que registra las medidas
// de cada paso. Sin DOM: el reloj se inyecta para poder probarlo. Lo usa el asistente de
// pruebas y servirá de base al protocolo guiado de la fase 5.
//
// Estados: idle → prep (cuenta atrás) → running (registrando) → review (el usuario anota)
//          → siguiente paso … → done.   Se puede interrumpir, saltar o repetir un paso.

export const PREP_MS = 3000;
/** Modo seguido: pausa entre el final de un paso (dos pitidos) y la cuenta atrás del siguiente. */
export const AUTO_PAUSE_MS = 2000;
/** Modo seguido: tras un paso no válido (p. ej. el reposo del protocolo) se repite solo pasado este tiempo. */
export const RETRY_PAUSE_MS = 7000;

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/** Señales que se guardan por lado en cada paso. */
export const SERIES_KEYS = ['ear', 'aperture', 'blink', 'lookDown', 'lookUp', 'irisH', 'irisV', 'smile'];
const emptySide = () => Object.fromEntries(SERIES_KEYS.map((k) => [k, []]));

/**
 * Flujo óptico por ROI que se guarda en cada paso (fase 4). Por ROI y lado:
 *   eN, eR, eP, eH: energía residual sin compensar, con la referencia, con la postura y con «dorso nasal
 *   + giro» ((DI/s)²); dR, tR, dP, tP, dH, tH: componente hacia abajo y hacia la sien (DI/s) con cada una.
 * `head`: movimiento de la cabeza que se resta (DI/s), con la referencia (rU, rV) y con la postura (pU, pV).
 */
export const FLOW_ROIS = ['upperLid', 'lowerLid', 'brow', 'canthus'];
export const FLOW_KEYS = {
  eN: ['none', 'energy'], eR: ['reference', 'energy'], eP: ['pose', 'energy'], eH: ['hybrid', 'energy'],
  dR: ['reference', 'down'], tR: ['reference', 'temple'], dP: ['pose', 'down'], tP: ['pose', 'temple'], dH: ['hybrid', 'down'], tH: ['hybrid', 'temple'],
};
const emptyFlow = () => ({
  rel: [],
  dt: [],
  left: Object.fromEntries(FLOW_ROIS.map((r) => [r, Object.fromEntries(Object.keys(FLOW_KEYS).map((k) => [k, []]))])),
  right: Object.fromEntries(FLOW_ROIS.map((r) => [r, Object.fromEntries(Object.keys(FLOW_KEYS).map((k) => [k, []]))])),
  head: { rU: [], rV: [], pU: [], pV: [] },
  closure: { left: [], right: [] }, // cierre por flujo (DI, + = se cierra; ver processor.js)
  frozen: [], // 1 = cierre congelado en ese par (algún ojo cerrado más de la mitad; fase 5)
});
/** 4 cifras significativas (las energías van de 1e-4 a 10). */
// 4 cifras significativas; por debajo de 1e-6 (DI/s o su cuadrado) es ruido numérico: 0.
const sig = (v) => (Number.isFinite(v) ? (Math.abs(v) < 1e-6 ? 0 : Number(v.toPrecision(4))) : null);

/**
 * Calendario de repeticiones de un paso: cada una empieza en offsetMs + k·everyMs (pitido «ahora»)
 * y se suelta holdMs después (pitido «suelta»). Con `pattern`, cada repetición tiene su condición:
 * 'act' (hacer el gesto) o 'control' (pitido distinto: no hacer nada), para medir falsos positivos.
 * @returns {{k:number, kind:'hold'|'release', at:number, cond:'act'|'control'}[]} en orden de tiempo
 */
export function repSchedule(reps) {
  if (!reps) return [];
  const out = [];
  for (let k = 0; k < reps.count; k++) {
    const at = reps.offsetMs + k * reps.everyMs;
    const cond = reps.pattern?.[k] ?? 'act';
    out.push({ k, kind: 'hold', at, cond }, { k, kind: 'release', at: at + reps.holdMs, cond });
  }
  return out;
}

/**
 * Orden al azar de `n` repeticiones con la mitad de controles, sin más de 3 iguales seguidas (para
 * que no se puedan adivinar). `rand` se inyecta en los tests.
 */
export function randomPattern(n, rand = Math.random) {
  for (let tries = 0; tries < 200; tries++) {
    const p = [...Array(Math.ceil(n / 2)).fill('act'), ...Array(Math.floor(n / 2)).fill('control')];
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    if (!p.some((x, i) => i >= 3 && p[i - 1] === x && p[i - 2] === x && p[i - 3] === x)) return p;
  }
  return Array.from({ length: n }, (_, i) => (i % 2 ? 'control' : 'act'));
}

const newResult = (step, attempt) => ({
  id: step.id,
  attempt, // nº de intento de este paso (sube al repetirlo)
  title: step.title,
  instruction: step.instruction,
  plannedMs: step.durationMs,
  expect: step.expect ?? null,
  status: 'pending', // completed | skipped | interrupted
  startedAt: null,
  durationMs: null,
  interruptReason: null,
  user: { counted: null, notes: '' },
  perf: null,
  t0: null, // marca de tiempo (cámara) de la primera muestra
  rel: [], // ms desde t0
  series: { left: emptySide(), right: emptySide() },
  events: { left: [], right: [] },
  flow: emptyFlow(),
  marks: [], // repeticiones: { rep, kind: 'hold'|'release', t } (t en ms desde t0, el reloj de las series)
  reps: step.reps ?? null,
  wantsFlow: !!step.flow, // el plan necesita el flujo óptico (para avisar si no llega)
  calibration: null, // calibración sobre este paso (si es el reposo; fase 5)
  detections: [], // eventos de la fase 5 (src/protocol/events.js), en ms desde t0
});

export class GuidedSession {
  /**
   * @param {{id:string,title:string,instruction:string,durationMs:number,expect?:object,countable?:boolean}[]} steps
   * @param {{now?: () => number, prepMs?: number, getPerf?: () => object|null,
   *          onChange?: (snapshot: object) => void, onCue?: (cue: string) => void}} opts
   */
  constructor(steps, { now = () => performance.now(), prepMs = PREP_MS, getPerf = () => null, onChange = () => {}, onCue = () => {}, onStepEnd = () => {} } = {}) {
    this.steps = steps;
    this.now = now;
    this.prepMs = prepMs;
    this.getPerf = getPerf;
    this.onChange = onChange;
    this.onCue = onCue;
    this.onStepEnd = onStepEnd; // (resultado, paso) al terminar un paso grabado entero (p. ej. para calibrar)
    // Modo seguido: sin revisión; al terminar un paso se pasa solo al siguiente tras esta pausa
    // (null = desactivado). Pensado para hacerse la prueba uno mismo con la cámara trasera.
    this.autoAdvanceMs = null;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.index = -1;
    this.attempts = {}; // intentos por paso
    this.results = [];
    this.cur = null;
    this.phaseStart = 0;
    this.startedAt = null;
    this.#emit();
  }

  get step() {
    return this.steps[this.index] ?? null;
  }

  /** Estado para la interfaz. */
  snapshot() {
    const step = this.step;
    const elapsed = this.now() - this.phaseStart;
    let remainingMs = 0;
    let progress = 0;
    if (this.state === 'prep') {
      const prep = this.#prepOf(step);
      remainingMs = Math.max(0, prep - elapsed);
      progress = 1 - remainingMs / prep;
    } else if (this.state === 'running') {
      remainingMs = Math.max(0, step.durationMs - elapsed);
      progress = 1 - remainingMs / step.durationMs;
    }
    // Repetición en curso (pasos con repeticiones): para el aviso sobre el vídeo.
    let rep = null;
    if (this.state === 'running' && step?.reps) {
      const due = repSchedule(step.reps).filter((e) => e.at <= elapsed);
      const last = due.at(-1);
      rep = { of: step.reps.count, k: last ? last.k + 1 : 0, holding: last?.kind === 'hold', control: last?.cond === 'control' };
    }
    return { state: this.state, index: this.index, total: this.steps.length, completed: this.results.length, step, remainingMs, progress, current: this.cur, rep, autoAdvancing: this.autoAdvancing };
  }

  #emit() {
    this.onChange(this.snapshot());
  }

  #enter(i) {
    this.index = i;
    const id = this.steps[i].id;
    this.attempts[id] = (this.attempts[id] ?? 0) + 1;
    this.cur = newResult(this.steps[i], this.attempts[id]);
    this.state = 'prep';
    this.phaseStart = this.now();
    this.onCue('prep');
    this.#emit();
  }

  /** Empieza la sesión (o una nueva) por el primer paso. */
  start() {
    if (this.state === 'prep' || this.state === 'running' || this.state === 'review') return;
    this.results = [];
    this.attempts = {};
    this.startedAt = new Date().toISOString();
    this.#enter(0);
  }

  /** Cuenta atrás de un paso: la suya (p. ej. más larga si la voz lee la explicación) o la general. */
  #prepOf(step) {
    return step?.prepMs ?? this.prepMs;
  }

  /** ¿Pasará solo al siguiente paso? (para que la interfaz siga llamando a tick en la revisión) */
  get autoAdvancing() {
    return this.state === 'review' && this.autoAdvanceMs != null && ['completed', 'invalid'].includes(this.cur?.status);
  }

  /** Avanza las fases por tiempo; la interfaz lo llama unas 10 veces por segundo. */
  tick() {
    const t = this.now();
    if (this.autoAdvancing) {
      const invalid = this.cur.status === 'invalid';
      if (t - this.phaseStart >= (invalid ? RETRY_PAUSE_MS : this.autoAdvanceMs)) {
        if (invalid) this.repeat();
        else this.next();
        return;
      }
    }
    if (this.state === 'prep' && t - this.phaseStart >= this.#prepOf(this.step)) {
      this.state = 'running';
      this.phaseStart = t;
      this.cur.startedAt = new Date().toISOString();
      this.onCue('go');
      this.#emit();
    } else if (this.state === 'running' && t - this.phaseStart >= this.step.durationMs) {
      this.finishStep();
    } else if (this.state === 'running' && this.step.reps) {
      // Pitidos de cada repetición, y su marca de tiempo en el reloj de las series.
      const elapsed = t - this.phaseStart;
      const c = this.cur;
      const step = this.step;
      for (const e of repSchedule(this.step.reps).slice(c.marks.length)) {
        if (e.at > elapsed) break;
        c.marks.push({ rep: e.k + 1, kind: e.kind, t: Math.round(t - (c.t0 ?? t)), ...(step.reps.pattern ? { cond: e.cond } : {}) });
        this.onCue(e.kind === 'hold' && e.cond === 'control' ? 'control' : e.kind);
      }
    }
  }

  /**
   * Registra una muestra del frame (solo mientras se graba el paso).
   * @param {number} t marca de tiempo de la cámara, en ms
   * @param {null | {left: object, right: object}} sample null = sin cara
   * @param {{left?: object[], right?: object[]}} events eventos de parpadeo cerrados con esta muestra
   */
  record(t, sample, events = {}) {
    if (this.state !== 'running') return;
    const c = this.cur;
    c.t0 ??= t;
    c.rel.push(Math.round(t - c.t0));
    for (const side of ['left', 'right']) {
      for (const k of SERIES_KEYS) c.series[side][k].push(r3(sample?.[side]?.[k]));
      for (const e of events[side] ?? []) {
        c.events[side].push({
          kind: e.kind,
          t: Math.round(e.t - c.t0),
          duration: Math.round(e.duration),
          min: r3(e.min),
          baseline: r3(e.baseline),
          completeness: r3(e.completeness),
        });
      }
    }
  }

  /**
   * Registra un par de flujo óptico ya procesado (FlowProcessor), solo mientras se graba el paso.
   * @param {{t:number, dt:number, left:object, right:object, head:object}} s
   */
  recordFlow(s) {
    if (this.state !== 'running' || !s) return;
    const c = this.cur;
    c.t0 ??= s.t;
    const f = c.flow;
    f.rel.push(Math.round(s.t - c.t0));
    f.dt.push(Math.round(s.dt));
    for (const side of ['left', 'right']) {
      for (const roi of FLOW_ROIS) {
        for (const [k, [variant, field]] of Object.entries(FLOW_KEYS)) f[side][roi][k].push(sig(s[side]?.[roi]?.[variant]?.[field]));
      }
    }
    f.head.rU.push(sig(s.head?.reference?.u));
    f.head.rV.push(sig(s.head?.reference?.v));
    f.head.pU.push(sig(s.head?.pose?.u));
    f.head.pV.push(sig(s.head?.pose?.v));
    for (const side of ['left', 'right']) f.closure[side].push(sig(s.closure?.[side]));
    f.frozen.push(s.closureFrozen ? 1 : 0);
  }

  /**
   * Registra un evento de la fase 5 (EventDetector). Se acepta también durante la revisión: un evento
   * se da por bueno hasta ~0,5–2 s después de acabar, y el final del paso puede quedar en medio.
   * @param {{kind:string, side:string, tStart:number, tEnd:number, duration:number, peak:number, tPeak:number, status:string}} e
   */
  recordDetection(e) {
    if (!['running', 'review'].includes(this.state) || this.cur?.t0 == null) return;
    const c = this.cur;
    if (e.tStart < c.t0) return; // empezó en la cuenta atrás (o en el paso anterior)
    c.detections.push({ kind: e.kind, side: e.side, t: Math.round(e.tStart - c.t0), duration: e.duration, peak: e.peak, tPeak: Math.round(e.tPeak - c.t0), status: e.status });
  }

  /** Termina el paso en curso (por tiempo o antes de tiempo) y pasa a la revisión. */
  finishStep() {
    if (this.state !== 'running') return;
    this.cur.status = 'completed';
    this.cur.durationMs = Math.round(this.now() - this.phaseStart);
    this.cur.perf = this.getPerf();
    this.onStepEnd(this.cur, this.step);
    // Un paso que exige una calibración válida (el reposo del protocolo) no se da por bueno sin ella.
    const invalid = !!this.step.requireValid && this.cur.calibration && !this.cur.calibration.valid;
    if (invalid) this.cur.status = 'invalid';
    this.state = 'review';
    this.phaseStart = this.now(); // para la pausa del modo seguido
    this.onCue(invalid ? 'invalid' : 'end');
    this.#emit();
  }

  /** Marca el paso en curso como interrumpido (p. ej. la cámara se reinició) y pasa a la revisión. */
  interrupt(reason) {
    if (this.state !== 'running') return;
    this.cur.status = 'interrupted';
    this.cur.interruptReason = reason;
    this.cur.durationMs = Math.round(this.now() - this.phaseStart);
    this.cur.perf = this.getPerf();
    this.state = 'review';
    this.#emit();
  }

  /** Datos que anota el usuario al revisar el paso: lo contado y las observaciones. */
  setUser(patch) {
    if (this.cur) Object.assign(this.cur.user, patch);
  }

  #push(status) {
    if (status) this.cur.status = status;
    this.results.push(this.cur);
  }

  #advance() {
    if (this.index + 1 < this.steps.length) {
      this.#enter(this.index + 1);
    } else {
      this.cur = null;
      this.state = 'done';
      this.onCue('done');
      this.#emit();
    }
  }

  /** Guarda el paso revisado y pasa al siguiente (o termina). Un paso no válido hay que repetirlo. */
  next() {
    if (this.state !== 'review' || this.cur?.status === 'invalid') return;
    this.#push();
    this.#advance();
  }

  /** Salta el paso actual sin grabarlo (o descartando lo grabado). */
  skip() {
    if (!['prep', 'running', 'review'].includes(this.state)) return;
    this.cur.status = 'skipped';
    this.cur.durationMs ??= 0;
    this.#push();
    this.#advance();
  }

  /** Repite el paso actual desde la cuenta atrás, descartando lo grabado. */
  repeat() {
    if (!['prep', 'running', 'review'].includes(this.state)) return;
    this.#enter(this.index);
  }

  /**
   * Vuelve al paso anterior (o, si la sesión ha terminado, rehace el último) y lo graba de nuevo.
   * Descarta lo grabado del paso en curso y el resultado del anterior; el resto se conserva.
   * @returns {boolean} false si no hay ningún paso anterior que rehacer
   */
  previous() {
    if (!['prep', 'running', 'review', 'done', 'aborted'].includes(this.state) || !this.results.length) return false;
    const target = this.results.length - 1; // un resultado por paso, en orden
    this.results.pop();
    this.#enter(target);
    return true;
  }

  /** Detiene la sesión. Lo ya revisado se conserva en `results` y se puede retomar con `resume()`. */
  abort() {
    if (!['prep', 'running', 'review'].includes(this.state)) return;
    this.cur = null;
    this.state = 'aborted';
    this.#emit();
  }

  /** Retoma una sesión detenida en el paso que se estaba haciendo (desde su cuenta atrás). */
  resume() {
    if (this.state !== 'aborted' || this.index < 0) return;
    this.#enter(this.index);
  }
}
