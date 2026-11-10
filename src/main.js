// Barrera de red: lo primero que se evalúa, antes de que cargue MediaPipe.
import { guard } from './privacy/install.js';
// Fuentes servidas desde el propio sitio (sin Google Fonts: ninguna llamada de red externa).
import '@fontsource/outfit/300.css';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-serif-display/400.css';
import './styles/tokens.css';
import './styles/app.css';

import { Camera } from './capture/camera.js';
import { describeError, fpsLevel, REQUESTED_FPS, PRIORITIES, STRICT_MIN_FPS } from './capture/camera-logic.js';
import { WorkerAnalysis } from './landmarks/worker-client.js';
import { Analysis } from './landmarks/analysis.js';
import { sampleOf } from './landmarks/process.js';
import { BlinkDetector } from './metrics/blinks.js';
import { createAssistant } from './ui/assistant.js';
import { createVideoCard } from './ui/video.js';
import { createProtocolVideo } from './ui/protocol-video.js';
import { exportJson, exportCsv, liveCapture, fileCapture } from './ui/export.js';
import { createVideoSession, videoSteps, processVideo } from './video/offline.js';
import { PROTOCOL_PLAN } from './assistant/steps.js';
import { createBenchmark } from './ui/benchmark.js';
import { Series } from './metrics/series.js';
import { asymmetry } from './metrics/asymmetry.js';
import { Overlay } from './ui/overlay.js';
import { Curves, METRICS } from './ui/curves.js';
import { FlowClient } from './flow/flow-client.js';
import { FLOW_CONFIGS, DEFAULT_FLOW, OPENCV_VERSION, FARNEBACK_PARAMS } from './flow/config.js';
import { FlowProcessor } from './flow/processor.js';
import { RateGovernor } from './flow/governor.js';
import { FLOW_ROIS, VARIANTS } from './flow/metrics.js';
import { calibrate, EventDetector, headSpeedOf } from './protocol/events.js';

const $ = (id) => document.getElementById(id);
const els = {
  error: $('errorBanner'),
  startCard: $('startCard'),
  startBtn: $('startBtn'),
  live: $('liveView'),
  video: $('video'),
  stage: document.querySelector('.stage'),
  fpsPill: $('fpsPill'),
  resPill: $('resPill'),
  camPill: $('camPill'),
  anaPill: $('anaPill'),
  roiPill: $('roiPill'),
  overlay: $('overlay'),
  quality: $('qualityBanner'),
  roiToggle: $('roiToggle'),
  swapToggle: $('swapToggle'),
  blendToggle: $('blendToggle'),
  fpsWarning: $('fpsWarning'),
  analysisWarning: $('analysisWarning'),
  controls: $('controls'),
  curvesView: $('curvesView'),
  metricHint: $('metricHint'),
  asymVal: $('asymVal'),
  blinkLog: $('blinkLog'),
  deviceRow: $('deviceRow'),
  deviceSelect: $('deviceSelect'),
  details: $('captureDetails'),
  build: $('buildInfo'),
  flowToggle: $('flowToggle'),
  flowConfig: $('flowConfig'),
  fieldToggle: $('fieldToggle'),
  flowSelect: $('flowSelect'),
  flowRoi: $('flowRoi'),
  flowComp: $('flowComp'),
};

els.build.textContent = `v${__APP_VERSION__} · ${__BRANCH__}@${__COMMIT__}`;

const SIDES = ['left', 'right'];
const SIDE_LETTER = { left: 'I', right: 'D' };

const camera = new Camera(els.video);
const overlay = new Overlay(els.overlay, els.stage);
/** Análisis de la cara: WorkerAnalysis (lo normal) o Analysis en el hilo principal (respaldo). */
let analysis = null;
/** Flujo óptico (worker con OpenCV.js): se carga solo al activarlo o en la prueba de rendimiento. */
let flow = null;
const state = { facing: 'rear', priority: 'fps', deviceId: null, running: false, displayMirrored: false, showRoi: true, showFlow: false, showField: false };

// Medidas: series por lado y un detector de parpadeos por lado (sobre el EAR).
const series = new Series({ maxAgeMs: 120000 });
const detectors = { left: new BlinkDetector(), right: new BlinkDetector() };
let lastT = 0; // marca de tiempo del último resultado
let t0 = null; // inicio de las medidas (para el registro de parpadeos)

// Flujo por ROI: velocidad residual (raíz de la energía, DI/s) por ROI y compensación ('upperLid:pose'…).
const FLOW_SERIES_KEYS = FLOW_ROIS.flatMap((roi) => VARIANTS.map((v) => `${roi}:${v}`));
// …el cierre por flujo de cada ojo (DI, + = se cierra) y su subida, la medida de los eventos (fase 5).
const flowSeries = new Series({ maxAgeMs: 120000, keys: [...FLOW_SERIES_KEYS, 'closure', 'rise'] });
const isFlowMetric = (m) => METRICS[m]?.series === 'flow';

