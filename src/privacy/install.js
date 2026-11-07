// Se importa PRIMERO en la página y en el worker (los módulos se evalúan en el orden de los
// import), para que la barrera esté puesta antes de que MediaPipe cargue y pueda guardar
// referencias a fetch o XMLHttpRequest.
import { installNetworkGuard } from './guard.js';

export const guard = installNetworkGuard(globalThis, {
  onBlock: ({ via, host }) => {
    console.warn(`orbicula: llamada de red bloqueada (${via} → ${host})`);
    // En un worker, se avisa a la página para que lo anote.
    if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
      globalThis.postMessage({ type: 'blocked', host });
    }
  },
});
