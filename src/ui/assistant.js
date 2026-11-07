// Asistente de pruebas: guía paso a paso (GuidedSession), avisa sobre el vídeo con la cuenta
// atrás y guarda el registro como un JSON que se descarga o se comparte. Todo en el
// dispositivo: no hay ninguna llamada de red.
import { GuidedSession, AUTO_PAUSE_MS } from '../assistant/session.js';
import { PLANS, DEFAULT_PLAN, spokenPrepMs } from '../assistant/steps.js';
import { buildReport, describeSummary } from '../assistant/report.js';
import { downloadJson, shareJson, copyJson, stamp } from './share.js';

const $ = (id) => document.getElementById(id);

/** `?escala=0.2` acorta las duraciones (para comprobar el flujo rápido); por defecto 1. */
function scale() {
  const k = Number(new URLSearchParams(location.search).get('escala'));
  return k > 0 && k < 1 ? k : 1;
}

/** Pasos de un plan, acortados con `?escala` y marcados con si necesitan el flujo. */
function stepsOf(planId) {
  const plan = PLANS[planId] ?? PLANS[DEFAULT_PLAN];
  const k = scale();
  const shorten = (ms, min) => (k < 1 ? Math.max(min, Math.round(ms * k)) : ms);
  return plan.steps.map((s) => ({
    ...s,
    flow: plan.flow,
    durationMs: shorten(s.durationMs, 1500),
    ...(s.reps ? { reps: { ...s.reps, everyMs: shorten(s.reps.everyMs, 800), holdMs: shorten(s.reps.holdMs, 300), offsetMs: shorten(s.reps.offsetMs, 300) } } : {}),
  })).map((s) => (s.reps && k < 1 ? { ...s, durationMs: s.reps.offsetMs + s.reps.count * s.reps.everyMs } : s));
}