// Fase 5: calibración sobre el reposo y eventos en directo (src/protocol/events.js). La calibración
// sale del paso de reposo del asistente; hasta entonces no hay eventos.
let calibration = null;
let eventDetector = null;
let calNotice = null; // { text, until }: aviso de la calibración en la franja de calidad
function setCalibration(cal) {
  calibration = cal;
  eventDetector = cal ? new EventDetector(cal, { isClosing: (side) => detectors[side].closing }) : null;
  calNotice = cal && !cal.valid ? { text: `Reposo no válido: ${cal.reason}. Los eventos pueden no ser fiables.`, until: performance.now() + 10000 }
    : cal?.warning ? { text: cal.warning, until: performance.now() + 10000 } : null;
  curves?.requestDraw();
}
const flowProcessor = new FlowProcessor(onFlowSample);
let lastField = null; // última muestra del campo de flujo (para dibujarla)

const curves = new Curves(
  { left: $('curveL'), right: $('curveR') },
  series,
  () => Object.fromEntries(SIDES.map((side) => [side, {
    events: detectors[side].events,
    baseline: detectors[side].baseline,
    detections: eventDetector ? eventDetector.events.filter((e) => e.side === side && e.kind === 'contraction') : [],
    threshold: calibration?.rise?.[side] ?? null,
  }])),
  { flowSeries },
);

/** Datos del informe del asistente de pruebas: solo medidas y configuración, sin imágenes. */
const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
function captureContext() {
  const info = camera.info;
  return {
    build: { version: __APP_VERSION__, branch: __BRANCH__, commit: __COMMIT__ },
    device: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemory: navigator.deviceMemory ?? null,
      language: navigator.language,
      screen: { width: screen.width, height: screen.height, pixelRatio: window.devicePixelRatio },
    },
    capture: {
      facing: info?.facing ?? null,
      deviceLabel: info?.label ?? null,
      priority: state.priority,
      requested: { ...PRIORITIES[state.priority], fps: REQUESTED_FPS },
      settings: { width: info?.width ?? null, height: info?.height ?? null, fps: info?.frameRate ?? null, maxFps: info?.maxFrameRate ?? null },
      frame: camera.frameSize,
      strictFps: info?.strictFps ?? null,
      previewMirrored: state.displayMirrored,
    },
    analysis: {
      mode: analysis?.mode ?? null,
      delegate: analysis?.delegate ?? null,
      imageSize: analysis?.analysisSize ?? null,
      blendshapes: els.blendToggle.checked,
      swapNames: els.swapToggle.checked,
      // Dominios a los que MediaPipe intentó llamar y la barrera de privacidad bloqueó.
      blockedHosts: [...new Set([...guard.blockedHosts, ...(analysis?.blockedHosts ?? []), ...(flow?.blockedHosts ?? [])])],
    },
    flow: flow
      ? { on: state.showFlow, config: flow.config.key, library: 'OpenCV.js', version: OPENCV_VERSION, params: FARNEBACK_PARAMS[flow.config.params], loadMs: round1(flow.loadMs) }
      : null,
    detector: { ...detectors.left.opt },
  };
}


/** Lo que comparten el asistente de pruebas y el protocolo clínico: las mismas medidas y la misma calibración. */
const sessionDeps = {
  getContext: captureContext,
  getPerf: () => ({
    cameraFps: round1(camera.meter.fps), analysisFps: round1(analysis?.fps), analysisMs: round1(analysis?.ms),
    flowFps: state.showFlow ? round1(flow?.fps) : null, flowMs: state.showFlow ? round1(flow?.ms) : null,
    flowRateCap: state.showFlow ? (flow?.rateCap ?? 0) : null, // pares/s de la rebaja automática (0 = sin rebaja)
  }),
  // El reposo y las series empiezan de cero; los planes con flujo lo encienden (y esperan a OpenCV.js).
  onStart: async (plan) => {
    resetMeasures();
    setCalibration(null);
    if (plan.flow && !state.showFlow) {
      els.flowToggle.checked = true;
      await setFlow(true);
      if (!state.showFlow) throw new Error('no se pudo cargar el flujo óptico');
    }
  },
  // Mientras se calibra (el reposo, también al repetirlo) no hay eventos: los umbrales de un intento
  // anterior no valen y los «eventos» del propio reposo no significan nada.
  onStepStart: (step) => { if (step.calibrates) setCalibration(null); },
  // El paso de reposo da la calibración de los eventos (fase 5). Con `minValidFraction`, el tiempo válido
  // mínimo es esa fracción del reposo (el protocolo); si no, el de por defecto.
  onStepEnd: (result, step) => {
    if (!step.calibrates || !state.showFlow) return;
    const o = step.calibrateOptions;
    result.calibration = calibrate(result, o?.minValidFraction ? { minValidMs: Math.round(result.plannedMs * o.minValidFraction) } : {});
    setCalibration(result.calibration);
  },
};
const assistant = createAssistant(sessionDeps);

/**
 * Vídeo grabado (fase 6b): procesa el archivo fotograma a fotograma con el análisis en modo IMAGE y el
 * flujo sin límite de ritmo, y registra las medidas con el reloj del vídeo (src/video/offline.js). La
 * cámara se apaga mientras tanto (si no, sus frames se mezclarían con los del vídeo).
 */
