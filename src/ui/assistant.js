// Asistente de pruebas: guía paso a paso (GuidedSession), avisa sobre el vídeo con la cuenta
// atrás y guarda el registro como un JSON que se descarga o se comparte. Todo en el
// dispositivo: no hay ninguna llamada de red.
import { GuidedSession } from '../assistant/session.js';
import { PHASE3_STEPS } from '../assistant/steps.js';
import { buildReport, describeSummary } from '../assistant/report.js';

const $ = (id) => document.getElementById(id);

/** `?escala=0.2` acorta las duraciones (para comprobar el flujo rápido); por defecto 1. */
function stepsForRun() {
  const k = Number(new URLSearchParams(location.search).get('escala'));
  if (!(k > 0 && k < 1)) return { steps: PHASE3_STEPS, prepMs: undefined };
  return {
    steps: PHASE3_STEPS.map((s) => ({ ...s, durationMs: Math.max(1500, Math.round(s.durationMs * k)) })),
    prepMs: 600,
  };
}

const pad = (n) => String(n).padStart(2, '0');
const mmss = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.ceil((ms % 60000) / 1000) % 60)}`;

/**
 * @param {{getContext: () => object, getPerf: () => object|null, onStart: () => void}} deps
 *   getContext: build, device, capture, analysis y detector para el informe
 *   onStart: se llama al empezar una sesión (la app reinicia sus medidas)
 */
export function createAssistant({ getContext, getPerf, onStart }) {
  const root = $('assistant');
  const el = {
    status: $('asStatus'), code: $('asCode'), sound: $('asSound'),
    title: $('asTitle'), text: $('asText'),
    revTitle: $('asRevTitle'), summary: $('asSummary'), expect: $('asExpect'),
    countedRow: $('asCountedRow'), counted: $('asCounted'), notes: $('asNotes'),
    msg: $('asMsg'), share: $('asShare'),
    prev: $('asPrev'), prevReview: $('asPrevReview'), resume: $('asResume'), redoLast: $('asRedoLast'),
    doneTitle: $('asDoneTitle'), doneText: $('asDoneText'),
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
  function onCue(cue) {
    if (cue === 'prep') { beep(440); buzz(40); }
    else if (cue === 'go') { beep(880, 200); buzz(150); }
    else if (cue === 'end') { beep(660); beep(660, 130, 0.22); buzz([80, 60, 80]); }
    else if (cue === 'done') { beep(660); beep(880, 130, 0.18); beep(1100, 200, 0.36); buzz([100, 60, 100, 60, 200]); }
  }

  // ── Pantalla encendida mientras dura la sesión ──────────────────────────────
  let wake = null;
  const lockScreen = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } };
  const unlockScreen = () => { wake?.release?.().catch(() => {}); wake = null; };

  const { steps, prepMs } = stepsForRun();
  let timer = null;

  const session = new GuidedSession(steps, {
    prepMs,
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
    } else {
      el.coachText.className = 'coach-text';
      el.coachText.textContent = s.step.instruction;
      el.coachTime.textContent = mmss(s.remainingMs);
    }
  }

  function render(s) {
    root.dataset.state = viewFor(s);
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
      el.coachStep.textContent = `${s.index + 1}/${s.total} · ${s.step.title}`;
      renderTick();
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
      el.expect.textContent = [exp, s.step.hint].filter(Boolean).join(' ');
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
    buildReport({ results: session.results, startedAt: session.startedAt, code: el.code.value.trim() || null, includeSeries, ...getContext() });

  function fileName() {
    const d = new Date();
    const code = el.code.value.trim().replace(/[^\w-]/g, '');
    return `orbicula-pruebas-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${code ? `-${code}` : ''}.json`;
  }

  function download() {
    const blob = new Blob([JSON.stringify(report(true))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    el.msg.textContent = `Descargado: ${a.download} (${Math.round(blob.size / 1024)} KB). Está en la carpeta de descargas del móvil.`;
  }

  async function share() {
    const file = new File([JSON.stringify(report(true))], fileName(), { type: 'application/json' });
    try {
      if (!navigator.canShare?.({ files: [file] })) throw new Error('no se puede compartir archivos');
      await navigator.share({ files: [file], title: 'Pruebas de orbicula' });
      el.msg.textContent = 'Compartido.';
    } catch (err) {
      if (err?.name !== 'AbortError') el.msg.textContent = `No se pudo compartir (${err?.message ?? err}). Usa «Descargar JSON».`;
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report(false), null, 1));
      el.msg.textContent = 'Resumen copiado (sin las series). Pégalo en la conversación.';
    } catch (err) {
      el.msg.textContent = `No se pudo copiar (${err?.message ?? err}). Usa «Descargar JSON».`;
    }
  }

  // ── Botones ──────────────────────────────────────────────────────────────────
  $('asStart').addEventListener('click', () => {
    audio ??= (() => { try { return new AudioContext(); } catch { return null; } })(); // se crea con un gesto del usuario
    onStart();
    lockScreen();
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

  render(session.snapshot());

  return {
    show: () => { root.hidden = false; },
    /** Una muestra del análisis; solo se guarda mientras se graba un paso. */
    record: (t, sample, events) => session.record(t, sample, events),
    /** La cámara se reinició, etc.: el paso en curso queda interrumpido. */
    interrupt: (reason) => session.interrupt(reason),
  };
}
