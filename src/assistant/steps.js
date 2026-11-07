// Pasos del asistente de pruebas de la fase 3 (EAR y parpadeos).
// `expect` es lo que se debería detectar si todo va bien: se guarda en el JSON para compararlo.
// `countable`: el usuario puede anotar cuántos ha contado él.
//
// Lados: siempre los del PACIENTE. En un autoexamen con la cámara frontal, «el ojo izquierdo»
// es el izquierdo de quien se mira (no el de la imagen del espejo).

export const PHASE3_STEPS = [
  {
    id: 'check',
    title: 'Comprobación inicial',
    instruction: 'Cara de frente, centrada y quieta. Mira a la cámara. No hace falta hacer nada.',
    durationMs: 8000,
  },
  {
    id: 'rest',
    title: 'Reposo',
    instruction: 'Mira al frente sin hacer nada. Parpadea con naturalidad.',
    durationMs: 20000,
    countable: true,
  },
  {
    id: 'natural',
    title: 'Parpadeo espontáneo',
    instruction: 'Mira al frente y parpadea con naturalidad. Si te observa alguien, que cuente tus parpadeos.',
    durationMs: 60000,
    countable: true,
  },
  {
    id: 'wink-left',
    title: 'Guiño del ojo izquierdo',
    instruction: 'Cierra SOLO el ojo izquierdo, ábrelo y espera 2 segundos. Repite 5 veces.',
    durationMs: 25000,
    expect: { left: 5, right: 0 },
    hint: 'Un guiño de más de 0,8 s se anota como «cierre» y no como parpadeo. Es normal que el otro ojo acompañe con un cierre más corto.',
    countable: true,
  },
  {
    id: 'wink-right',
    title: 'Guiño del ojo derecho',
    instruction: 'Cierra SOLO el ojo derecho, ábrelo y espera 2 segundos. Repite 5 veces.',
    durationMs: 25000,
    expect: { left: 0, right: 5 },
    hint: 'Un guiño de más de 0,8 s se anota como «cierre» y no como parpadeo. Es normal que el otro ojo acompañe con un cierre más corto.',
    countable: true,
  },
  {
    id: 'weak-blink',
    title: 'Parpadeo flojo',
    instruction: 'Parpadea con los dos ojos sin cerrarlos del todo, 5 veces, con 2 segundos de pausa.',
    durationMs: 20000,
    expect: { left: 5, right: 5 },
    countable: true,
  },
  {
    id: 'closure',
    title: 'Cierre mantenido',
    instruction: 'Cierra los dos ojos suavemente durante 2 segundos y ábrelos. Repite 3 veces con 4 segundos de pausa.',
    durationMs: 25000,
    expect: { closures: 3 },
    hint: 'Se cuenta como «cierre» todo lo que dure más de 0,8 s con los ojos cerrados.',
    countable: true,
  },
  {
    id: 'gaze',
    title: 'Mirada arriba y abajo',
    instruction: 'Sin parpadear a propósito: mira arriba, al frente, abajo, al frente. Repite 3 veces, despacio.',
    durationMs: 20000,
    expect: { left: 0, right: 0 },
    hint: 'Al mirar hacia abajo el párpado baja y el detector puede anotarlo como cierre: es un caso conocido que se está estudiando.',
  },
  {
    id: 'nod',
    title: 'Cabeceo suave',
    instruction: 'Asiente despacio con la cabeza, sin cerrar los ojos a propósito.',
    durationMs: 15000,
    expect: { left: 0, right: 0 },
  },
];

// ── Fase 4: flujo óptico ─────────────────────────────────────────────────────────────────────
// Para cerrar los criterios 3 y 4 (docs/plan-fase-4.md): reposo como referencia, contracción mínima
// (la energía del flujo debería superar 3 veces el p95 del reposo sin que el EAR se mueva más que su
// ruido), contracción algo mayor (que el EAR sí note), y movimientos de cabeza SIN contracción (con
// la compensación, ninguna ROI debería pasar del p99 del reposo). Los guiños sirven para estudiar
// si el ojo que no guiña se mueve de verdad (flujo) o solo en la malla (EAR).
//
// `reps`: repeticiones guiadas con pitidos (agudo = «ahora», grave = «suelta»), para poder hacerlas
// con la cámara trasera sin ver la pantalla. Sus marcas de tiempo se guardan en el JSON.