async function analyzeVideoFile({ mp4, mirrored, restSec, maxFps, steps = null, fromMs = 0, toMs = Infinity, signal, onProgress }) {
  const busy = document.body.dataset.busy;
  if (busy) throw new Error(busy === 'video' ? 'ya hay un vídeo analizándose' : 'hay otra prueba en marcha');
  document.body.dataset.busy = 'video';
  const video = createVideoSession(steps ?? videoSteps(mp4.timing.durationMs, restSec), { onStepEnd: sessionDeps.onStepEnd, onStepStart: sessionDeps.onStepStart });
  try {
    if (camera.stream) {
      for (const a of recorders) a.interrupt('se ha empezado a analizar un vídeo grabado');
      camera.stop();
      state.running = false;
    }
    await loadModel();
    if (!analysis) throw new Error('no se pudo cargar el modelo de la cara');
    await sessionDeps.onStart({ flow: true }); // medidas a cero y flujo encendido
    flow.resetStrip();
    flow.setUnlimited(true);
    analysis.frameMirrored = !!mirrored;
    await analysis.setImageMode(true);
    els.curvesView.hidden = false;
    recorders.push(video.recorder);
    const stats = await processVideo({ mp4, analysis, flow, video, maxFps, fromMs, toMs, signal, onProgress });
    // Pares de flujo que llegaron a registrarse y lo que contó el cliente del flujo (para diagnosticar).
    const pairs = video.session.results.reduce((n, r) => n + (r.flow?.rel.length ?? 0), 0);
    stats.flow = { pairs, ...flow.counts };
    // Una vez (en una prueba en la nube) salió un análisis sin ningún par de flujo y no se supo por qué:
    // mejor avisar que entregar un resumen sin flujo.
    if (!pairs) throw new Error(`no se pudo medir el flujo óptico (${JSON.stringify(flow.counts)}); vuelve a intentarlo`);
    return { results: video.session.results, stats, context: captureContext() };
  } finally {
    const k = recorders.indexOf(video.recorder);
    if (k >= 0) recorders.splice(k, 1);
    flow?.setUnlimited(false);
    flow?.resetStrip();
    if (analysis) {
      analysis.frameMirrored = false;
      try { await analysis.setImageMode(false); } catch { /* se recarga al volver a la cámara */ }
    }
    if (document.body.dataset.busy === 'video') document.body.dataset.busy = '';
  }
}
createVideoCard({ getContext: () => { const c = captureContext(); return { build: c.build, device: c.device }; }, analyzeVideoFile });
// Grabación del vídeo durante el protocolo y análisis posterior (fase 6c); `analyzeVideoFile` se define más abajo.
const protocolVideo = createProtocolVideo({ getStream: () => camera.stream, analyzeVideoFile: (o) => analyzeVideoFile(o) });
const protocol = createAssistant({
  ...sessionDeps,
  prefix: 'pr', rootId: 'protocol', busyKey: 'protocol', plan: PROTOCOL_PLAN,
  onStart: async (plan) => { await sessionDeps.onStart(plan); await protocolVideo.beforeStart(); },
  onState: (state, session, extra) => protocolVideo.onState(state, session, extra),
  exporter: {
    json: (results, code) => exportJson({ results, code, capture: liveCapture({ camera, results }), appVersion: __APP_VERSION__, flowConfig: flow?.config.key }),
    csv: (results, code) => exportCsv({ results, code }),
  },
});
/** Las dos tarjetas reciben todas las medidas; solo la que está grabando un paso las guarda. */
const recorders = [assistant, protocol];

const bench = createBenchmark({
  camera,
  video: els.video,
  ensureAnalysis: async () => {
    await loadModel();
    return analysis;
  },
  ensureFlow: () => loadFlow(),
  getBlendshapes: () => els.blendToggle.checked,
  getContext: captureContext,
  onStart: () => {
    overlay.clear();
    els.quality.hidden = true;
  },
});

