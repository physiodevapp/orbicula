// Prueba de rendimiento del flujo óptico: ejecuta sola las pasadas (una por configuración del
// flujo, más una sin flujo), con el análisis de la cara a la vez, registra cada resultado y exporta
// un JSON. Ver src/assistant/benchmark.js.
import { buildPlan, summarizeRun, buildBenchmarkReport, groupSummary, flowRaw } from '../assistant/benchmark.js';
import { FLOW_CONFIGS, OPENCV_VERSION, FARNEBACK, FARNEBACK_LITE, LUCAS_KANADE } from '../flow/config.js';
import { downloadJson, shareJson, copyJson, stamp } from './share.js';
import { createCues } from './cues.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

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
 *          ensureFlow: () => Promise<object>, getBlendshapes: () => boolean, getContext: () => object,
 *          onStart: () => void, onEnd: () => void}} deps
 */
export function createBenchmark({ camera, video, ensureAnalysis, ensureFlow, getBlendshapes, getContext, onStart, onEnd }) {
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
  let flowInfo = null; // datos del flujo para el informe (versión, parámetros, carga)
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

  /** Una pasada: recoge cada resultado (cara y flujo), los repintados y las tareas largas del hilo principal. */
  async function runOne(plan, inst, flow, label) {
    const raw = { tRel: [], inferMs: [], latencyMs: [], bitmapMs: [], roundTripMs: [], faces: [], camT: [], camPresented: [], rafMs: [], longTasks: [] };
    const withFlow = plan.method !== 'none';
    if (withFlow) raw.flow = flowRaw();
    const t0 = performance.now();
    let lastFaceAt = t0;
    let lastWarnAt = 0;
    let countsAtWarmup = null;
    flow.resetCounts();
    inst.onResult = (r) => {
      const now = performance.now();
      flow.setFace(r); // la franja sigue a la cara también en la pasada sin flujo
      if (r.face) lastFaceAt = now;
      raw.tRel.push(now - t0);
      raw.inferMs.push(r.ms);
      raw.latencyMs.push(now - r.t);
      raw.bitmapMs.push(r.bitmapMs ?? null);
      raw.roundTripMs.push(r.roundTripMs ?? null);
      raw.faces.push(!!r.face);
    };
    flow.onResult = (m) => {
      if (!withFlow) return;
      const now = performance.now();
      const f = raw.flow;
      f.t.push(now - t0);
      f.paired.push(m.paired);
      f.flowMs.push(m.flowMs);
      f.readMs.push(m.readMs);
      f.prepMs.push(m.prepMs);
      f.totalMs.push(m.totalMs);
      f.cropMs.push(m.cropMs ?? null);
      f.latencyMs.push(now - m.t);
      f.roundTripMs.push(m.roundTripMs ?? null);
      f.dt.push(m.dt);
      const src = m.sourceNote ? `${m.source}: ${m.sourceNote}` : m.source;
      f.sources[src] = (f.sources[src] ?? 0) + 1;
      f.size = m.size;
    };
    camera.onVideoFrame = (now, meta) => {
      raw.camT.push(performance.now() - t0);
      raw.camPresented.push(meta?.presentedFrames ?? null);
      const t = meta?.captureTime ?? now;
      inst.submit(video, t);
      if (withFlow) flow.submit(video, t);
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
      if (!warm && !countsAtWarmup) countsAtWarmup = { ...flow.counts };
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
    if (withFlow) {
      const end = flow.counts;
      const start = countsAtWarmup ?? {};
      raw.flow.counts = Object.fromEntries(Object.keys(end).map((k) => [k, end[k] - (start[k] ?? 0)]));
      raw.flow.strip = flow.strip ? { ...flow.strip } : null;
    }
    // Se espera a que vuelvan los frames que quedaban en los workers, para que no ensucien la siguiente pasada.
    for (let i = 0; i < 10 && (inst.inflight > 0 || flow.inflight > 0); i++) await sleep(100);
    flow.onResult = null;
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
    let flow = null;
    let flowOnResult = null;
    let flowConfig = null;
    try {
      base = await ensureAnalysis();
      if (!base) throw new Error('el modelo de la cara no está cargado');
      baseOnResult = base.onResult;
      showProgress('Cargando OpenCV.js (13 MB la primera vez)…', 'Preparando', 0, null);
      flow = await ensureFlow();
      flowOnResult = flow.onResult;
      flowConfig = flow.config.key;
      flowInfo = { library: 'OpenCV.js', version: OPENCV_VERSION, loadMs: r1(flow.loadMs), farneback: FARNEBACK, farnebackLite: FARNEBACK_LITE, lucasKanade: LUCAS_KANADE, videoFrame: typeof VideoFrame === 'function' };
      // Punto de trabajo de la fase 3: análisis de la cara con blendshapes.
      await base.setBlendshapes(true);

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
        const label = FLOW_CONFIGS[p.flow].label;
        showProgress('Cambiando de configuración…', `Pasada ${p.index} de ${p.total} · ${label}`, (p.index - 1) / p.total, null);
        if (p.method !== 'none') flow.setConfig(p.flow);
        await sleep(300);
        const runStart = performance.now();
        const { raw, durationMs } = await runOne(p, base, flow, label);
        if (cancelled) break;
        const paired = raw.flow ? raw.flow.t.map((t, i) => i).filter((i) => raw.flow.paired[i]) : [];
        runs.push({
          index: p.index, round: p.round, flow: p.flow, status: 'completed',
          startedAtMs: Math.round(runStart - tStart), durationMs: Math.round(durationMs),
          summary: summarizeRun(raw, { warmupMs }),
          series: {
            tRel: raw.tRel.map(Math.round), inferMs: raw.inferMs.map(r1),
            ...(raw.flow ? { flowT: paired.map((i) => Math.round(raw.flow.t[i])), flowMs: paired.map((i) => r1(raw.flow.flowMs[i])), workerMs: paired.map((i) => r1(raw.flow.totalMs[i])) } : {}),
          },
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
      if (flow) {
        flow.onResult = flowOnResult;
        flow.setConfig(flowConfig);
      }
      onEnd?.();
      wake?.release?.().catch(() => {});
      wake = null;
      el.coach.hidden = true;
      if (document.body.dataset.busy === 'bench') document.body.dataset.busy = '';
    }
  }

  /** Si el plano Y no se pudo leer (el móvil da los frames en la GPU), se dice qué se usó en su lugar. */
  function sourcesNote(rows) {
    const used = new Set(rows.filter((x) => x.source === 'videoframe').flatMap((x) => Object.keys(x.sources)));
    if (!used.size) return '';
    return [...used].every((k) => k.startsWith('y-plane')) ? 'Plano Y leído directamente del frame. ' : `Origen de la imagen en las pasadas «Y»: ${[...used].join(', ')}. `;
  }

  function finish(partial) {
    setState('done');
    const g = groupSummary(runs);
    const rows = g.groups.filter((x) => x.runs);
    const f1 = (v) => (v == null ? '—' : v.toFixed(1));
    el.table.replaceChildren(
      Object.assign(document.createElement('caption'), { textContent: partial ? 'Resultados parciales (media de las pasadas hechas)' : 'Resultados (media de 2 pasadas por configuración)' }),
      ...[['Flujo', 'pares/s', 'ms flujo', 'ms copia', 'ms total', 'análisis/s', 'cámara']].map((cells) => {
        const tr = document.createElement('tr');
        for (const c of cells) tr.append(Object.assign(document.createElement('th'), { textContent: c }));
        return tr;
      }),
      ...rows.map((x) => {
        const tr = document.createElement('tr');
        const name = FLOW_CONFIGS[x.flow].short;
        const cells = [name, f1(x.flowFps), f1(x.flowMsMean), f1(x.readMsMean), f1(x.totalMsMean), f1(x.analysisFps), f1(x.cameraFps)];
        for (const c of cells) tr.append(Object.assign(document.createElement('td'), { textContent: c }));
        return tr;
      }),
    );
    const faces = runs.map((r) => r.summary.faceFraction).filter((v) => v != null);
    const minFace = faces.length ? Math.min(...faces) : null;
    const loss = Object.entries(g.analysisFpsLoss).filter(([, v]) => v != null);
    el.note.textContent =
      'pares/s = veces por segundo que se calcula el flujo entre dos frames; ms flujo = lo que tarda el algoritmo; ms copia = sacar la franja en grises del frame; ms total = todo el trabajo del worker por frame; análisis/s = análisis de la cara (MediaPipe) a la vez; cámara = fps. «Y» = solo el plano de brillo del frame; «ligero» = Farnebäck con menos niveles e iteraciones. ' +
      sourcesNote(rows) +
      (rows[0]?.size || rows[1]?.size ? `Franja de trabajo: ${(rows.find((x) => x.size) ?? {}).size.width}×${(rows.find((x) => x.size) ?? {}).size.height} px. ` : '') +
      (loss.length ? `El flujo resta al análisis de la cara: ${loss.map(([k, v]) => `${FLOW_CONFIGS[k].label} ${v > 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}/s`).join('; ')}. ` : '') +
      (minFace != null && minFace < 0.9 ? `Ojo: en alguna pasada la cara solo se detectó en el ${Math.round(minFace * 100)} % de los análisis.` : 'Cara detectada durante casi toda la prueba.');
    el.share.hidden = !navigator.canShare;
  }

  const report = (includeSeries) => {
    const ctx = getContext();
    return buildBenchmarkReport({ runs, startedAt, runMs, warmupMs, includeSeries, build: ctx.build, device: ctx.device, capture: ctx.capture, analysis: ctx.analysis, flow: flowInfo });
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
