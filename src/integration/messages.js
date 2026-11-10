// Mensajes entre orbicula y el hub (iframe): constantes, validación de la configuración y construcción de
// los mensajes salientes. Funciones puras, sin DOM. Documentado en docs/integracion.md.
import { PROTOCOL_OPTIONS } from '../protocol/steps.js';
import { SCHEMA_VERSION } from '../export/result.js';

/** Mensajes propios de orbicula. */
export const MSG = { ready: 'orbicula:ready', result: 'orbicula:result', config: 'orbicula:config' };
/**
 * Avisos que el hub ya manda a todos sus satélites cuando muestra u oculta su iframe. Se reconocen por su
 * texto (no se importa nada del hub), y solo si vienen de un origen permitido.
 */
export const HUB = { hidden: 'PHYSIQ_SAT_HIDDEN', visible: 'PHYSIQ_SAT_VISIBLE' };

export const THEMES = ['light', 'dark', 'auto'];
export const LANGS = ['es'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Valida el `payload` de `orbicula:config`. Los valores buenos se aplican y los malos se ignoran, cada uno
 * con su motivo (el hub los verá en la consola de orbicula).
 * @returns {{applied: {theme?: string, lang?: string, protocol?: {restSec?: number, naturalSec?: number, reps?: number}},
 *            rejected: {key: string, reason: string}[]}}
 */
export function parseConfig(payload) {
  const applied = {};
  const rejected = [];
  if (!isObject(payload)) return { applied, rejected: [{ key: 'payload', reason: 'tiene que ser un objeto' }] };
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'theme') {
      if (THEMES.includes(value)) applied.theme = value;
      else rejected.push({ key, reason: `valores admitidos: ${THEMES.join(', ')}` });
    } else if (key === 'lang') {
      if (LANGS.includes(value)) applied.lang = value;
      else rejected.push({ key, reason: `idioma no disponible (de momento: ${LANGS.join(', ')})` });
    } else if (key === 'protocol') {
      if (!isObject(value)) { rejected.push({ key, reason: 'tiene que ser un objeto { restSec, naturalSec, reps }' }); continue; }
      for (const [k, v] of Object.entries(value)) {
        const options = PROTOCOL_OPTIONS[k];
        if (!options) rejected.push({ key: `protocol.${k}`, reason: 'campo desconocido' });
        else if (options.includes(Number(v)) && v !== null && v !== '') (applied.protocol ??= {})[k] = Number(v);
        else rejected.push({ key: `protocol.${k}`, reason: `valores admitidos: ${options.join(', ')}` });
      }
    } else {
      rejected.push({ key, reason: 'campo desconocido' });
    }
  }
  return { applied, rejected };
}

/**
 * `orbicula:ready`: con la versión de la app y del esquema del JSON, para que el hub sepa qué recibirá, y
 * los permisos que el iframe tiene concedidos (`camera`, `screenWakeLock`): si falta uno, el hub lo ve desde
 * aquí en vez de descubrirlo con una cámara que no enciende o una pantalla que se apaga en el protocolo.
 */
export function buildReady(appVersion, permissions = null) {
  return { type: MSG.ready, payload: { appVersion, schemaVersion: SCHEMA_VERSION, ...(permissions ? { permissions } : {}) } };
}

/**
 * `orbicula:result`: el JSON público (docs/schema.md) en `payload`. `sessionId` (el inicio del protocolo) va
 * fuera del JSON: el protocolo grabado puede mandar un segundo resultado, más sensible, minutos después, y
 * con el mismo `sessionId` el hub puede reemplazar el primero.
 */
export function buildResult(doc, sessionId = null) {
  return { type: MSG.result, sessionId, payload: doc };
}