// Preferencias del clínico (solo comodidad: si el almacenamiento falla, no pasa nada).
const pref = {
  get(k) { try { return localStorage.getItem(`orbicula.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`orbicula.${k}`, v); } catch { /* sin almacenamiento */ } },
};

// Los fps solo se dan por bajos tras unos segundos estables (el arranque siempre va lento).
let lowSince = null;
let lastUiUpdate = 0;

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = !msg;
}

function setPressed(attr, value) {
  document.querySelectorAll(`[data-${attr}]`).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
  });
}

function renderDetails(info, frame) {
  const rows = [
    ['Dispositivo', info.label || '—'],
    ['Cámara obtenida', info.facing === 'front' ? 'frontal (vista en espejo)' : 'trasera'],
    ['Pedido', `${PRIORITIES[state.priority].width} × ${PRIORITIES[state.priority].height} · ${REQUESTED_FPS} fps`],
    ...(state.priority === 'fps'
      ? [['Mínimo de fps exigido', info.strictFps ? `sí (≥ ${STRICT_MIN_FPS})` : 'no lo admite la cámara']]
      : []),
    ['Resolución (frames)', `${frame.width} × ${frame.height}`],
    ['Resolución (ajustes)', `${info.width ?? '—'} × ${info.height ?? '—'}`],
    ['fps (ajustes)', info.frameRate != null ? info.frameRate.toFixed(1) : '—'],
    ['Máximo del sensor', info.maxWidth ? `${info.maxWidth} × ${info.maxHeight} · ${info.maxFrameRate ?? '—'} fps` : 'no disponible'],
  ];
  els.details.replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function updateStats(fps) {
  const now = performance.now();
  if (now - lastUiUpdate < 250) return;
  lastUiUpdate = now;

  const level = fpsLevel(fps);
  els.fpsPill.textContent = `${fps ? fps.toFixed(1) : '—'} fps`;
  els.fpsPill.className = `pill ${level === 'none' ? '' : level}`;

  const { width, height } = camera.frameSize;
  els.resPill.textContent = width ? `${width}×${height}` : '—';

  if (level === 'warn' || level === 'bad') {
    lowSince ??= now;
  } else if (level === 'ok') {
    lowSince = null;
  }
  els.fpsWarning.hidden = !(lowSince && now - lowSince > 3000);
}

// ── Estadísticas por lado ───────────────────────────────────────────────────────
const statRefs = {};
for (const side of SIDES) {
  const grid = $(side === 'left' ? 'statsL' : 'statsR');
  statRefs[side] = {};
  for (const [key, label] of [
    ['count', 'Parpadeos'],
    ['rate', 'Por minuto'],
    ['dur', 'Duración'],
    ['comp', 'Cierre'],
    ['base', 'Reposo (EAR)'],
  ]) {
    const box = document.createElement('div');
    box.className = 'stat';
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = key === 'count' ? 'stat-value main' : 'stat-value';
    v.textContent = '—';
    box.append(l, v);
    grid.append(box);
    statRefs[side][key] = v;
  }
}

const METRIC_HINTS = {
  ear: 'EAR: apertura vertical media del ojo / ancho del ojo. Ronda 0,25–0,35 con el ojo abierto y baja al cerrar. Es la señal que usa el detector (la línea discontinua es el reposo estimado).',
  aperture: 'Apertura palpebral central normalizada a la distancia entre las comisuras internas de los dos ojos.',
  blink: 'Blendshape de parpadeo de MediaPipe (0 abierto, 1 cerrado). Es una señal más lenta y de menor rango que el EAR; sirve de apoyo.',
  rise: 'Subida del cierre por flujo: cuánto se ha cerrado el ojo respecto a cómo estaba justo antes (DI). Es la medida de los eventos: la línea discontinua es el umbral, calibrado con el reposo del asistente, y las franjas son las contracciones detectadas (más tenues si se descartaron por mover la cabeza o por un parpadeo).',
  closure: 'Cierre del ojo medido con el flujo: cuánto ha bajado el párpado superior menos lo que ha subido el inferior, en distancias intercantales (DI), compensado con el dorso nasal. Sube al entrecerrar y vuelve a 0 en unos segundos (para que no derive). Es la señal que detecta contracciones más finas que el EAR.',
  flow: 'Flujo óptico de la ROI elegida: velocidad del movimiento que queda tras restar el de la cabeza, en distancias intercantales por segundo (DI/s). Escala logarítmica, con líneas en 0,01, 0,17 y 3 DI/s. Por defecto, compensado con el dorso nasal (en los vídeos de prueba, la postura añadía el temblor de la malla).',
};
els.metricHint.textContent = METRIC_HINTS.ear;

let lastStatsUi = 0;
function updateCurveStats(now) {
  if (now - lastStatsUi < 250) return;
  lastStatsUi = now;
  for (const side of SIDES) {
    const s = detectors[side].stats(lastT);
    const r = statRefs[side];
    r.count.textContent = String(s.count);
    r.rate.textContent = s.perMinute == null ? '—' : s.perMinute.toFixed(0);
    r.dur.textContent = s.last ? `${Math.round(s.last.duration)} ms` : '—';
    r.comp.textContent = s.last ? `${Math.round(s.last.completeness * 100)} %` : '—';
    const b = detectors[side].baseline;
    r.base.textContent = b == null ? '—' : b.toFixed(2);
  }
  // Con la curva del flujo, la asimetría es la de la ROI y la compensación elegidas.
  const flowCurve = isFlowMetric(curves.metric);
  const src = flowCurve ? flowSeries : series;
  const key = curves.metric === 'flow' ? curves.flowKey : curves.metric;
  const tEnd = flowCurve ? (flowSeries.t.at(-1) ?? lastT) : lastT;
  const a = asymmetry(src.mean('left', key, tEnd, 10000) ?? NaN, src.mean('right', key, tEnd, 10000) ?? NaN);
  els.asymVal.textContent = a == null ? '—' : `${a > 0 ? '+' : ''}${a.toFixed(2)}`;
}

function logBlink(side, e) {
  els.blinkLog.querySelector('.log-empty')?.remove();
  const li = document.createElement('li');
  const at = document.createElement('span');
  at.textContent = `+${(((e.t - (t0 ?? e.t)) / 1000)).toFixed(1)} s`;
  const who = document.createElement('span');
  who.className = `side-${side}`;
  who.textContent = SIDE_LETTER[side];
  const what = document.createElement('span');
  const KIND = { blink: 'parpadeo', closure: 'cierre', narrowing: 'entornado' };
  what.textContent = `${KIND[e.kind]} · ${Math.round(e.duration)} ms · ${Math.round(e.completeness * 100)} %`;
  li.append(at, who, what);
  els.blinkLog.prepend(li);
  while (els.blinkLog.children.length > 8) els.blinkLog.lastChild.remove();
}

const DET_KIND = { contraction: 'contracción', brow: 'ceja (exp.)', canthus: 'canto (exp.)' };
const DET_STATUS = { head: ' · descartada: cabeza', blink: ' · era un parpadeo', brief: ' · breve, no cuenta' };
/** Eventos de la fase 5: al asistente, a la lista y a las curvas. Los parpadeos ya los anota logBlink. */
function onDetections(list) {
  for (const e of list) {
    for (const r of recorders) r.recordDetection(e);
    if (e.kind === 'blink' || e.kind === 'closure') continue;
    if (e.kind !== 'contraction' && e.status !== 'ok') continue;
    els.blinkLog.querySelector('.log-empty')?.remove();
    const li = document.createElement('li');
    const at = document.createElement('span');
    at.textContent = `+${((e.tStart - (t0 ?? e.tStart)) / 1000).toFixed(1)} s`;
    const who = document.createElement('span');
    who.className = `side-${e.side}`;
    who.textContent = SIDE_LETTER[e.side];
    const what = document.createElement('span');
    what.textContent = `${DET_KIND[e.kind]} · ${e.duration} ms · ×${e.peak.toFixed(1).replace('.', ',')}${DET_STATUS[e.status] ?? ''}`;
    li.append(at, who, what);
    els.blinkLog.prepend(li);
    while (els.blinkLog.children.length > 8) els.blinkLog.lastChild.remove();
  }
  if (list.length) curves.requestDraw();
}

function resetMeasures() {
  series.clear();
  flowSeries.clear();
  flowProcessor.reset();
  for (const side of SIDES) detectors[side].reset();
  setCalibration(calibration); // la calibración se conserva; el detector empieza de cero
  t0 = null;
  els.blinkLog.replaceChildren(Object.assign(document.createElement('li'), { className: 'log-empty', textContent: 'Aún no hay ninguno.' }));
  lastStatsUi = 0;
  curves.requestDraw();
}

// ── Análisis (landmarks y ROI) ─────────────────────────────────────────────────
let lastAnaUi = 0;
let faceLostSince = null;
let smallSince = null;
const SMALL_FACE_RATIO = 0.3; // provisional: la cara ocupa menos del 30 % del lado corto del frame
const SHOW_AFTER_MS = 1000; // un aviso de calidad solo sale si la condición se mantiene

function setBar(id, valueId, frac, text) {
  $(id).style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  $(valueId).textContent = text;
}

function updateQuality(r, now) {
  faceLostSince = r.face ? null : (faceLostSince ?? now);
  smallSince = r.face && r.rois.meta.faceRatio < SMALL_FACE_RATIO ? (smallSince ?? now) : null;
  let msg = '';
  if (faceLostSince && now - faceLostSince > SHOW_AFTER_MS) msg = 'No se detecta la cara. Encuádrala de frente y con buena luz.';
  else if (smallSince && now - smallSince > SHOW_AFTER_MS) msg = 'Cara pequeña en el encuadre: acerca el móvil o el paciente.';
  else if (eventDetector?.last.moving && state.showFlow) msg = 'Cabeza en movimiento: quieto. Mientras tanto no se registran eventos.';
  else if (calNotice && now < calNotice.until) msg = calNotice.text;
  els.quality.textContent = msg;
  els.quality.hidden = !msg;
}

// Criterio de aceptación 1: el análisis en directo tiene que llegar a 24/s; si no, se dice y se propone el
// vídeo grabado. Hay que verlo bajo el mínimo 5 s seguidos (el arranque siempre va lento) y no mientras
// se procesa un vídeo (ahí no hay prisa).
const MIN_ANALYSIS_FPS = 24;
let slowAnalysisSince = null;
function updateAnalysisWarning(now) {
  const slow = state.running && analysis && analysis.fps > 0 && analysis.fps < MIN_ANALYSIS_FPS && document.body.dataset.busy !== 'video';
  slowAnalysisSince = slow ? (slowAnalysisSince ?? now) : null;
  const show = slowAnalysisSince != null && now - slowAnalysisSince > 5000;
  els.analysisWarning.hidden = !show;
  if (show) {
    els.analysisWarning.textContent = `El análisis de la cara va a ${analysis.fps.toFixed(0)} por segundo y el mínimo es ${MIN_ANALYSIS_FPS}: las medidas en directo pierden sensibilidad. Para medir con la máxima sensibilidad, graba con la app de cámara y analiza el vídeo (tarjeta «Vídeo grabado», arriba), o marca «Grabar el vídeo para analizarlo después» al hacer el protocolo.`;
  }
}

function updateAnalysisUi(r, now) {
  if (now - lastAnaUi < 250) return;
  lastAnaUi = now;
  updateAnalysisWarning(now);

  const level = fpsLevel(analysis.fps);
  els.anaPill.textContent = `análisis ${analysis.fps.toFixed(0)}/s · ${analysis.ms.toFixed(0)} ms`;
  els.anaPill.className = `pill ${level === 'none' ? '' : level}`;
  $('kvDelegate').textContent = `${analysis.delegate ?? '—'} · ${analysis.mode === 'worker' ? 'worker' : 'hilo principal'}`;
  $('kvTime').textContent = `${analysis.ms.toFixed(1)} ms por análisis · ${analysis.fps.toFixed(1)} análisis/s`;
  const sz = analysis.analysisSize;
  $('kvSize').textContent = sz ? `${sz.width} × ${sz.height}` : '—';
  const blocked = [...new Set([...guard.blockedHosts, ...(analysis.blockedHosts ?? []), ...(flow?.blockedHosts ?? [])])];
  $('kvBlocked').textContent = blocked.length ? blocked.join(', ') : 'ninguna';

  if (!r.face) {
    els.roiPill.hidden = true;
    for (const id of ['blinkL', 'blinkR', 'earL', 'earR']) setBar(id, `${id}v`, 0, '—');
    $('kvFace').textContent = $('kvIcd').textContent = $('kvEye').textContent = '—';
    return;
  }
  const { left, right, meta } = r.rois;
  const eye = Math.round((left.eyeWidth + right.eyeWidth) / 2);
  els.roiPill.hidden = false;
  els.roiPill.textContent = `ojo ≈ ${eye} px`;
  $('kvFace').textContent = `${Math.round(meta.faceRatio * 100)} % del lado corto`;
  $('kvIcd').textContent = `${Math.round(meta.intercanthal)} px`;
  $('kvEye').textContent = `${Math.round(left.eyeWidth)} / ${Math.round(right.eyeWidth)} px`;

  const b = r.blend;
  setBar('blinkL', 'blinkLv', b.left.eyeBlink ?? 0, (b.left.eyeBlink ?? 0).toFixed(2));
  setBar('blinkR', 'blinkRv', b.right.eyeBlink ?? 0, (b.right.eyeBlink ?? 0).toFixed(2));
  // El EAR de un ojo abierto ronda 0,25–0,35: la barra llena es 0,5.
  setBar('earL', 'earLv', left.ear / 0.5, left.ear.toFixed(2));
  setBar('earR', 'earRv', right.ear / 0.5, right.ear.toFixed(2));
}

/** Un resultado del análisis (del worker o del hilo principal): medidas, dibujo e interfaz. */
function onResult(r) {
  const now = performance.now();
  t0 ??= r.t;
  lastT = r.t;

  const sample = sampleOf(r);
  series.push(r.t, sample);
  // Reposo del EAR para congelar el cierre por flujo durante los parpadeos: el de la calibración o,
  // hasta tenerla, el que estima el detector de parpadeos.
  const bl = (side) => calibration?.ear?.[side]?.baseline ?? detectors[side].baseline;
  flowProcessor.earBaseline = bl('left') && bl('right') ? { left: bl('left'), right: bl('right') } : null;
  const newEvents = { left: [], right: [] };
  for (const side of SIDES) {
    const event = detectors[side].push(r.t, sample ? sample[side].ear : NaN);
    if (event) {
      logBlink(side, event);
      newEvents[side].push(event);
      if (eventDetector) onDetections(eventDetector.pushBlink(side, event));
    }
  }
  for (const a of recorders) a.record(r.t, sample, newEvents);

  flow?.setFace(r);
  flowProcessor.pushFace(r.t, r);
  if (r.face && state.showRoi) overlay.draw(r, { displayMirrored: state.displayMirrored });
  else overlay.clear();
  if (r.face && state.showFlow && flow?.strip) overlay.drawStrip(flow.strip, r.frame, { displayMirrored: state.displayMirrored });
  if (r.face && state.showFlow && state.showField && lastField) overlay.drawField(lastField, r.frame, { displayMirrored: state.displayMirrored });
  updateQuality(r, now);
  updateAnalysisUi(r, now);
  updateCurveStats(now);
  curves.requestDraw();
}

/** Crea el análisis en un worker; si no puede arrancar, en el hilo principal. */
async function createAnalysis() {
  const blendshapes = els.blendToggle.checked;
  // `?analysis=main` fuerza el hilo principal: sirve para comparar tiempos con y sin worker.
  const forceMain = new URLSearchParams(location.search).get('analysis') === 'main';
  try {
    if (forceMain) throw new Error('forzado con ?analysis=main');
    const worker = new WorkerAnalysis();
    await worker.load(blendshapes);
    return worker;
  } catch (err) {
    console.warn('El worker de análisis no arranca, se usa el hilo principal:', err);
    const main = new Analysis();
    await main.load(blendshapes);
    return main;
  }
}

// ── Ritmo del flujo: se rebaja solo si el análisis de la cara no llega a 24/s ─────────────
const governor = new RateGovernor();
setInterval(() => {
  updateAnalysisWarning(performance.now()); // también se quita sola si la cámara se para
  // La prueba de rendimiento mide configuraciones fijas y el vídeo grabado procesa todos los pares.
  if (!flow || !state.showFlow || !analysis || ['bench', 'video'].includes(document.body.dataset.busy)) return;
  const cap = governor.update(performance.now(), analysis.fps);
  if (cap !== flow.rateCap) {
    flow.setRateCap(cap);
    console.info(`orbicula: flujo ${cap ? `rebajado a ${cap} pares/s (análisis de la cara a ${analysis.fps.toFixed(1)}/s)` : 'de vuelta a su ritmo normal'}`);
  }
}, 500);

// ── Flujo óptico (paso 4a: solo rendimiento) ──────────────────────────────────
let flowPromise = null;
let lastFlowUi = 0;
/** Carga el worker de flujo y OpenCV.js una sola vez. */
function loadFlow() {
  flowPromise ??= (async () => {
    const f = new FlowClient();
    f.setConfig(els.flowConfig.value);
    try {
      await f.load();
    } catch (err) {
      f.dispose();
      flowPromise = null;
      throw err;
    }
    f.onResult = onFlowResult;
    flow = f;
    return f;
  })();
  return flowPromise;
}

/** Un par de flujo procesado (con sus tres compensaciones): series, asistente y curvas. */
function onFlowSample(s) {
  const side = (x) => Object.fromEntries(FLOW_SERIES_KEYS.map((k) => {
    const [roi, v] = k.split(':');
    const e = x?.[roi]?.[v]?.energy;
    return [k, Number.isFinite(e) ? Math.sqrt(e) : NaN];
  }));
  if (eventDetector) {
    const root = (x, roi) => Math.sqrt(x?.[roi]?.reference?.energy ?? NaN);
    onDetections(eventDetector.pushFlow({
      t: s.t,
      closure: s.closure,
      headSpeed: headSpeedOf(s.head?.reference?.u, s.head?.reference?.v),
      energy: Object.fromEntries(SIDES.map((x) => [x, { brow: root(s[x], 'brow'), canthus: root(s[x], 'canthus') }])),
    }));
  }
  flowSeries.push(s.t, {
    left: { ...side(s.left), closure: s.closure?.left ?? NaN, rise: eventDetector?.last.rise.left ?? NaN },
    right: { ...side(s.right), closure: s.closure?.right ?? NaN, rise: eventDetector?.last.rise.right ?? NaN },
  });
  for (const a of recorders) a.recordFlow(s);
  if (isFlowMetric(curves.metric)) curves.requestDraw();
}

function onFlowResult(m) {
  if (m.paired && m.moments) flowProcessor.pushFlow({ t: m.t, dt: m.dt, moments: m.moments, strip: m.strip, scale: m.scale });
  if (m.field) lastField = { field: m.field, strip: m.strip, scale: m.scale };
  const now = performance.now();
  if (now - lastFlowUi < 250) return;
  lastFlowUi = now;
  const f = flow;
  $('kvFlow').textContent = `${f.ms.toFixed(1)} ms · ${f.fps.toFixed(1)} pares/s${f.rateCap ? ` (rebajado a ${f.rateCap})` : ''} · worker ${m.totalMs.toFixed(1)} ms (copia ${m.readMs.toFixed(1)})`;
  $('kvStrip').textContent = f.strip ? `${f.strip.w} × ${f.strip.h} → ${m.size.width} × ${m.size.height}` : '—';
  $('kvFlowLoad').textContent = f.loadMs != null ? `${(f.loadMs / 1000).toFixed(1)} s` : '—';
}

async function setFlow(on) {
  state.showFlow = on;
  if (!on) {
    $('kvFlow').textContent = 'apagado';
    lastField = null;
    return;
  }
  $('kvFlow').textContent = 'cargando OpenCV.js…';
  try {
    await loadFlow();
    flow.wantField = state.showField;
    $('kvFlowLoad').textContent = `${(flow.loadMs / 1000).toFixed(1)} s`;
    if (state.showFlow) $('kvFlow').textContent = 'esperando a la cara…';
  } catch (err) {
    state.showFlow = false;
    els.flowToggle.checked = false;
    $('kvFlow').textContent = `no se pudo cargar (${err?.message ?? err})`;
  }
}

let modelPromise = null;
/** Carga el modelo una sola vez; quien llame después espera a la misma carga. */
function loadModel() {
  modelPromise ??= (async () => {
    els.anaPill.textContent = 'Cargando modelo…';
    try {
      analysis = await createAnalysis();
      analysis.onResult = onResult;
      analysis.frameMirrored = false;
      analysis.swapNames = els.swapToggle.checked;
      els.anaPill.textContent = 'Modelo listo';
    } catch (err) {
      els.anaPill.textContent = 'Sin análisis';
      showError(`No se pudo cargar el modelo de la cara (${err?.message ?? err}). La cámara sigue funcionando.`);
      modelPromise = null; // se podrá reintentar
    }
  })();
  return modelPromise;
}

async function refreshDevices() {
  const devices = await Camera.listDevices().catch(() => []);
  els.deviceSelect.replaceChildren(
    ...devices.map((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Cámara ${i + 1}`;
      return o;
    }),
  );
  els.deviceSelect.value = camera.info?.deviceId ?? '';
  // Con solo una trasera y una frontal basta el selector de arriba.
  els.deviceRow.hidden = devices.length <= 2;
}

