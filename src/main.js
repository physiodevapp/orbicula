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
import { Analysis } from './landmarks/analysis.js';
import { Overlay } from './ui/overlay.js';

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
  fpsWarning: $('fpsWarning'),
  controls: $('controls'),
  deviceRow: $('deviceRow'),
  deviceSelect: $('deviceSelect'),
  details: $('captureDetails'),
  build: $('buildInfo'),
};

els.build.textContent = `v${__APP_VERSION__} · ${__BRANCH__}@${__COMMIT__}`;

const camera = new Camera(els.video);
const analysis = new Analysis(els.video);
const overlay = new Overlay(els.overlay, els.stage);
const state = { facing: 'rear', priority: 'resolution', deviceId: null, running: false, displayMirrored: false, showRoi: true };

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
  els.anaPill.textContent = `${analysis.fps.toFixed(0)} an/s · ${analysis.ms.toFixed(0)} ms`;
  els.anaPill.className = `pill ${level === 'none' ? '' : level}`;
  $('kvDelegate').textContent = analysis.delegate ?? '—';
  $('kvTime').textContent = `${analysis.ms.toFixed(1)} ms · ${analysis.fps.toFixed(1)} fotogramas/s`;

  if (!r.face) {
    els.roiPill.hidden = true;
    for (const id of ['blinkL', 'blinkR', 'openL', 'openR']) setBar(id, `${id}v`, 0, '—');
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
  // La apertura de un ojo abierto ronda 0,25–0,35 del ancho del ojo: la barra llena es 0,4.
  setBar('openL', 'openLv', left.opening / 0.4, left.opening.toFixed(2));
  setBar('openR', 'openRv', right.opening / 0.4, right.opening.toFixed(2));
}

function onVideoFrame() {
  const r = analysis.step();
  if (!r) return;
  const now = performance.now();
  if (r.face && state.showRoi) overlay.draw(r, { displayMirrored: state.displayMirrored });
  else overlay.clear();
  updateQuality(r, now);
  updateAnalysisUi(r, now);
}

async function loadModel() {
  if (analysis.ready) return;
  els.anaPill.textContent = 'Cargando modelo…';
  try {
    await analysis.load();
    els.anaPill.textContent = 'Modelo listo';
  } catch (err) {
    els.anaPill.textContent = 'Sin análisis';
    showError(`No se pudo cargar el modelo de la cara (${err?.message ?? err}). La cámara sigue funcionando.`);
  }
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
  try {
    const info = await camera.start(state);
    state.running = true;
    state.facing = info.facing;
    setPressed('facing', info.facing);
    state.displayMirrored = info.facing === 'front';
    els.video.classList.toggle('mirrored', state.displayMirrored);
    // Los frames de getUserMedia no van en espejo, tampoco con la frontal: solo la vista previa.
    analysis.frameMirrored = false;
    els.camPill.textContent = info.facing === 'front' ? 'frontal' : 'trasera';
    els.startCard.hidden = true;
    els.live.hidden = false;
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
camera.onVideoFrame = onVideoFrame;

els.roiToggle.checked = pref.get('showRoi') !== '0';
state.showRoi = els.roiToggle.checked;
els.roiToggle.addEventListener('change', () => {
  state.showRoi = els.roiToggle.checked;
  pref.set('showRoi', state.showRoi ? '1' : '0');
  if (!state.showRoi) overlay.clear();
});

els.swapToggle.checked = pref.get('swapBlend') === '1';
analysis.swapNames = els.swapToggle.checked;
els.swapToggle.addEventListener('change', () => {
  analysis.swapNames = els.swapToggle.checked;
  pref.set('swapBlend', analysis.swapNames ? '1' : '0');
});

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
