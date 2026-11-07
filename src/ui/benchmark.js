// Prueba de rendimiento: ejecuta sola las pasadas (worker / hilo principal × con / sin
// blendshapes), registra cada análisis y exporta un JSON. Ver src/assistant/benchmark.js.
import { WorkerAnalysis } from '../landmarks/worker-client.js';
import { Analysis } from '../landmarks/analysis.js';
import { buildPlan, summarizeRun, buildBenchmarkReport, groupSummary } from '../assistant/benchmark.js';
import { downloadJson, shareJson, copyJson, stamp } from './share.js';
import { createCues } from './cues.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const MODE_LABEL = { worker: 'Worker', main: 'Hilo principal' };

/** `?escala=0.25` acorta las pasadas (para comprobar el flujo rápido); por defecto 12 s con 3 s de calentamiento. */
function params() {
  const k = Number(new URLSearchParams(location.search).get('escala'));
  const runMs = k > 0 && k < 1 ? Math.max(2500, Math.round(12000 * k)) : 12000;
  // Tiempo para colocar el móvil tras pulsar «Empezar» (con la trasera no se ve la pantalla).
  const leadMs = k > 0 && k < 1 ? Math.max(2000, Math.round(10000 * k)) : 10000;
  return { runMs, warmupMs: Math.min(3000, Math.round(runMs * 0.25)), leadMs };
}

/**
 * @param {{camera: object, video: HTMLVideoElement, ensureAnalysis: () => Promise<object|null>,
 *          getBlendshapes: () => boolean, getContext: () => object, onStart: () => void}} deps
 */