async function start() {
  showError('');
  els.startBtn.disabled = true;
  lowSince = null;
  for (const a of recorders) a.interrupt('la cámara se reinició (cambio de cámara, de prioridad o de pestaña)');
  bench.interrupt('la cámara se reinició');
  resetMeasures(); // otra cámara u otra resolución: el reposo y las series ya no valen
  flow?.resetStrip();
  try {
    const info = await camera.start(state);
    state.running = true;
    state.facing = info.facing;
    setPressed('facing', info.facing);
    state.displayMirrored = info.facing === 'front';
    els.video.classList.toggle('mirrored', state.displayMirrored);
    // Los frames de getUserMedia no van en espejo, tampoco con la frontal: solo la vista previa.
    if (analysis) analysis.frameMirrored = false;
    els.camPill.textContent = info.facing === 'front' ? 'frontal' : 'trasera';
    els.startCard.hidden = true;
    els.live.hidden = false;
    els.curvesView.hidden = false;
    assistant.show();
    protocol.show();
    bench.show();
    els.controls.hidden = false;
    // La resolución real se conoce cuando llega el primer frame.
    const onMeta = () => renderDetails(info, camera.frameSize);
    if (els.video.videoWidth) onMeta();
    else els.video.addEventListener('loadedmetadata', onMeta, { once: true });
    await refreshDevices();
    loadModel();
  } catch (err) {
    state.running = false;
    showError(describeError(err));
    els.startCard.hidden = false;
  } finally {
    els.startBtn.disabled = false;
  }
}

