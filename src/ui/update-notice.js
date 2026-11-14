// Aviso flotante «Hay una versión nueva» (ver src/app/version.js). Es `fixed`: no ocupa sitio, así que no
// mueve lo medido ni la maquetación. Se puede cerrar y no vuelve hasta que se publique OTRA versión distinta.
// No deja recargar mientras haya algo en marcha (un protocolo, un análisis de vídeo, una prueba, un vídeo
// grabado sin analizar): recargar lo perdería.
import { watchVersion } from '../app/version.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{current: string, isBusy?: () => string|null, doc?: Document}} o
 *   isBusy: motivo (texto corto) por el que ahora NO conviene recargar, o null.
 */
export function createUpdateNotice({ current, isBusy = () => null, url = new URL('version.json', document.baseURI).href }) {
  const el = { box: $('updateNotice'), text: $('updateText'), reload: $('updateReload'), close: $('updateClose') };
  if (!el.box) return { stop() {} };
  let dismissed = null;
  let pending = null;
  let timer = null;

  function render() {
    if (!pending || pending.commit === dismissed) { el.box.hidden = true; clearInterval(timer); timer = null; return; }
    const busy = isBusy();
    el.box.hidden = false;
    el.reload.disabled = !!busy;
    el.text.textContent = busy
      ? `Hay una versión nueva. ${busy}: cuando acabe, recarga.`
      : 'Hay una versión nueva. Lo guardado en este móvil se conserva al recargar.';
    // Con el aviso a la vista, se vuelve a mirar cada poco: puede empezar una prueba después (hay que desactivar
    // «Recargar») o acabar la que había (hay que activarlo).
    timer ??= setInterval(render, 2000);
  }

  el.reload.addEventListener('click', () => { if (isBusy()) render(); else location.reload(); });
  el.close.addEventListener('click', () => { dismissed = pending?.commit ?? null; render(); });

  return watchVersion({ current, url, onNew: (v) => { pending = v; render(); } });
}
