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
import { createBenchmark } from './ui/benchmark.js';
import { Series } from './metrics/series.js';
import { asymmetry } from './metrics/asymmetry.js';
import { Overlay } from './ui/overlay.js';
import { Curves } from './ui/curves.js';

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
  controls: $('controls'),
  curvesView: $('curvesView'),
  metricHint: $('metricHint'),
  asymVal: $('asymVal'),
  blinkLog: $('blinkLog'),
  deviceRow: $('deviceRow'),
  deviceSelect: $('deviceSelect'),
  details: $('captureDetails'),
  build: $('buildInfo'),
};

els.build.textContent = `v${__APP_VERSION__} · ${__BRANCH__}@${__COMMIT__}`;

const SIDES = ['left', 'right'];
const SIDE_LETTER = { left: 'I', right: 'D' };

const camera = new Camera(els.video);
const overlay = new Overlay(els.overlay, els.stage);
/** Análisis de la cara: WorkerAnalysis (lo normal) o Analysis en el hilo principal (respaldo). */
let analysis = null;
const state = { facing: 'rear', priority: 'resolution', deviceId: null, running: false, displayMirrored: false, showRoi: true };

// Medidas: series por lado y un detector de parpadeos por lado (sobre el EAR).
const series = new Series({ maxAgeMs: 120000 });
const detectors = { left: new BlinkDetector(), right: new BlinkDetector() };
let lastT = 0; // marca de tiempo del último resultado
let t0 = null; // inicio de las medidas (para el registro de parpadeos)

const curves = new Curves(
  { left: $('curveL'), right: $('curveR') },
  series,
  () => ({
    left: { events: detectors.left.events, baseline: detectors.left.baseline },
    right: { events: detectors.right.events, baseline: detectors.right.baseline },
  }),
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
      blockedHosts: [...new Set([...guard.blockedHosts, ...(analysis?.blockedHosts ?? [])])],
    },
    detector: { ...detectors.left.opt },
  };
}

const assistant = createAssistant({
  getContext: captureContext,
  getPerf: () => ({ cameraFps: round1(camera.meter.fps), analysisFps: round1(analysis?.fps), analysisMs: round1(analysis?.ms) }),
  onStart: () => resetMeasures(), // el reposo y las series empiezan de cero con cada paso
});

const bench = createBenchmark({
  camera,
  video: els.video,
  ensureAnalysis: async () => {
    await loadModel();
    return analysis;
  },
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
  const key = curves.metric;
  const a = asymmetry(series.mean('left', key, lastT, 10000) ?? NaN, series.mean('right', key, lastT, 10000) ?? NaN);
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

function resetMeasures() {
  series.clear();
  for (const side of SIDES) detectors[side].reset();
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
  els.quality.textContent = msg;
  els.quality.hidden = !msg;
}

function updateAnalysisUi(r, now) {
  if (now - lastAnaUi < 250) return;
  lastAnaUi = now;

  const level = fpsLevel(analysis.fps);
  els.anaPill.textContent = `análisis ${analysis.fps.toFixed(0)}/s · ${analysis.ms.toFixed(0)} ms`;
  els.anaPill.className = `pill ${level === 'none' ? '' : level}`;
  $('kvDelegate').textContent = `${analysis.delegate ?? '—'} · ${analysis.mode === 'worker' ? 'worker' : 'hilo principal'}`;
  $('kvTime').textContent = `${analysis.ms.toFixed(1)} ms por análisis · ${analysis.fps.toFixed(1)} análisis/s`;
  const sz = analysis.analysisSize;
  $('kvSize').textContent = sz ? `${sz.width} × ${sz.height}` : '—';
  const blocked = [...new Set([...guard.blockedHosts, ...(analysis.blockedHosts ?? [])])];
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
  const newEvents = { left: [], right: [] };
  for (const side of SIDES) {
    const event = detectors[side].push(r.t, sample ? sample[side].ear : NaN);
    if (event) {
      logBlink(side, event);
      newEvents[side].push(event);
    }
  }
  assistant.record(r.t, sample, newEvents);

  if (r.face && state.showRoi) overlay.draw(r, { displayMirrored: state.displayMirrored });
  else overlay.clear();
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
  assistant.interrupt('la cámara se reinició (cambio de cámara, de prioridad o de pestaña)');
  bench.interrupt('la cámara se reinició');
  resetMeasures(); // otra cámara u otra resolución: el reposo y las series ya no valen
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
camera.onVideoFrame = (now, meta) => analysis?.submit(els.video, meta?.captureTime ?? now);

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

document.querySelectorAll('[data-metric]').forEach((b) =>
  b.addEventListener('click', () => {
    curves.setMetric(b.dataset.metric);
    setPressed('metric', b.dataset.metric);
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