camera.onFrame = updateStats;
// La marca de tiempo del frame es la de captura de la cámara (si el navegador la da), no la
// de cuando acaba el análisis: así las duraciones de los parpadeos no dependen de la latencia.
camera.onVideoFrame = (now, meta) => {
  const t = meta?.captureTime ?? now;
  analysis?.submit(els.video, t);
  if (state.showFlow) flow?.submit(els.video, t);
};

els.roiToggle.checked = pref.get('showRoi') !== '0';
state.showRoi = els.roiToggle.checked;
els.roiToggle.addEventListener('change', () => {
  state.showRoi = els.roiToggle.checked;
  pref.set('showRoi', state.showRoi ? '1' : '0');
  if (!state.showRoi) overlay.clear();
});

els.swapToggle.checked = pref.get('swapBlend') === '1';
els.swapToggle.addEventListener('change', () => {
  if (analysis) analysis.swapNames = els.swapToggle.checked;
  pref.set('swapBlend', els.swapToggle.checked ? '1' : '0');
});

els.blendToggle.addEventListener('change', () => analysis?.setBlendshapes(els.blendToggle.checked));

els.flowConfig.replaceChildren(
  ...Object.values(FLOW_CONFIGS)
    .filter((c) => c.method !== 'none')
    .map((c) => Object.assign(document.createElement('option'), { value: c.key, textContent: c.label })),
);
els.flowConfig.value = FLOW_CONFIGS[pref.get('flowConfig')] && pref.get('flowConfig') !== 'none' ? pref.get('flowConfig') : DEFAULT_FLOW;
els.flowConfig.addEventListener('change', () => {
  pref.set('flowConfig', els.flowConfig.value);
  flow?.setConfig(els.flowConfig.value);
});
els.flowToggle.addEventListener('change', () => setFlow(els.flowToggle.checked));

