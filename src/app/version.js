// ¿Hay publicada una versión más nueva que la de esta página? Cada build escribe `version.json` con su commit
// (el mismo que muestra el pie). La app lo pide sin caché al abrir, al volver a ella (cambiar de pestaña, volver
// desde las recientes de Android) y cada 10 minutos mientras se ve: una versión vieja puede seguir abierta días.
// Es una petición al PROPIO origen, para cargar la propia app: la CSP (`connect-src 'self'`) y la barrera de
// privacidad la permiten y no sale ningún dato del paciente. Sin DOM propio: recibe `doc` y `win`.

/** Cada cuánto se comprueba mientras la app está a la vista. */
export const CHECK_EVERY_MS = 10 * 60 * 1000;

/** Lo publicado, si es lo que se espera (un servidor de desarrollo devuelve la página: no vale). */
export function readVersion(v) {
  if (v === null || typeof v !== 'object') return null;
  const { commit, branch } = v;
  return typeof commit === 'string' && commit !== '' ? { commit, branch: typeof branch === 'string' ? branch : null } : null;
}

/** Hay versión nueva si lo publicado es OTRO commit que el de esta página (y esta página no es de desarrollo). */
export function isNewVersion(current, published) {
  return !!published && !!current && current !== 'dev' && published.commit !== current;
}

/**
 * Vigila `version.json`. Un fallo (sin conexión, no es JSON, servidor de desarrollo) no avisa de nada.
 * @param {{current: string, url: string, onNew: (v: {commit: string, branch: string|null}) => void,
 *          fetchFn?: typeof fetch, doc?: Document, win?: Window, intervalMs?: number}} o
 * @returns {{check: () => Promise<void>, stop: () => void}}
 */
export function watchVersion({ current, url, onNew, fetchFn = fetch, doc = document, win = window, intervalMs = CHECK_EVERY_MS }) {
  let announced = null; // el último commit avisado: no se avisa dos veces de lo mismo
  let stopped = false;

  async function check() {
    if (stopped || doc.visibilityState !== 'visible') return;
    try {
      const r = await fetchFn(url, { cache: 'no-store' });
      if (!r.ok) return;
      const published = readVersion(await r.json());
      if (!stopped && isNewVersion(current, published) && published.commit !== announced) {
        announced = published.commit;
        onNew(published);
      }
    } catch {
      /* sin conexión o no es JSON: no se sabe, no se avisa */
    }
  }

  const timer = setInterval(check, intervalMs);
  doc.addEventListener('visibilitychange', check);
  win.addEventListener('pageshow', check);
  check();
  return {
    check,
    stop() {
      stopped = true;
      clearInterval(timer);
      doc.removeEventListener('visibilitychange', check);
      win.removeEventListener('pageshow', check);
    },
  };
}
