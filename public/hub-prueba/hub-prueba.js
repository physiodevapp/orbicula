// Hub simulado para probar la integración (criterio 6). Solo habla con su iframe y solo con el origen de ese
// iframe (nunca «*»).
(function () {
  'use strict';
  var frame = document.getElementById('frame');
  var $ = function (id) { return document.getElementById(id); };
  // Por defecto, la orbicula de este mismo sitio. `?orbicula=<dirección>` carga otra (p. ej. para probar un origen
  // permitido y otro que no): los mensajes se mandan y se aceptan solo con el origen de esa dirección.
  var target = new URL(new URLSearchParams(location.search).get('orbicula') || '../?host=physiq', location.href);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') target = new URL('../?host=physiq', location.href);
  var origin = target.origin;
  var logEl = $('log');
  var lines = [];
  var lastResult = null;

  frame.src = target.href;

  function now() { return new Date().toLocaleTimeString('es-ES'); }
  function log(dir, text, cls) {
    var line = now() + ' ' + dir + ' ' + text;
    lines.push(line);
    var li = document.createElement('li');
    li.className = cls || (dir === '←' ? 'in' : 'out');
    li.textContent = line;
    logEl.prepend(li);
  }
  function send(msg) {
    frame.contentWindow.postMessage(msg, origin);
    log('→', msg.type + (msg.payload ? ' ' + JSON.stringify(msg.payload) : ''));
  }

  function currentConfig() {
    var cfg = {};
    if ($('theme').value) cfg.theme = $('theme').value;
    var protocol = {};
    if ($('rest').value) protocol.restSec = Number($('rest').value);
    if ($('natural').value) protocol.naturalSec = Number($('natural').value);
    if ($('reps').value) protocol.reps = Number($('reps').value);
    if (Object.keys(protocol).length) cfg.protocol = protocol;
    cfg.lang = 'es';
    return cfg;
  }

  function describe(doc, sessionId) {
    var ts = doc.timeseries || {};
    var aligned = ['phase', 'frozen'].every(function (k) { return (ts[k] || []).length === (ts.t || []).length; });
    var bytes = new Blob([JSON.stringify(doc)]).size;
    var phases = (doc.protocol || []).map(function (p) { return p.phase; }).join(', ');
    return [
      'sessionId: ' + sessionId,
      'app ' + doc.app + ' ' + doc.appVersion + ' · schemaVersion ' + doc.schemaVersion + ' · ' + Math.round(bytes / 1024) + ' KB',
      'captura: ' + doc.capture.source + ' / ' + doc.capture.analysis + ' · ' + (doc.capture.camera || '—') + ' · ' + doc.capture.width + '×' + doc.capture.height,
      'código: ' + (doc.participantCode || '—'),
      'fases: ' + phases,
      'eventos: ' + (doc.events || []).length + ' · muestras: ' + (ts.t || []).length + (aligned ? ' (series alineadas)' : ' ¡SERIES DESALINEADAS!'),
    ].join('\n');
  }

  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow) return;
    if (e.origin !== origin) { log('←', 'ignorado: origen ' + e.origin, 'bad'); return; }
    var m = e.data;
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'orbicula:ready') {
      log('←', 'orbicula:ready ' + JSON.stringify(m.payload));
      $('status').textContent = 'Conectado: orbicula ' + (m.payload && m.payload.appVersion) + ', esquema ' + (m.payload && m.payload.schemaVersion) + '.';
      var perms = m.payload && m.payload.permissions;
      var missing = perms ? Object.keys(perms).filter(function (k) { return !perms[k]; }) : [];
      if (missing.length) {
        $('status').textContent += ' ¡FALTAN permisos en el iframe: ' + missing.join(', ') + '! (allow="camera; screen-wake-lock")';
        $('status').className = 'warn';
      } else {
        $('status').className = 'ok';
      }
      if ($('auto').checked) send({ type: 'orbicula:config', payload: currentConfig() });
    } else if (m.type === 'orbicula:result') {
      lastResult = m;
      log('←', 'orbicula:result (sessionId ' + m.sessionId + ')');
      $('result').textContent = describe(m.payload, m.sessionId);
      $('download').disabled = false;
    } else {
      log('←', m.type, 'bad');
    }
  });

  ['Light', 'Dark', 'Auto'].forEach(function (name) {
    $('theme' + name).addEventListener('click', function () {
      var theme = name.toLowerCase();
      $('theme').value = theme;
      send({ type: 'orbicula:config', payload: { theme: theme } });
    });
  });
  $('sendConfig').addEventListener('click', function () { send({ type: 'orbicula:config', payload: currentConfig() }); });
  $('short').addEventListener('click', function () {
    $('rest').value = '30'; $('natural').value = '30'; $('reps').value = '3';
    send({ type: 'orbicula:config', payload: { protocol: { restSec: 30, naturalSec: 30, reps: 3 } } });
  });
  $('bad').addEventListener('click', function () { send({ type: 'orbicula:config', payload: { theme: 'rosa', lang: 'en', protocol: { restSec: 31 }, otro: 1 } }); });
  // Como el hub de verdad: avisa y oculta el iframe (hidden), y al mostrarlo lo muestra, avisa y lo trae a la vista.
  // (Un iframe de otro origen fuera de la pantalla se frena: sin traerlo a la vista, el vídeo no se procesa.)
  $('hide').addEventListener('click', function () {
    send({ type: 'PHYSIQ_SAT_HIDDEN' });
    frame.hidden = true;
    $('frameState').textContent = ' — oculta (el hub la ha ocultado)';
  });
  $('show').addEventListener('click', function () {
    frame.hidden = false;
    $('frameState').textContent = '';
    send({ type: 'PHYSIQ_SAT_VISIBLE' });
    frame.scrollIntoView({ block: 'start' });
  });
  $('download').addEventListener('click', function () {
    if (!lastResult) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(lastResult.payload)], { type: 'application/json' }));
    a.download = 'orbicula-recibido-' + Date.now() + '.json';
    document.body.append(a); a.click(); a.remove();
  });
  $('copy').addEventListener('click', function () {
    var text = lines.join('\n') + '\n\n' + $('result').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { log('→', 'registro copiado'); },
      function () { log('→', 'no se pudo copiar', 'bad'); });
  });

  // Para la comprobación automática (scripts/dev/check-hub.cjs).
  window.__hub = { get lastResult() { return lastResult; }, lines: lines, send: send };
})();
