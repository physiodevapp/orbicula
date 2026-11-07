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
  fpsWarning: $('fpsWarning'),
  controls: $('controls'),
  deviceRow: $('deviceRow'),
  deviceSelect: $('deviceSelect'),
  details: $('captureDetails'),
  build: $('buildInfo'),
};

els.build.textContent = `v${__APP_VERSION__} · ${__BRANCH__}@${__COMMIT__}`;

const camera = new Camera(els.video);
const state = { facing: 'rear', priority: 'resolution', deviceId: null, running: false };

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
    els.video.classList.toggle('mirrored', info.facing === 'front');
    els.camPill.textContent = info.facing === 'front' ? 'frontal' : 'trasera';
    els.startCard.hidden = true;
    els.live.hidden = false;
    els.controls.hidden = false;
    // La resolución real se conoce cuando llega el primer frame.
    const onMeta = () => renderDetails(info, camera.frameSize);
    if (els.video.videoWidth) onMeta();
    else els.video.addEventListener('loadedmetadata', onMeta, { once: true });
    await refreshDevices();
  } catch (err) {
    state.running = false;
    showError(describeError(err));
    els.startCard.hidden = false;
  } finally {
    els.startBtn.disabled = false;
  }
}

camera.onFrame = updateStats;

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
