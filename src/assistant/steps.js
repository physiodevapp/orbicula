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
    countable: true,
  },
  {
    id: 'wink-right',
    title: 'Guiño del ojo derecho',
    instruction: 'Cierra SOLO el ojo derecho, ábrelo y espera 2 segundos. Repite 5 veces.',
    durationMs: 25000,
    expect: { left: 0, right: 5 },
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
    countable: true,
  },
  {
    id: 'gaze',
    title: 'Mirada arriba y abajo',
    instruction: 'Sin parpadear a propósito: mira arriba, al frente, abajo, al frente. Repite 3 veces, despacio.',
    durationMs: 20000,
    expect: { left: 0, right: 0 },
  },
  {
    id: 'nod',
    title: 'Cabeceo suave',
    instruction: 'Asiente despacio con la cabeza, sin cerrar los ojos a propósito.',
    durationMs: 15000,
    expect: { left: 0, right: 0 },
  },
];