els.fieldToggle.checked = pref.get('showField') === '1';
state.showField = els.fieldToggle.checked;
els.fieldToggle.addEventListener('change', () => {
  state.showField = els.fieldToggle.checked;
  pref.set('showField', state.showField ? '1' : '0');
  if (flow) flow.wantField = state.showField;
  if (state.showField && !state.showFlow) {
    els.flowToggle.checked = true;
    setFlow(true);
  }
});

// Curva del flujo: qué ROI y con qué compensación.
const setFlowKey = () => {
  curves.flowKey = `${els.flowRoi.value}:${els.flowComp.value}`;
  pref.set('flowRoi', els.flowRoi.value);
  pref.set('flowComp', els.flowComp.value);
  curves.requestDraw();
};
if (FLOW_ROIS.includes(pref.get('flowRoi'))) els.flowRoi.value = pref.get('flowRoi');
if (VARIANTS.includes(pref.get('flowComp'))) els.flowComp.value = pref.get('flowComp');
setFlowKey();
els.flowRoi.addEventListener('change', setFlowKey);
els.flowComp.addEventListener('change', setFlowKey);

document.querySelectorAll('[data-metric]').forEach((b) =>
  b.addEventListener('click', () => {
    curves.setMetric(b.dataset.metric);
    setPressed('metric', b.dataset.metric);
    els.flowSelect.hidden = b.dataset.metric !== 'flow';
    if (isFlowMetric(b.dataset.metric) && !state.showFlow) {
      els.flowToggle.checked = true;
      setFlow(true); // la curva del flujo necesita el flujo encendido
    }
    els.metricHint.textContent = METRIC_HINTS[b.dataset.metric];
    lastStatsUi = 0;
  }),
);
$('resetBtn').addEventListener('click', resetMeasures);

