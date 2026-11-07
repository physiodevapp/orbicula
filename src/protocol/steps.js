// Protocolo clínico guiado de la fase 5 (docs/plan-fase-5.md): seis fases con la voz y los pitidos del
// asistente (GuidedSession). Los textos hablan al paciente de «tú». Lados: siempre los del paciente.
//
// De la primera fase (reposo) salen los umbrales de todo lo demás (src/protocol/events.js): si el
// reposo no vale (cabeza movida, demasiados parpadeos, cara perdida), el protocolo no sigue y lo repite.

export const PROTOCOL_DEFAULTS = { restSec: 30, naturalSec: 60, reps: 3 };
/** Valores que ofrece la interfaz (no hay más: son los que se han probado). */
export const PROTOCOL_OPTIONS = { restSec: [30, 45, 60], naturalSec: [30, 60, 90], reps: [3, 4, 5] };

const HOLD_MS = 3000; // cuánto dura cada gesto mantenido
const GAP_MS = 4000; // pausa entre gestos
const OFFSET_MS = 2500; // antes del primero
const WORDS = { 3: 'tres', 4: 'cuatro', 5: 'cinco' };

const repsOf = (count) => ({ count, everyMs: HOLD_MS + GAP_MS, holdMs: HOLD_MS, offsetMs: OFFSET_MS });
const repDuration = (r) => r.offsetMs + r.count * r.everyMs;

/** Fuerza un valor a una de las opciones permitidas (si no, el valor por defecto). */
export function cleanSettings(s = {}) {
  const pick = (key) => (PROTOCOL_OPTIONS[key].includes(Number(s[key])) ? Number(s[key]) : PROTOCOL_DEFAULTS[key]);
  return { restSec: pick('restSec'), naturalSec: pick('naturalSec'), reps: pick('reps') };
}

/**
 * Pasos del protocolo con la configuración elegida.
 * @param {{restSec?: number, naturalSec?: number, reps?: number}} settings
 */
export function protocolSteps(settings = {}) {
  const { restSec, naturalSec, reps: count } = cleanSettings(settings);
  const reps = repsOf(count);
  const n = WORDS[count];
  const gesture = (id, title, what, sayWhat, hint) => ({
    id,
    title,
    instruction: `Con el pitido agudo, ${what} Con el pitido grave, relaja. ${count} veces.`,
    durationMs: repDuration(reps),
    reps,
    say: `Espera al pitido agudo. Entonces ${sayWhat} Mantenlo hasta el pitido grave y relaja. ${n[0].toUpperCase()}${n.slice(1)} veces.`,
    ...(hint ? { hint } : {}),
  });
  return [
    {
      id: 'rest',
      title: 'Reposo (calibración)',
      instruction: 'Apoya la cabeza, mira al frente, quieto y sin hacer nada. Parpadea con naturalidad.',
      durationMs: restSec * 1000,
      say: 'Apoya la cabeza en el respaldo o en una pared. Mira al frente, quieto, sin hacer nada, y parpadea con naturalidad. De este reposo salen los umbrales de todo lo demás.',
      hint: 'De este reposo salen los umbrales: cuanto más quieto, mejor. Si la cabeza se mueve, se repite.',
      calibrates: true,
      requireValid: true, // sin un reposo válido no se sigue
      calibrateOptions: { minValidFraction: 0.5 }, // mitad del reposo, como mínimo, sin parpadeos y con la cabeza quieta
    },
    {
      id: 'natural',
      title: 'Parpadeo espontáneo',
      instruction: 'Mira al frente y parpadea con naturalidad, sin forzar.',
      durationMs: naturalSec * 1000,
      say: 'Mira al frente y parpadea con naturalidad, sin forzar.',
      countable: true,
    },
    gesture('soft', 'Cierre suave', 'cierra los ojos suavemente, como para dormir.', 'cierra los ojos suavemente, como para dormir.'),
    gesture('forced', 'Cierre forzado', 'aprieta los ojos con fuerza.', 'aprieta los ojos con fuerza.'),
    gesture('brows', 'Elevación de cejas', 'sube las cejas.', 'sube las cejas.'),
    gesture('smile', 'Sonrisa amplia', 'sonríe todo lo que puedas, enseñando los dientes.', 'sonríe todo lo que puedas, enseñando los dientes.',
      'Una sonrisa amplia sana también cierra algo el ojo: lo que informa es la diferencia entre los dos lados.'),
  ];
}
