// Barrera de privacidad en el propio código: bloquea toda llamada de red a otro origen
// (fetch, XMLHttpRequest, WebSocket, EventSource y sendBeacon). Es una segunda defensa, además
// de la CSP de public/_headers, que solo existe si el hosting sirve esas cabeceras (no es el caso
// de GitHub Pages, donde el hub copiará orbicula) y que un worker no hereda de la página.
//
// Motivo: la librería de MediaPipe intenta enviar un registro de uso a
// https://odml.pa.googleapis.com/v1/log. Con esta barrera no sale nada, se sirva como se sirva.

const BLOCKED_MESSAGE = 'Bloqueado: orbicula no hace llamadas de red a otros orígenes (privacidad)';

/**
 * @param {object} scope `window` o `self` (en los tests, un objeto de prueba)
 * @param {{onBlock?: (info: {via: string, host: string}) => void}} opts
 * @returns {{blockedHosts: Set<string>}} dominios a los que se intentó llamar
 */
export function installNetworkGuard(scope, { onBlock } = {}) {
  const blockedHosts = new Set();
  const origin = scope.location?.origin;
  const base = scope.location?.href;

  const parse = (url) => {
    try {
      return new URL(String(url), base);
    } catch {
      return null;
    }
  };
  const allowed = (url) => {
    const u = parse(url);
    return !!u && (u.origin === origin || u.protocol === 'data:' || u.protocol === 'blob:');
  };
  const block = (via, url) => {
    const host = parse(url)?.host || 'url no válida';
    blockedHosts.add(host);
    onBlock?.({ via, host });
  };

  if (typeof scope.fetch === 'function') {
    const realFetch = scope.fetch.bind(scope);
    scope.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input?.url ?? input);
      if (!allowed(url)) {
        block('fetch', url);
        return Promise.reject(new TypeError(BLOCKED_MESSAGE));
      }
      return realFetch(input, init);
    };
  }

  const xhr = scope.XMLHttpRequest?.prototype;
  if (xhr?.open) {
    const realOpen = xhr.open;
    xhr.open = function open(method, url, ...rest) {
      if (!allowed(url)) {
        block('xhr', url);
        throw new DOMException(BLOCKED_MESSAGE, 'SecurityError');
      }
      return realOpen.call(this, method, url, ...rest);
    };
  }

  for (const name of ['WebSocket', 'EventSource']) {
    const Real = scope[name];
    if (typeof Real !== 'function') continue;
    scope[name] = function Guarded(url, ...rest) {
      if (!allowed(url)) {
        block(name.toLowerCase(), url);
        throw new DOMException(BLOCKED_MESSAGE, 'SecurityError');
      }
      return new Real(url, ...rest);
    };
    scope[name].prototype = Real.prototype;
  }

  const nav = scope.navigator;
  if (nav && typeof nav.sendBeacon === 'function') {
    const real = nav.sendBeacon.bind(nav);
    nav.sendBeacon = (url, data) => {
      if (!allowed(url)) {
        block('beacon', url);
        return false;
      }
      return real(url, data);
    };
  }

  return { blockedHosts };
}
