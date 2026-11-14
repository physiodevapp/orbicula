// Modo alojado: orbicula dentro del hub PhysiQ (iframe con ?host=physiq). Sin DOM propio ni red.
// El atributo `data-host` de <html> lo pone antes de pintar `public/host.js`; aquí se lee y se razona.
export const HOSTS = ['physiq'];

/** Anfitrión que pide la dirección (`?host=physiq`), o null (también si es un nombre desconocido). */
export function hostFrom(search) {
  const host = new URLSearchParams(search).get('host');
  return HOSTS.includes(host) ? host : null;
}

/** Anfitrión activo en esta página (el que dejó puesto `public/host.js`). */
export function currentHost(doc = document) {
  const host = doc.documentElement.dataset.host;
  return HOSTS.includes(host) ? host : null;
}
