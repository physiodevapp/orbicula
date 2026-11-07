import { protocolSteps } from '../protocol/steps.js';

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
// `say`: lo que dice la voz (si está activada) durante la cuenta atrás, después del nombre del paso.
// En el móvil del autor el gesto llega ~0,5–1 s después del pitido (latencia del audio + reacción):
// el análisis lo alinea con el movimiento real, no con el pitido.

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
    say: 'Quieto y de frente. No hagas nada.',
  },
  {
    id: 'rest',
    title: 'Reposo',
    instruction: 'Mira al frente, quieto, sin hacer nada. Parpadea con naturalidad.',
    durationMs: 20000,
    say: 'Mira al frente sin hacer nada y parpadea con naturalidad.',
    hint: 'Este reposo es la referencia de los demás pasos: cuanto más quieto, mejor.',
    calibrates: true, // fase 5: de este paso salen los umbrales de los eventos
  },
  {
    id: 'minimal',
    title: 'Contracción mínima',
    instruction: 'Con el pitido agudo, entrecierra los ojos lo mínimo, como si sonrieras con los ojos. Suelta con el pitido grave. 5 veces.',
    durationMs: repDuration(MINIMAL),
    reps: MINIMAL,
    say: 'Espera al pitido agudo. Entonces entrecierra los ojos lo mínimo, como si sonrieras con los ojos, tan poco que casi no lo notes. Mantenlo hasta el pitido grave y suelta. Cinco veces.',
    hint: 'Lo más pequeño que puedas notar tú. Si el EAR no lo ve pero el flujo sí, es justo lo que se quiere demostrar.',
  },
  {
    id: 'more',
    title: 'Contracción algo mayor',
    instruction: 'Con el pitido agudo, entrecierra los ojos algo más, que se note, sin cerrarlos. Suelta con el pitido grave. 3 veces.',
    durationMs: repDuration(MORE),
    reps: MORE,
    say: 'Espera al pitido agudo. Entonces entrecierra los ojos algo más, que se note, sin cerrarlos. Mantenlo hasta el pitido grave y suelta. Tres veces.',
  },
  {
    id: 'nod',
    title: 'Cabeceo suave',
    instruction: 'Asiente despacio con la cabeza, poco. Sin entrecerrar los ojos ni parpadear a propósito.',
    durationMs: 15000,
    say: 'Cuando suene el pitido de inicio, asiente con la cabeza, despacio y poco, sin parar hasta el final del paso. Los ojos, abiertos y sin gestos.',
    hint: 'Con la compensación, el flujo de los párpados debería quedarse como en reposo.',
  },
  {
    id: 'turn',
    title: 'Giro suave',
    instruction: 'Gira la cabeza despacio a un lado y al otro, poco. Sin mover los párpados a propósito.',
    durationMs: 12000,
    say: 'Cuando suene el pitido de inicio, gira la cabeza a un lado y al otro, despacio y poco, sin parar hasta el final del paso. Los ojos, abiertos y sin gestos.',
  },
  {
    id: 'brows',
    title: 'Elevación de cejas',
    instruction: 'Con el pitido agudo, sube las cejas. Bájalas con el pitido grave. 3 veces.',
    durationMs: repDuration(BROWS),
    reps: BROWS,
    say: 'Espera al pitido agudo. Entonces sube las cejas y mantenlas arriba hasta el pitido grave. Después bájalas y relaja. Tres veces.',
  },
  {
    id: 'wink-left',
    title: 'Guiño del ojo izquierdo',
    instruction: 'Con el pitido agudo, cierra SOLO el ojo izquierdo. Ábrelo con el pitido grave. 3 veces.',
    durationMs: repDuration(WINK),
    reps: WINK,
    say: 'Espera al pitido agudo. Entonces cierra solo el ojo izquierdo y mantenlo cerrado hasta el pitido grave. Tres veces.',
    expect: { left: 3, right: 0 },
    hint: 'Sirve para ver si el otro ojo se mueve de verdad (flujo) o solo en la malla de puntos (EAR).',
  },
  {
    id: 'wink-right',
    title: 'Guiño del ojo derecho',
    instruction: 'Con el pitido agudo, cierra SOLO el ojo derecho. Ábrelo con el pitido grave. 3 veces.',
    durationMs: repDuration(WINK),
    reps: WINK,
    say: 'Espera al pitido agudo. Entonces cierra solo el ojo derecho y mantenlo cerrado hasta el pitido grave. Tres veces.',
    expect: { left: 0, right: 3 },
  },
  {
    id: 'natural',
    title: 'Parpadeo espontáneo',
    instruction: 'Mira al frente y parpadea con naturalidad.',
    durationMs: 20000,
    countable: true,
    say: 'Mira al frente y parpadea con naturalidad.',
  },
];

