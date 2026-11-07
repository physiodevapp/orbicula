// Motor de una sesión guiada: una lista de pasos con cuenta atrás, que registra las medidas
// de cada paso. Sin DOM: el reloj se inyecta para poder probarlo. Lo usa el asistente de
// pruebas y servirá de base al protocolo guiado de la fase 5.
//
// Estados: idle → prep (cuenta atrás) → running (registrando) → review (el usuario anota)
//          → siguiente paso … → done.   Se puede interrumpir, saltar o repetir un paso.

export const PREP_MS = 3000;

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

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
  series: { left: { ear: [], aperture: [], blink: [] }, right: { ear: [], aperture: [], blink: [] } },
  events: { left: [], right: [] },
});

export class GuidedSession {
  /**
   * @param {{id:string,title:string,instruction:string,durationMs:number,expect?:object,countable?:boolean}[]} steps
   * @param {{now?: () => number, prepMs?: number, getPerf?: () => object|null,
   *          onChange?: (snapshot: object) => void, onCue?: (cue: string) => void}} opts
   */
  constructor(steps, { now = () => performance.now(), prepMs = PREP_MS, getPerf = () => null, onChange = () => {}, onCue = () => {} } = {}) {
    this.steps = steps;
    this.now = now;
    this.prepMs = prepMs;
    this.getPerf = getPerf;
    this.onChange = onChange;
    this.onCue = onCue;
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
      remainingMs = Math.max(0, this.prepMs - elapsed);
      progress = 1 - remainingMs / this.prepMs;
    } else if (this.state === 'running') {
      remainingMs = Math.max(0, step.durationMs - elapsed);
      progress = 1 - remainingMs / step.durationMs;
    }
    return { state: this.state, index: this.index, total: this.steps.length, completed: this.results.length, step, remainingMs, progress, current: this.cur };
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

  /** Avanza las fases por tiempo; la interfaz lo llama unas 10 veces por segundo. */
  tick() {
    const t = this.now();
    if (this.state === 'prep' && t - this.phaseStart >= this.prepMs) {
      this.state = 'running';
      this.phaseStart = t;
      this.cur.startedAt = new Date().toISOString();
      this.onCue('go');
      this.#emit();
    } else if (this.state === 'running' && t - this.phaseStart >= this.step.durationMs) {
      this.finishStep();
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
      for (const k of ['ear', 'aperture', 'blink']) c.series[side][k].push(r3(sample?.[side]?.[k]));
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

  /** Termina el paso en curso (por tiempo o antes de tiempo) y pasa a la revisión. */
  finishStep() {
    if (this.state !== 'running') return;
    this.cur.status = 'completed';
    this.cur.durationMs = Math.round(this.now() - this.phaseStart);
    this.cur.perf = this.getPerf();
    this.state = 'review';
    this.onCue('end');
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

  /** Guarda el paso revisado y pasa al siguiente (o termina). */
  next() {
    if (this.state !== 'review') return;
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
