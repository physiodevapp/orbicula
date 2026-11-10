// Asistente de pruebas: guía paso a paso (GuidedSession), avisa sobre el vídeo con la cuenta
// atrás y guarda el registro como un JSON que se descarga o se comparte. Todo en el
// dispositivo: no hay ninguna llamada de red.
import { GuidedSession, AUTO_PAUSE_MS, randomPattern } from '../assistant/session.js';
import { PLANS, DEFAULT_PLAN, spokenPrepMs } from '../assistant/steps.js';
import { cleanSettings, PROTOCOL_DEFAULTS } from '../protocol/steps.js';
import { summarizeProtocol } from '../protocol/summary.js';
import { renderSummary } from './summary.js';
import { bindCodeField, showMessage } from './code-field.js';
import { requestWake } from './wake.js';
import { buildReport, describeSummary } from '../assistant/report.js';
import { downloadJson, shareJson, copyJson, stamp } from './share.js';

const $ = (id) => document.getElementById(id);

/** `?escala=0.2` acorta las duraciones (para comprobar el flujo rápido); por defecto 1. */
function scale() {
  const k = Number(new URLSearchParams(location.search).get('escala'));
  return k > 0 && k < 1 ? k : 1;
}

/** Pasos de un plan (los del protocolo salen de su configuración), acortados con `?escala` y marcados con si necesitan el flujo. */
function stepsOf(plan, settings) {
  const k = scale();
  const shorten = (ms, min) => (k < 1 ? Math.max(min, Math.round(ms * k)) : ms);
  return (plan.build ? plan.build(settings) : plan.steps).map((s) => ({
    ...s,
    flow: plan.flow,
    durationMs: shorten(s.durationMs, 1500),
    ...(s.reps ? { reps: {
      ...s.reps, everyMs: shorten(s.reps.everyMs, 800), holdMs: shorten(s.reps.holdMs, 300), offsetMs: shorten(s.reps.offsetMs, 300),
      // Orden al azar de contracciones y controles: se sortea en cada sesión.
      ...(s.reps.randomize ? { pattern: randomPattern(s.reps.count) } : {}),
    } } : {}),
  })).map((s) => (s.reps && k < 1 ? { ...s, durationMs: s.reps.offsetMs + s.reps.count * s.reps.everyMs } : s));
}

/** Lo que dice la voz cuando el reposo no vale, según el motivo. */
const INVALID_SAY = {
  face: 'No te veo bien la cara. Encuádrala de frente y con buena luz.',
  head: 'Te has movido. Apoya la cabeza y quédate quieto.',
  blinks: 'Has parpadeado mucho. Parpadea con calma y sin forzar.',
  clean: 'No he tenido momentos tranquilos suficientes. Quédate quieto y parpadea poco.',
  noflow: 'No me llegan datos del movimiento. Comprueba que se ve la cara.',
};

