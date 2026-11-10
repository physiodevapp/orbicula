// Mantener la pantalla encendida durante un protocolo o un análisis (Wake Lock). Dentro de un iframe el
// navegador solo lo permite si el hub concede `allow="screen-wake-lock"`; se comprueba antes de pedirlo
// (si no, el navegador deja un error de «permissions policy» en la consola).

/** ¿La política de permisos de esta página deja usar `feature`? (true si el navegador no sabe decirlo). */
export function featureAllowed(feature, doc = document) {
  try {
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    return policy ? policy.allowsFeature(feature) : true;
  } catch {
    return true;
  }
}

/** Pide el bloqueo de pantalla; devuelve el bloqueo, o null si no se puede (sin permiso o sin soporte). */
export async function requestWake() {
  if (!navigator.wakeLock || !featureAllowed('screen-wake-lock')) return null;
  try { return await navigator.wakeLock.request('screen'); } catch { return null; }
}