export function createBenchmark({ camera, video, ensureAnalysis, getBlendshapes, getContext, onStart }) {
  const root = $('bench');
  const el = {
    status: $('bStatus'), title: $('bTitle'), text: $('bText'), bar: $('bBar'), table: $('bTable'), note: $('bNote'), msg: $('bMsg'),
    share: $('bShare'),
    coach: $('coach'), coachStep: $('coachStep'), coachTime: $('coachTime'), coachText: $('coachText'), coachBar: $('coachBar'),
  };
  let runs = [];
  let startedAt = null;
  let runMs = 12000;
  let warmupMs = 3000;
  let leadMs = 10000;
  let cancelled = null; // motivo, si se cancela
  const cues = createCues(() => $('bSound').checked);
  let wake = null;

  const setState = (s) => { root.dataset.state = s; };

  function showProgress(text, title, frac, remainingMs) {
    el.title.textContent = title;
    el.text.textContent = text;
    el.bar.style.width = `${Math.round(frac * 100)}%`;
    el.coach.hidden = false;
    el.coachStep.textContent = title;
    el.coachTime.textContent = remainingMs == null ? '' : `${Math.ceil(remainingMs / 1000)} s`;
    el.coachText.className = 'coach-text';
    el.coachText.textContent = text;
    el.coachBar.style.width = `${Math.round(frac * 100)}%`;
  }

  /** Una pasada: recoge cada resultado, los repintados y las tareas largas del hilo principal. */
  async function runOne(plan, inst, label) {
    const raw = { tRel: [], inferMs: [], latencyMs: [], bitmapMs: [], roundTripMs: [], faces: [], camT: [], camPresented: [], rafMs: [], longTasks: [] };
    const t0 = performance.now();
    let lastFaceAt = t0;
    let lastWarnAt = 0;
    inst.onResult = (r) => {
      const now = performance.now();
      if (r.face) lastFaceAt = now;
      raw.tRel.push(now - t0);
      raw.inferMs.push(r.ms);
      raw.latencyMs.push(now - r.t);
      raw.bitmapMs.push(r.bitmapMs ?? null);
      raw.roundTripMs.push(r.roundTripMs ?? null);
      raw.faces.push(!!r.face);
    };
    camera.onVideoFrame = (now, meta) => {
      raw.camT.push(performance.now() - t0);
      raw.camPresented.push(meta?.presentedFrames ?? null);
      inst.submit(video, meta?.captureTime ?? now);
    };

    let running = true;
    let last = null;
    const loop = (ts) => {
      if (!running) return;
      if (last != null) raw.rafMs.push({ t: ts - t0, d: ts - last });
      last = ts;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    let po = null;
    try {
      po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) raw.longTasks.push({ t: e.startTime - t0, d: e.duration });
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch { /* el navegador no da tareas largas */ }

    while (performance.now() - t0 < runMs && !cancelled) {
      const done = performance.now() - t0;
      const warm = done < warmupMs;
      const faceLost = performance.now() - lastFaceAt > 2000;
      // Sin mirar la pantalla, un tono grave cada 3 s avisa de que la cara no se ve.
      if (faceLost && performance.now() - lastWarnAt > 3000) {
        lastWarnAt = performance.now();
        cues.warn();
      }
      showProgress(
        faceLost ? 'No se ve la cara: recoloca el móvil.' : `${warm ? 'Calentando… ' : ''}Quieto y de frente a la cámara.`,
        `Pasada ${plan.index} de ${plan.total} · ${label}`,
        (plan.index - 1 + done / runMs) / plan.total,
        runMs - done,
      );
      await sleep(100);
    }
    running = false;
    po?.disconnect();
    camera.onVideoFrame = null;
    inst.onResult = null;
    const durationMs = performance.now() - t0;
    // Se espera a que vuelvan los frames que quedaban en el worker, para que no ensucien la siguiente pasada.
    for (let i = 0; i < 10 && inst.inflight > 0; i++) await sleep(100);
    return { raw, durationMs };
  }

  async function start() {
    const busy = document.body.dataset.busy;
    if (busy && busy !== 'bench') {
      el.status.textContent = 'Termina o detén el asistente de pruebas antes';
      return;
    }
    document.body.dataset.busy = 'bench';
    cues.unlock(); // dentro del clic: si no, el navegador no deja sonar
    try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } // si la pantalla se apaga, la cámara se para
    cancelled = null;
    runs = [];
    ({ runMs, warmupMs, leadMs } = params());
    setState('active');
    onStart();
    el.msg.textContent = '';
    el.status.textContent = '';
    showProgress('Cargando los modelos…', 'Preparando', 0, null);

    const prevHandler = camera.onVideoFrame;
    let base = null;
    let baseOnResult = null;
    let other = null;
    try {
      base = await ensureAnalysis();
      if (!base) throw new Error('el modelo de la cara no está cargado');
      baseOnResult = base.onResult;
      other = base.mode === 'worker' ? new Analysis() : new WorkerAnalysis();
      await other.load(true);
      const inst = { [base.mode]: base, [other.mode]: other };

      // Cuenta atrás para colocar el móvil: no cuenta en la medida.
      const leadStart = performance.now();
      let lastTick = Infinity;
      while (performance.now() - leadStart < leadMs && !cancelled) {
        const left = leadMs - (performance.now() - leadStart);
        showProgress('Coloca el móvil enfocándote la cara, a unos 40 cm, y quédate quieto.', 'Colócate', (performance.now() - leadStart) / leadMs, left);
        const secs = Math.ceil(left / 1000);
        if (secs <= 3 && secs < lastTick) { lastTick = secs; cues.tick(); }
        await sleep(100);
      }
      if (cancelled) throw new Error(cancelled);
      cues.go();

      const plan = buildPlan().map((p, _, all) => ({ ...p, total: all.length }));
      startedAt = new Date().toISOString();
      const tStart = performance.now();
      for (const p of plan) {
        if (cancelled) break;
        const label = `${MODE_LABEL[p.mode]} · ${p.blendshapes ? 'con' : 'sin'} blendshapes`;
        showProgress('Cambiando de configuración…', `Pasada ${p.index} de ${p.total} · ${label}`, (p.index - 1) / p.total, null);
        await inst[p.mode].setBlendshapes(p.blendshapes);
        const runStart = performance.now();
        const { raw, durationMs } = await runOne(p, inst[p.mode], label);
        if (cancelled) break;
        runs.push({
          index: p.index, round: p.round, mode: p.mode, blendshapes: p.blendshapes, status: 'completed',
          startedAtMs: Math.round(runStart - tStart), durationMs: Math.round(durationMs),
          summary: summarizeRun(raw, { warmupMs }),
          series: { tRel: raw.tRel.map(Math.round), inferMs: raw.inferMs.map(r1) },
        });
      }
      if (cancelled && !runs.length) throw new Error(cancelled);
      finish(!!cancelled);
      if (cancelled) cues.warn();
      else cues.end();
    } catch (err) {
      el.status.textContent = `No se pudo completar: ${err?.message ?? err}`;
      cues.warn();
      setState(runs.length ? 'done' : 'idle');
      if (runs.length) finish(true);
    } finally {
      camera.onVideoFrame = prevHandler;
      if (base) {
        base.onResult = baseOnResult;
        try { await base.setBlendshapes(getBlendshapes()); } catch { /* ya está liberado */ }
      }
      other?.dispose();
      wake?.release?.().catch(() => {});
      wake = null;
      el.coach.hidden = true;
      if (document.body.dataset.busy === 'bench') document.body.dataset.busy = '';
    }
  }

  function finish(partial) {
    setState('done');
    const g = groupSummary(runs);
    const rows = g.groups.filter((x) => x.runs);
    el.table.replaceChildren(
      Object.assign(document.createElement('caption'), { textContent: partial ? 'Resultados parciales (media de las pasadas hechas)' : 'Resultados (media de 2 pasadas por combinación)' }),
      ...[['Modo', 'Blend.', 'ms', 'análisis/s', 'cámara', 'tirones']].map((cells) => {
        const tr = document.createElement('tr');
        for (const c of cells) tr.append(Object.assign(document.createElement('th'), { textContent: c }));
        return tr;
      }),
      ...rows.map((x) => {
        const tr = document.createElement('tr');
        const cells = [x.mode === 'worker' ? 'Worker' : 'Princ.', x.blendshapes ? 'sí' : 'no', x.inferMsMean?.toFixed(1), x.analysisFps?.toFixed(1), x.cameraFps?.toFixed(1), x.over50ms?.toFixed(0)];
        for (const c of cells) tr.append(Object.assign(document.createElement('td'), { textContent: c ?? '—' }));
        return tr;
      }),
    );
    const faces = runs.map((r) => r.summary.faceFraction).filter((v) => v != null);
    const minFace = faces.length ? Math.min(...faces) : null;
    const e = g.effects;
    const sign = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)} ms`);
    el.note.textContent =
      'ms = lo que tarda cada análisis; cámara = fps; tirones = repintados de pantalla de más de 50 ms (menos es más fluido). ' +
      `Worker frente a hilo principal: ${sign(e.workerMinusMain_withBlendshapes)} con blendshapes y ${sign(e.workerMinusMain_withoutBlendshapes)} sin ellos. ` +
      `Blendshapes encendidos frente a apagados: ${sign(e.blendshapesOnMinusOff_worker)} en worker y ${sign(e.blendshapesOnMinusOff_main)} en hilo principal. ` +
      (minFace != null && minFace < 0.9 ? `Ojo: en alguna pasada la cara solo se detectó en el ${Math.round(minFace * 100)} % de los análisis.` : 'Cara detectada durante casi toda la prueba.');
    el.share.hidden = !navigator.canShare;
  }

  const report = (includeSeries) => {
    const ctx = getContext();
    return buildBenchmarkReport({ runs, startedAt, runMs, warmupMs, includeSeries, build: ctx.build, device: ctx.device, capture: ctx.capture, analysis: ctx.analysis });
  };
  const fileName = () => `orbicula-rendimiento-${stamp()}.json`;

  $('bStart').addEventListener('click', start);
  $('bAgain').addEventListener('click', () => { runs = []; setState('idle'); el.msg.textContent = ''; });
  $('bCancel').addEventListener('click', () => { cancelled = 'cancelado'; });
  $('bDownload').addEventListener('click', () => {
    const { name, size } = downloadJson(report(true), fileName());
    el.msg.textContent = `Descargado: ${name} (${Math.round(size / 1024)} KB). Está en la carpeta de descargas del móvil.`;
  });
  el.share.addEventListener('click', async () => {
    try {
      await shareJson(report(true), fileName(), 'Prueba de rendimiento de orbicula');
      el.msg.textContent = 'Compartido.';
    } catch (err) {
      if (err?.name !== 'AbortError') el.msg.textContent = `No se pudo compartir (${err?.message ?? err}). Usa «Descargar JSON».`;
    }
  });
  $('bCopy').addEventListener('click', async () => {
    try {
      await copyJson(report(false));
      el.msg.textContent = 'Resumen copiado (sin las series). Pégalo en la conversación.';
    } catch (err) {
      el.msg.textContent = `No se pudo copiar (${err?.message ?? err}). Usa «Descargar JSON».`;
    }
  });

  return {
    show: () => { root.hidden = false; },
    /** La cámara se reinició: la pasada en curso se cancela (lo ya medido se conserva). */
    interrupt: (reason) => { if (root.dataset.state === 'active') cancelled = reason; },
  };
}