const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.ceil((ms % 60000) / 1000) % 60)}`;

/**
 * @param {{getContext: () => object, getPerf: () => object|null, onStart: (plan: object) => Promise<void>|void}} deps
 *   getContext: build, device, capture, analysis, flujo y detector para el informe
 *   onStart: se llama al empezar una sesión (la app reinicia sus medidas y, si el plan lo pide, enciende el flujo)
 */
export function createAssistant({ getContext, getPerf, onStart }) {
  const root = $('assistant');
  const el = {
    status: $('asStatus'), code: $('asCode'), sound: $('asSound'), auto: $('asAuto'), voice: $('asVoice'),
    title: $('asTitle'), text: $('asText'),
    revTitle: $('asRevTitle'), summary: $('asSummary'), expect: $('asExpect'),
    countedRow: $('asCountedRow'), counted: $('asCounted'), notes: $('asNotes'),
    msg: $('asMsg'), share: $('asShare'),
    prev: $('asPrev'), prevReview: $('asPrevReview'), resume: $('asResume'), redoLast: $('asRedoLast'),
    doneTitle: $('asDoneTitle'), doneText: $('asDoneText'), plan: $('asPlan'),
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
    else if (cue === 'end') { beep(660); beep(660, 130, 0.22); buzz([80, 60, 80]); }
    else if (cue === 'done') { beep(660); beep(880, 130, 0.18); beep(1100, 200, 0.36); buzz([100, 60, 100, 60, 200]); say('Prueba terminada.'); }
    // Repeticiones: agudo y largo = «ahora»; grave = «suelta».
    else if (cue === 'hold') { beep(1175, 260); buzz(120); }
    else if (cue === 'release') { beep(392, 220); buzz(40); }
  }

  // ── Pantalla encendida mientras dura la sesión ──────────────────────────────
  let wake = null;
  const lockScreen = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } };
  const unlockScreen = () => { wake?.release?.().catch(() => {}); wake = null; };

  let timer = null;
  let planId = DEFAULT_PLAN;
  el.plan.replaceChildren(...Object.values(PLANS).map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.label })));
  el.plan.value = planId;

  const session = new GuidedSession(stepsOf(planId), {
    prepMs: scale() < 1 ? 600 : undefined,
    getPerf,
    onCue,
    onChange: (s) => render(s),
  });

  function viewFor(s) {
    if (s.state === 'prep' || s.state === 'running') return 'active';
    if (s.state === 'aborted') return s.completed ? 'done' : 'idle';
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
      el.coachText.textContent = !s.rep.k ? 'Preparado…' : s.rep.holding ? `¡Ahora! (${s.rep.k}/${s.rep.of})` : `Suelta (${s.rep.k}/${s.rep.of})`;
      el.coachTime.textContent = mmss(s.remainingMs);
    } else {
      el.coachText.className = 'coach-text';
      el.coachText.textContent = s.step.instruction;
      el.coachTime.textContent = mmss(s.remainingMs);
    }
  }

  function render(s) {
    root.dataset.state = viewFor(s);
    const busy = s.state === 'prep' || s.state === 'running' || s.state === 'review';
    if (busy) document.body.dataset.busy = 'assistant';
    else if (document.body.dataset.busy === 'assistant') document.body.dataset.busy = '';
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
      el.revTitle.textContent = `${s.step.title}${interrupted ? ' (interrumpido)' : ''}`;
      el.summary.textContent = interrupted ? `Interrumpido: ${c.interruptReason}. Repite el paso.` : describeSummary(c);
      const x = s.step.expect;
      const exp = !x ? '' : x.closures != null
        ? `Esperado: ${x.closures} cierres en cada ojo.`
        : `Esperado: I ${x.left}, D ${x.right} (parpadeos o cierres).`;
      el.expect.textContent = [s.autoAdvancing ? 'Modo seguido: el siguiente paso empieza solo.' : '', exp, s.step.hint].filter(Boolean).join(' ');
      el.countedRow.hidden = !s.step.countable;
      el.counted.value = c.user.counted ?? '';
      el.notes.value = c.user.notes ?? '';
    }
    if (s.state === 'done' || s.state === 'aborted' || s.state === 'idle') unlockScreen();
    if (s.state === 'done' || s.state === 'aborted') {
      const aborted = s.state === 'aborted';
      el.share.hidden = !navigator.canShare;
      el.resume.hidden = !aborted;
      el.redoLast.hidden = !s.completed;
      el.doneTitle.textContent = aborted ? 'Sesión detenida' : 'Prueba completa';
      el.doneText.textContent = aborted
        ? `Llevas ${s.completed} de ${s.total} pasos. Puedes retomar la sesión en el paso ${s.index + 1}, rehacer el último o descargar lo hecho. Contiene solo medidas numéricas, sin imágenes ni nombres.`
        : 'Descarga el archivo y adjúntalo en la conversación con Claude. Contiene solo medidas numéricas (sin imágenes ni nombres) y el modelo de navegador del dispositivo.';
    }
  }

  // ── Informe ──────────────────────────────────────────────────────────────────
  const report = (includeSeries) =>
    buildReport({ results: session.results, startedAt: session.startedAt, code: el.code.value.trim() || null, plan: planId, includeSeries, ...getContext() });

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

  // ── Botones ──────────────────────────────────────────────────────────────────
  $('asStart').addEventListener('click', async () => {
    if (document.body.dataset.busy === 'bench') { el.status.textContent = 'Hay una prueba de rendimiento en marcha'; return; }
    audio ??= (() => { try { return new AudioContext(); } catch { return null; } })(); // se crea con un gesto del usuario
    planId = el.plan.value in PLANS ? el.plan.value : DEFAULT_PLAN;
    session.steps = stepsOf(planId);
    // Con voz, la cuenta atrás de cada paso dura lo que tarda en leer su explicación (salvo con ?escala).
    if (el.voice.checked && localVoice() && scale() === 1) {
      session.steps = session.steps.map((st, i) => ({ ...st, prepMs: spokenPrepMs(`Paso ${i + 1}: ${st.title}. ${st.say ?? ''}`) }));
    }
    session.autoAdvanceMs = el.auto.checked ? AUTO_PAUSE_MS : null;
    say(''); // la voz, como el audio, se activa con un gesto del usuario
    lockScreen();
    el.status.textContent = PLANS[planId].flow ? 'Preparando el flujo óptico…' : '';
    try {
      await onStart(PLANS[planId]);
    } catch (err) {
      el.status.textContent = `No se pudo preparar: ${err?.message ?? err}`;
      unlockScreen();
      return;
    }
    el.status.textContent = '';
    session.start();
  });
  $('asFinish').addEventListener('click', () => session.finishStep());
  $('asSkip').addEventListener('click', () => session.skip());
  $('asAbort').addEventListener('click', () => session.abort());
  // Repetir y volver atrás no reinician las medidas: el reposo estimado se conserva.
  $('asRepeat').addEventListener('click', () => session.repeat());
  $('asRepeatNow').addEventListener('click', () => session.repeat());
  el.prev.addEventListener('click', () => session.previous());
  el.prevReview.addEventListener('click', () => session.previous());
  el.redoLast.addEventListener('click', () => { lockScreen(); session.previous(); });
  el.resume.addEventListener('click', () => { lockScreen(); session.resume(); });
  $('asNext').addEventListener('click', () => session.next());
  $('asDownload').addEventListener('click', download);
  el.share.addEventListener('click', share);
  $('asCopy').addEventListener('click', copySummary);
  $('asNew').addEventListener('click', () => { el.msg.textContent = ''; session.reset(); });
  el.counted.addEventListener('input', () => session.setUser({ counted: el.counted.value === '' ? null : Number(el.counted.value) }));
  el.notes.addEventListener('input', () => session.setUser({ notes: el.notes.value }));

  // Preferencias de comodidad (si el almacenamiento falla, no pasa nada).
  for (const [box, key] of [[el.auto, 'asAuto'], [el.voice, 'asVoice']]) {
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
    /** La cámara se reinició, etc.: el paso en curso queda interrumpido. */
    interrupt: (reason) => session.interrupt(reason),
  };
}