/**
 * Cuenta atrás de un paso cuando la voz lee su explicación: lo que tarda en leerla (≈ 70 ms por
 * carácter, sin prisa) más 2,5 s para los pitidos de la cuenta atrás. Nunca menos de `minMs`.
 */
export function spokenPrepMs(text, minMs = 3000) {
  return Math.max(minMs, Math.round((text?.length ?? 0) * 70 + 2500));
}

// ── Fase 4: contracción mínima con controles (criterio 3) ────────────────────────────────────
// Repeticiones de contracción mínima mezcladas al azar con controles (pitido distinto: no hacer
// nada). Da, para el EAR y para el flujo, la tasa de aciertos (contracciones detectadas) y la de
// falsos positivos (controles «detectados»). `randomize`: el orden se sortea al empezar la sesión
// (mitad y mitad, sin más de 3 iguales seguidas) y queda en el JSON (marcas con `cond`).
const MICRO = { ...rep(10, 5000, 1500), randomize: true };
const MICRO_SAY = 'Atención, hay dos avisos. Pitido agudo: entrecierra los ojos lo mínimo, como si sonrieras con los ojos, tan poco que casi no lo notes, y mantenlo hasta el pitido grave. Dos pitidos cortos: no hagas nada y quédate quieto hasta el pitido grave. Diez veces, en orden al azar.';
const MICRO_TEXT = 'Pitido agudo: entrecierra los ojos lo mínimo y mantén hasta el grave. Dos pitidos cortos: no hagas nada, quieto hasta el grave. 10 veces, al azar.';

export const MICRO_STEPS = [
  PHASE4_STEPS[0],
  PHASE4_STEPS[1],
  { id: 'micro-1', title: 'Contracción mínima con controles (1)', instruction: MICRO_TEXT, durationMs: repDuration(MICRO), reps: MICRO, say: MICRO_SAY,
    hint: 'Lo más pequeño que puedas notar tú. En los controles, quieto y sin gestos.' },
  { id: 'micro-2', title: 'Contracción mínima con controles (2)', instruction: MICRO_TEXT, durationMs: repDuration(MICRO), reps: MICRO, say: MICRO_SAY },
  { id: 'rest-end', title: 'Reposo final', instruction: 'Mira al frente, quieto, sin hacer nada. Parpadea con naturalidad.', durationMs: 20000,
    say: 'Mira al frente sin hacer nada y parpadea con naturalidad.' },
];

/** Planes del asistente. `flow`: necesita el flujo óptico encendido. */
export const PLANS = {
  phase4: { id: 'phase4', label: 'Fase 4: flujo óptico (unos 4 min)', steps: PHASE4_STEPS, flow: true },
  micro: { id: 'micro', label: 'Fase 4: contracción mínima con controles (unos 3 min)', steps: MICRO_STEPS, flow: true },
  phase3: { id: 'phase3', label: 'Fase 3: parpadeos (unos 7 min)', steps: PHASE3_STEPS, flow: false },
};
export const DEFAULT_PLAN = 'phase4';

/** El protocolo clínico guiado (fase 5) tiene su propia tarjeta: sus pasos salen de la configuración. */
export const PROTOCOL_PLAN = { id: 'protocol', label: 'Protocolo clínico', build: protocolSteps, flow: true };