// El marco toma la proporción real de los frames (en vertical, Android los entrega girados).
els.video.addEventListener('resize', () => {
  const { videoWidth: w, videoHeight: h } = els.video;
  if (w && h) els.stage.style.aspectRatio = `${w} / ${h}`;
  if (camera.info) renderDetails(camera.info, camera.frameSize);
});

els.startBtn.addEventListener('click', start);

document.querySelectorAll('[data-facing]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.facing === state.facing && !state.deviceId) return;
    state.facing = b.dataset.facing;
    state.deviceId = null;
    setPressed('facing', state.facing);
    start();
  }),
);

document.querySelectorAll('[data-priority]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.priority === state.priority) return;
    state.priority = b.dataset.priority;
    setPressed('priority', state.priority);
    start();
  }),
);

els.deviceSelect.addEventListener('change', () => {
  state.deviceId = els.deviceSelect.value || null;
  start();
});

// Al salir de la pestaña se suelta la cámara (Android la bloquea para otras apps);
// al volver se reabre con la misma configuración.
document.addEventListener('visibilitychange', () => {
  if (!state.running) return;
  if (document.hidden) camera.stop();
  else start();
});

// `?debug`: expone las series para las pruebas de punta a punta (scripts/dev/, docs/desarrollo.md).
// Solo lectura en la propia página; no envía nada.
if (new URLSearchParams(location.search).has('debug')) {
  window.__orbicula = { series, flowSeries, get flow() { return flow; }, get analysis() { return analysis; } };
}