const rep = (count, everyMs, holdMs, offsetMs = 2500) => ({ count, everyMs, holdMs, offsetMs });
const repDuration = (r) => r.offsetMs + r.count * r.everyMs;

const MINIMAL = rep(5, 5000, 1500);
const MORE = rep(3, 6000, 2000);
const BROWS = rep(3, 5000, 1500);
const WINK = rep(3, 5000, 1000);

export const PHASE4_STEPS = [
  {
    id: 'check',
    title: 'Comprobación inicial',
    instruction: 'Cara de frente, centrada y quieta. Mira a la cámara. No hace falta hacer nada.',
    durationMs: 8000,
  },
  {
    id: 'rest',
    title: 'Reposo',
    instruction: 'Mira al frente, quieto, sin hacer nada. Parpadea con naturalidad.',
    durationMs: 20000,
    hint: 'Este reposo es la referencia de los demás pasos: cuanto más quieto, mejor.',
  },
  {
    id: 'minimal',
    title: 'Contracción mínima',
    instruction: 'Con el pitido agudo, entrecierra los ojos lo mínimo, como si sonrieras con los ojos. Suelta con el pitido grave. 5 veces.',
    durationMs: repDuration(MINIMAL),
    reps: MINIMAL,
    hint: 'Lo más pequeño que puedas notar tú. Si el EAR no lo ve pero el flujo sí, es justo lo que se quiere demostrar.',
  },
  {
    id: 'more',
    title: 'Contracción algo mayor',
    instruction: 'Con el pitido agudo, entrecierra los ojos algo más, que se note, sin cerrarlos. Suelta con el pitido grave. 3 veces.',
    durationMs: repDuration(MORE),
    reps: MORE,
  },
  {
    id: 'nod',
    title: 'Cabeceo suave',
    instruction: 'Asiente despacio con la cabeza, poco. Sin entrecerrar los ojos ni parpadear a propósito.',
    durationMs: 15000,
    hint: 'Con la compensación, el flujo de los párpados debería quedarse como en reposo.',
  },
  {
    id: 'turn',
    title: 'Giro suave',
    instruction: 'Gira la cabeza despacio a un lado y al otro, poco. Sin mover los párpados a propósito.',
    durationMs: 12000,
  },
  {
    id: 'brows',
    title: 'Elevación de cejas',
    instruction: 'Con el pitido agudo, sube las cejas. Bájalas con el pitido grave. 3 veces.',
    durationMs: repDuration(BROWS),
    reps: BROWS,
  },
  {
    id: 'wink-left',
    title: 'Guiño del ojo izquierdo',
    instruction: 'Con el pitido agudo, cierra SOLO el ojo izquierdo. Ábrelo con el pitido grave. 3 veces.',
    durationMs: repDuration(WINK),
    reps: WINK,
    expect: { left: 3, right: 0 },
    hint: 'Sirve para ver si el otro ojo se mueve de verdad (flujo) o solo en la malla de puntos (EAR).',
  },
  {
    id: 'wink-right',
    title: 'Guiño del ojo derecho',
    instruction: 'Con el pitido agudo, cierra SOLO el ojo derecho. Ábrelo con el pitido grave. 3 veces.',
    durationMs: repDuration(WINK),
    reps: WINK,
    expect: { left: 0, right: 3 },
  },
  {
    id: 'natural',
    title: 'Parpadeo espontáneo',
    instruction: 'Mira al frente y parpadea con naturalidad.',
    durationMs: 20000,
    countable: true,
  },
];

/** Planes del asistente. `flow`: necesita el flujo óptico encendido. */
export const PLANS = {
  phase4: { id: 'phase4', label: 'Fase 4: flujo óptico (unos 4 min)', steps: PHASE4_STEPS, flow: true },
  phase3: { id: 'phase3', label: 'Fase 3: parpadeos (unos 7 min)', steps: PHASE3_STEPS, flow: false },
};
export const DEFAULT_PLAN = 'phase4';
