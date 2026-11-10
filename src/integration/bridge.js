// Transporte postMessage entre orbicula (iframe) y el hub. Sin DOM propio: recibe la ventana.
//
// Reglas (privacidad: el resultado es un dato clínico):
//  - Los mensajes salientes van SOLO al origen del padre, y solo si está en la lista de permitidos.
//    Nunca con "*".
//  - Los entrantes se aceptan solo si vienen del marco padre (`event.source`) Y de un origen permitido.
//  - El origen del padre sale de `location.ancestorOrigins` (Chrome) y, si no existe, de `document.referrer`
//    (la página lleva Referrer-Policy: no-referrer, pero eso solo afecta a lo que ella envía, no a lo que
//    recibió); si tampoco hay, del origen del primer mensaje válido. Hasta entonces lo que se envíe espera.
//  - Si el padre está y no es un origen permitido, orbicula no manda ni acepta nada.
import { MSG, HUB, buildReady, buildResult } from './messages.js';
import { originOf } from './origins.js';

const MAX_PENDING = 5;

/**
 * @param {{win?: Window, allowed: Set<string>, appVersion: string, permissions?: () => ({camera: boolean, screenWakeLock: boolean}|null), referrer?: string,
 *          handlers?: {config?: (payload: unknown) => void, hidden?: () => void, visible?: () => void}}} o
 */
export function createBridge({ win = window, allowed, appVersion, permissions = () => null, referrer = win.document?.referrer ?? '', handlers = {} }) {
  const parent = win.parent;
  const embedded = !!parent && parent !== win;
  let parentOrigin = null;
  let blocked = false;
  let started = false;
  const pending = [];

  if (embedded) {
    const ancestors = win.location?.ancestorOrigins;
    if (ancestors && ancestors.length) {
      // Lo que dice el navegador manda: si el padre no está permitido, no se mira nada más.
      if (allowed.has(ancestors[0])) parentOrigin = ancestors[0];
      else blocked = true;
    } else {
      const r = originOf(referrer);
      if (r && allowed.has(r)) parentOrigin = r;
    }
  }

  function flush() {
    while (parentOrigin && pending.length) parent.postMessage(pending.shift(), parentOrigin);
  }

  /** @returns {'sent'|'queued'|'blocked'|'standalone'} */
  function send(msg, { replaceKey = null } = {}) {
    if (!embedded) return 'standalone';
    if (blocked) return 'blocked';
    if (parentOrigin) {
      parent.postMessage(msg, parentOrigin);
      return 'sent';
    }
    // Origen aún desconocido: espera al primer mensaje válido del padre.
    if (replaceKey) {
      const i = pending.findIndex((m) => m.type === msg.type && m.sessionId === replaceKey);
      if (i >= 0) pending.splice(i, 1);
    }
    pending.push(msg);
    while (pending.length > MAX_PENDING) pending.shift();
    return 'queued';
  }

  function onMessage(e) {
    if (!embedded || blocked || e.source !== parent) return;
    if (!allowed.has(e.origin)) return;
    if (parentOrigin && e.origin !== parentOrigin) return;
    const data = e.data;
    if (data === null || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (!parentOrigin) {
      parentOrigin = e.origin;
      flush();
    }
    if (data.type === MSG.config) handlers.config?.(data.payload);
    else if (data.type === HUB.hidden) handlers.hidden?.();
    else if (data.type === HUB.visible) handlers.visible?.();
  }

  return {
    embedded,
    get parentOrigin() { return parentOrigin; },
    get blocked() { return blocked; },
    /** Empieza a escuchar y avisa con `orbicula:ready`. */
    start() {
      if (started || !embedded) return;
      started = true;
      win.addEventListener('message', onMessage);
      send(buildReady(appVersion, permissions()));
    },
    /** Manda el resultado (JSON público) al hub. */
    sendResult(doc, sessionId = null) {
      return send(buildResult(doc, sessionId), { replaceKey: sessionId });
    },
  };
}