const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.ceil((ms % 60000) / 1000) % 60)}`;

/**
 * @param {{getContext: () => object, getPerf: () => object|null, onStart: (plan: object) => Promise<void>|void}} deps
 *   getContext: build, device, capture, analysis, flujo y detector para el informe
 *   onStart: se llama al empezar una sesión (la app reinicia sus medidas y, si el plan lo pide, enciende el flujo)
 */
export function createAssistant({ getContext, getPerf, onStart, onStepEnd = () => {}, onStepStart = () => {}, onState = () => {}, exporter = null, prefix = 'as', rootId = 'assistant', busyKey = 'assistant', plan: fixedPlan = null }) {
  const root = $(rootId);
  const P = prefix;
  const el = {
    status: $(`${P}Status`), code: $(`${P}Code`), sound: $(`${P}Sound`), auto: $(`${P}Auto`), voice: $(`${P}Voice`),
    title: $(`${P}Title`), text: $(`${P}Text`),
    revTitle: $(`${P}RevTitle`), summary: $(`${P}Summary`), expect: $(`${P}Expect`),
    countedRow: $(`${P}CountedRow`), counted: $(`${P}Counted`), notes: $(`${P}Notes`),
    msg: $(`${P}Msg`), share: $(`${P}Share`),
    prev: $(`${P}Prev`), prevReview: $(`${P}PrevReview`), resume: $(`${P}Resume`), redoLast: $(`${P}RedoLast`),
    doneTitle: $(`${P}DoneTitle`), doneText: $(`${P}DoneText`), plan: $(`${P}Plan`),
    coach: $('coach'), coachStep: $('coachStep'), coachTime: $('coachTime'), coachText: $('coachText'), coachBar: $('coachBar'),
  };

  // ── Sonidos y vibración (WebAudio, sin archivos) ────────────────────────────
  let audio = null;
  function beep(freq, ms = 130, at = 0) {
    if (!el.sound.checked) return;
    try {
      audio ??= new AudioContext();
      const t = audio.currentTime + at;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + ms / 1000);
    } catch { /* sin audio */ }
  }
  const buzz = (pattern) => el.sound.checked && navigator.vibrate?.(pattern);

  // ── Voz: el nombre de cada paso, para saber en cuál estás sin mirar la pantalla ───────────────
  // Solo con voces instaladas en el móvil (localService): una voz «en la nube» mandaría el texto
  // fuera del dispositivo. El texto es siempre el de la app (nunca datos del paciente).
  const localVoice = () => {
    try {
      const voices = speechSynthesis.getVoices().filter((v) => v.localService);
      return voices.find((v) => /^es(-|_|$)/i.test(v.lang)) ?? null;
    } catch {
      return null;
    }
  };
  try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => {}; } catch { /* sin voz */ }
  function say(text) {
    if (!el.voice.checked) return;
    const voice = localVoice();
    if (!voice) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* sin voz */ }
  }

  function onCue(cue) {
    if (cue === 'prep') {
      beep(440); buzz(40);
      const s = session.snapshot();
      if (s.step) say(`Paso ${s.index + 1}: ${s.step.title}. ${s.step.say ?? ''}`);
    }
    else if (cue === 'go') { beep(880, 200); buzz(150); }
    // Reposo no válido: dos pitidos graves y la voz lo explica; el paso se repite.
    else if (cue === 'invalid') { beep(330, 200); beep(330, 200, 0.28); buzz([200, 80, 200]); say(`El reposo no ha valido. ${INVALID_SAY[session.cur?.calibration?.reasonCode] ?? 'Quédate quieto.'} Repetimos.`); }
    else if (cue === 'end') { beep(660); beep(660, 130, 0.22); buzz([80, 60, 80]); }
    else if (cue === 'done') { beep(660); beep(880, 130, 0.18); beep(1100, 200, 0.36); buzz([100, 60, 100, 60, 200]); say('Prueba terminada.'); }
    // Repeticiones: agudo y largo = «ahora»; grave = «suelta».
    else if (cue === 'hold') { beep(1175, 260); buzz(120); }
    else if (cue === 'release') { beep(392, 220); buzz(40); }
    // Control: dos pitidos cortos medios = «no hagas nada».
    else if (cue === 'control') { beep(660, 90); beep(660, 90, 0.16); buzz([30, 60, 30]); }
  }

  // ── Pantalla encendida mientras dura la sesión ──────────────────────────────
  let wake = null;
  const lockScreen = async () => { wake = await requestWake(); };
  const unlockScreen = () => { wake?.release?.().catch(() => {}); wake = null; };

  let timer = null;
  // La tarjeta del protocolo (fase 5) tiene un único plan fijo, con su configuración (duraciones y repeticiones).
  let plan = fixedPlan ?? PLANS[DEFAULT_PLAN];
  let planId = plan.id;
  const settingBox = fixedPlan ? { restSec: $(`${P}Rest`), naturalSec: $(`${P}Natural`), reps: $(`${P}Reps`) } : null;
  /** Configuración elegida en la tarjeta (solo el protocolo); siempre uno de los valores permitidos. */
  const readSettings = () => (settingBox ? cleanSettings(Object.fromEntries(Object.entries(settingBox).map(([k, b]) => [k, b?.value]))) : null);
  if (!fixedPlan) {
    el.plan.replaceChildren(...Object.values(PLANS).map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.label })));
    el.plan.value = planId;
  } else {
    for (const [k, b] of Object.entries(settingBox)) if (b) b.value = String(PROTOCOL_DEFAULTS[k]);
  }

  // Los campos del código avisan al escribir. El de Resultados manda al exportar (si existe); si no, el del principio.
  bindCodeField(el.code);
  bindCodeField($(`${P}ExportCode`));
  const exportCode = () => ($(`${P}ExportCode`) ? $(`${P}ExportCode`).value : el.code.value).trim();

  // Se declara antes de crear la sesión: su constructor ya llama a render (cambio de estado inicial).
  let lastState = null;
  const session = new GuidedSession(stepsOf(plan, readSettings()), {
    prepMs: scale() < 1 ? 600 : undefined,
    getPerf,
    onCue,
    onChange: (s) => render(s),
    onStepEnd: (result, step) => onStepEnd(result, step),
    onStepStart: (step) => onStepStart(step),
  });

  function viewFor(s) {
    if (s.state === 'prep' || s.state === 'running') return 'active';
    // Detenida sin ningún paso bueno: con intentos no válidos hay algo que descargar para diagnosticar.
    if (s.state === 'aborted') return s.completed || session.rejections?.length ? 'done' : 'idle';
    return s.state; // idle | review | done
  }

  function renderTick() {
    const s = session.snapshot();
    if (s.state !== 'prep' && s.state !== 'running') return;
    el.coachBar.style.width = `${Math.round(s.progress * 100)}%`;
    if (s.state === 'prep') {
      el.coachText.className = 'coach-text big';
      el.coachText.textContent = String(Math.max(1, Math.ceil(s.remainingMs / 1000)));
      el.coachTime.textContent = 'Prepárate';
    } else if (s.rep) {
      // Repeticiones: lo que toca ahora, en grande; el resto de la instrucción, en el paso.
      el.coachText.className = 'coach-text big';
      el.coachText.textContent = !s.rep.k ? 'Preparado…'
        : s.rep.holding ? `${s.rep.control ? 'Nada, quieto' : '¡Ahora!'} (${s.rep.k}/${s.rep.of})`
        : `Suelta (${s.rep.k}/${s.rep.of})`;
      el.coachTime.textContent = mmss(s.remainingMs);
    } else {
      el.coachText.className = 'coach-text';
      el.coachText.textContent = s.step.instruction;
      el.coachTime.textContent = mmss(s.remainingMs);
    }
  }

  function render(s) {
    root.dataset.state = viewFor(s);
    if (s.state !== lastState) {
      lastState = s.state;
      // Aviso a quien lo use (la grabación del vídeo del protocolo): estado nuevo, sesión y configuración.
      // El código escrito antes de empezar pasa al campo de Resultados, donde se puede corregir.
      if (s.state === 'done' && $(`${P}ExportCode`)) $(`${P}ExportCode`).value = el.code.value.trim();
      queueMicrotask(() => onState(s.state, session, { settings: readSettings(), code: exportCode() }));
    }
    const busy = s.state === 'prep' || s.state === 'running' || s.state === 'review';
    if (busy) document.body.dataset.busy = busyKey;
    else if (document.body.dataset.busy === busyKey) document.body.dataset.busy = '';
    const running = s.state === 'prep' || s.state === 'running';
    el.coach.hidden = !running;
    el.status.textContent = s.state === 'aborted' && s.step
      ? `Detenida en el paso ${s.index + 1} de ${s.total}`
      : s.step && s.state !== 'idle' && s.state !== 'done' ? `Paso ${s.index + 1} de ${s.total}` : '';
    // Con pasos ya guardados se puede volver atrás; sin ellos no hay nada que rehacer.
    el.prev.disabled = el.prevReview.disabled = !s.completed;

    if (running) {
      el.title.textContent = s.step.title;
      el.text.textContent = s.step.instruction;
      el.coachStep.textContent = `${s.index + 1}/${s.total} · ${s.step.title}${s.step.reps ? ` — ${s.step.instruction}` : ''}`;
      renderTick();
      timer ??= setInterval(() => { session.tick(); renderTick(); }, 100);
    } else if (s.autoAdvancing) {
      // Modo seguido: la revisión dura solo la pausa y se pasa sola al siguiente paso.
      timer ??= setInterval(() => { session.tick(); renderTick(); }, 100);
    } else if (timer) {
      clearInterval(timer);
      timer = null;
    }

    if (s.state === 'review') {
      const c = s.current;
      const interrupted = c.status === 'interrupted';
      const invalid = c.status === 'invalid';
      el.revTitle.textContent = `${s.step.title}${interrupted ? ' (interrumpido)' : invalid ? ' (no válido)' : ''}`;
      el.summary.textContent = interrupted ? `Interrumpido: ${c.interruptReason}. Repite el paso.` : describeSummary(c);
      const x = s.step.expect;
      const exp = !x ? '' : x.closures != null
        ? `Esperado: ${x.closures} cierres en cada ojo.`
        : `Esperado: I ${x.left}, D ${x.right} (parpadeos o cierres).`;
      const auto = s.autoAdvancing ? (invalid ? 'Modo seguido: el reposo se repite solo en unos segundos.' : 'Modo seguido: el siguiente paso empieza solo.') : '';
      el.expect.textContent = [auto, exp, s.step.hint].filter(Boolean).join(' ');
      $(`${P}Next`).disabled = invalid; // un reposo no válido no se da por bueno: hay que repetirlo
      el.countedRow.hidden = !s.step.countable;
      el.counted.value = c.user.counted ?? '';
      el.notes.value = c.user.notes ?? '';
    }
    if (s.state === 'done' || s.state === 'aborted' || s.state === 'idle') unlockScreen();
    if (s.state === 'done' || s.state === 'aborted') {
      const aborted = s.state === 'aborted';
      const sumEl = fixedPlan ? $(`${P}SummaryView`) : null;
      if (sumEl) renderSummary(sumEl, summarizeProtocol(session.results), session.results);
      el.share.hidden = !navigator.canShare;
      el.resume.hidden = !aborted;
      el.redoLast.hidden = !s.completed;
      el.doneTitle.textContent = aborted ? 'Sesión detenida' : fixedPlan ? 'Protocolo completo' : 'Prueba completa';
      el.doneText.textContent = aborted
        ? `Llevas ${s.completed} de ${s.total} pasos. Puedes retomar la sesión en el paso ${s.index + 1}, rehacer el último o descargar lo hecho. Contiene solo medidas numéricas, sin imágenes ni nombres.`
        : fixedPlan
          ? 'Descarga el archivo JSON con las series y el resumen de cada fase (sin imágenes ni nombres). Contiene solo medidas numéricas.'
          : 'Descarga el archivo y adjúntalo en la conversación con Claude. Contiene solo medidas numéricas (sin imágenes ni nombres) y el modelo de navegador del dispositivo.';
    }
  }

  // ── Informe ──────────────────────────────────────────────────────────────────
  const report = (includeSeries) =>
    buildReport({ results: session.results, startedAt: session.startedAt, code: el.code.value.trim() || null, plan: planId, settings: readSettings(), rejections: session.rejections, summary: fixedPlan ? summarizeProtocol(session.results) : null, includeSeries, ...getContext() });

  function fileName() {
    const code = el.code.value.trim().replace(/[^\w-]/g, '');
    return `orbicula-pruebas-${stamp()}${code ? `-${code}` : ''}.json`;
  }

  function download() {
    const { name, size } = downloadJson(report(true), fileName());
    el.msg.textContent = `Descargado: ${name} (${Math.round(size / 1024)} KB). Está en la carpeta de descargas del móvil.`;
  }

  async function share() {
    try {
      await shareJson(report(true), fileName(), 'Pruebas de orbicula');
      el.msg.textContent = 'Compartido.';
    } catch (err) {
      if (err?.name !== 'AbortError') el.msg.textContent = `No se pudo compartir (${err?.message ?? err}). Usa «Descargar JSON».`;
    }
  }

  async function copySummary() {
    try {
      await copyJson(report(false));
      el.msg.textContent = 'Resumen copiado (sin las series). Pégalo en la conversación.';
    } catch (err) {
      el.msg.textContent = `No se pudo copiar (${err?.message ?? err}). Usa «Descargar JSON».`;
    }
  }

  // Resultados (fase 7): el JSON público y los CSV, solo en la tarjeta del protocolo.
  if (exporter && $(`${P}ExportJson`)) {
    const say = (m) => showMessage($(`${P}ExportMsg`), m);
    $(`${P}ExportJson`).addEventListener('click', () => say(exporter.json(session.results, exportCode())));
    $(`${P}ExportCsv`).addEventListener('click', () => say(exporter.csv(session.results, exportCode())));
  }

  // ── Botones ──────────────────────────────────────────────────────────────────
  $(`${P}Start`).addEventListener('click', async () => {
    const busyNow = document.body.dataset.busy;
    if (busyNow && busyNow !== busyKey) { el.status.textContent = busyNow === 'bench' ? 'Hay una prueba de rendimiento en marcha' : 'Hay otra prueba en marcha'; return; }
    audio ??= (() => { try { return new AudioContext(); } catch { return null; } })(); // se crea con un gesto del usuario
    if (!fixedPlan) {
      plan = PLANS[el.plan.value] ?? PLANS[DEFAULT_PLAN];
      planId = plan.id;
    }
    session.steps = stepsOf(plan, readSettings());
    // Con voz, la cuenta atrás de cada paso dura lo que tarda en leer su explicación (salvo con ?escala).
    if (el.voice.checked && localVoice() && scale() === 1) {
      session.steps = session.steps.map((st, i) => ({ ...st, prepMs: spokenPrepMs(`Paso ${i + 1}: ${st.title}. ${st.say ?? ''}`) }));
    }
    session.autoAdvanceMs = el.auto.checked ? AUTO_PAUSE_MS : null;
    say(''); // la voz, como el audio, se activa con un gesto del usuario
    lockScreen();
    el.status.textContent = plan.flow ? 'Preparando el flujo óptico…' : '';
    try {
      await onStart(plan);
    } catch (err) {
      el.status.textContent = `No se pudo preparar: ${err?.message ?? err}`;
      unlockScreen();
      return;
    }
    el.status.textContent = '';
    session.start();
  });
  $(`${P}Finish`).addEventListener('click', () => session.finishStep());
  $(`${P}Skip`).addEventListener('click', () => session.skip());
  $(`${P}Abort`).addEventListener('click', () => session.abort());
  // Repetir y volver atrás no reinician las medidas: el reposo estimado se conserva.
  $(`${P}Repeat`).addEventListener('click', () => session.repeat());
  $(`${P}RepeatNow`).addEventListener('click', () => session.repeat());
  el.prev.addEventListener('click', () => session.previous());
  el.prevReview.addEventListener('click', () => session.previous());
  el.redoLast.addEventListener('click', () => { lockScreen(); session.previous(); });
  el.resume.addEventListener('click', () => { lockScreen(); session.resume(); });
  $(`${P}Next`).addEventListener('click', () => session.next());
  $(`${P}Download`).addEventListener('click', download);
  el.share.addEventListener('click', share);
  $(`${P}Copy`).addEventListener('click', copySummary);
  $(`${P}New`).addEventListener('click', () => { el.msg.textContent = ''; session.reset(); });
  el.counted.addEventListener('input', () => session.setUser({ counted: el.counted.value === '' ? null : Number(el.counted.value) }));
  el.notes.addEventListener('input', () => session.setUser({ notes: el.notes.value }));

  // Preferencias de comodidad (si el almacenamiento falla, no pasa nada).
  for (const [box, key] of [[el.auto, `${P}Auto`], [el.voice, `${P}Voice`]]) {
    try {
      const v = localStorage.getItem(`orbicula.${key}`);
      if (v != null) box.checked = v === '1';
    } catch { /* sin almacenamiento */ }
    box.addEventListener('change', () => { try { localStorage.setItem(`orbicula.${key}`, box.checked ? '1' : '0'); } catch { /* nada */ } });
  }
  // Durante la sesión se puede cambiar el modo seguido (p. ej. para revisar un paso concreto).
  el.auto.addEventListener('change', () => { session.autoAdvanceMs = el.auto.checked ? AUTO_PAUSE_MS : null; });

  render(session.snapshot());

  return {
    show: () => { root.hidden = false; },
    /** Una muestra del análisis; solo se guarda mientras se graba un paso. */
    record: (t, sample, events) => session.record(t, sample, events),
    /** Un par de flujo procesado; solo se guarda mientras se graba un paso. */
    recordFlow: (sample) => session.recordFlow(sample),
    /** Un evento de la fase 5 (contracción, parpadeo…); se guarda en el paso en curso. */
    recordDetection: (e) => session.recordDetection(e),
    /** La cámara se reinició, etc.: el paso en curso queda interrumpido. */
    interrupt: (reason) => session.interrupt(reason),
    /** El hub oculta orbicula: se detiene la sesión conservando lo ya hecho (como «Detener», con «Retomar sesión»). */
    halt: (reason) => { session.interrupt(reason); session.abort(); },
    /** Estado de la tarjeta: 'idle', 'active', 'review' o 'done'. */
    get view() { return root.dataset.state; },
  };
}
