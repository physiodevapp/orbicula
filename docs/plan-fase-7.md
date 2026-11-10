# Plan de la fase 7: exportación e integración

**Aprobado por el autor el 2026-11-10, con las recomendaciones:**
- origen del hub: `https://physiodevapp.github.io` (más el propio origen);
- CSV en dos archivos;
- `timeseries` con las señales de la cara y el cierre por flujo, sin el flujo por zonas;
- acceso de lectura al repo `physiodevapp/physiq` para los tokens (7b). Se lee junto con `CLAUDE.md` (secciones «Exportación» e «Integrabilidad con PhysiQ») y las conclusiones de `docs/plan-fase-5.md` y `docs/plan-fase-6.md`. La rama sale de `feat/fase-6-video`, que sale de `feat/fase-5-protocolo`: los PR 5 → 6 → 7 se fusionan en ese orden.

## Qué tiene que hacer
Cerrar los criterios de aceptación 5 y 6 de `CLAUDE.md`:
- **5.** El JSON exportado valida contra el esquema documentado.
- **6.** Cargada en un iframe con `?host=physiq`, emite `ready` y `result` y aplica la configuración recibida.

Y entregar:
1. **JSON público**, con el esquema versionado de `CLAUDE.md`, y su documentación en `docs/schema.md`.
2. **CSV** de las series temporales.
3. **Modo alojado** (`?host=physiq`): sin cabecera ni pie y con los tokens visuales del hub.
4. **API `postMessage`:** `ready`, `result` y `config`, con lista de orígenes permitidos.
5. **Pie de marca** «Parte del ecosistema PhysiQ» en modo autónomo (ya existe).

Hasta ahora, lo que se descarga es el **JSON de diagnóstico** del asistente (`orbicula-test-session/3`): series completas del flujo por ROI, pensado para ajustar umbrales. El **JSON público** es otro, más corto y estable: es la interfaz que usa el hub y, más adelante, el estudio de validación.

## El JSON público (propuesta)
El esquema de `CLAUDE.md`, rellenado así:

```json
{
  "app": "orbicula",
  "appVersion": "0.1.0",
  "schemaVersion": "1",
  "createdAt": "2026-11-10T13:02:00.000Z",
  "participantCode": null,
  "capture": { "source": "live|file", "analysis": "live|frame-by-frame", "camera": "rear|front", "fps": 27.5, "width": 720, "height": 1280, "mirrored": false },
  "protocol": [{ "phase": "rest", "start": 0, "end": 30000 }],
  "calibration": { "valid": true, "thresholds": { "left": 0.045, "right": 0.062 }, "earBaseline": { "left": 0.34, "right": 0.32 }, "warnings": [] },
  "metrics": { "left": { "rest": { "ear": 0.34 }, "natural": { "blinksPerMin": 12 } }, "right": {}, "asymmetry": {} },
  "quality": { "natural": { "reliable": true, "faceFraction": 1, "headMoving": 0, "analysisFps": 26.4, "notes": [] } },
  "events": [{ "phase": "natural", "side": "left", "kind": "contraction", "status": "ok", "t": 8600, "duration": 1566, "peak": 1.0 }],
  "timeseries": { "t": [], "left": { "ear": [], "aperture": [], "smile": [], "closure": [] }, "right": {} }
}
```

**Decisiones de forma (para que las revises):**
- **Tiempos en milisegundos** desde el inicio de la grabación, en todo el documento.
- **Lados siempre del paciente:** `left` = izquierda del paciente.
- **`metrics.<lado>.<fase>.<métrica>`:** las mismas métricas del resumen de la pantalla, con su unidad documentada en `docs/schema.md`. `asymmetry` tiene la misma forma y solo las métricas positivas, `(I − D) / (I + D)`.
- **`capture`** sigue `CLAUDE.md` (`source`, `camera`, `fps`, `width`, `height`, `mirrored`) y añade `analysis`: `live` (el directo) o `frame-by-frame` (vídeo grabado, de la 6).
- **`protocol`:** las fases con su inicio y fin reales. En el análisis libre de un vídeo, `rest` y `free`.
- **`calibration`, `quality` y `events`** salen del motor de la fase 5. En `events` van todos, con su `status` (`ok`, `head`, `blink`, `brief`), y quien los use filtra.
- **`timeseries`:** un solo eje `t` con las señales de la cara (EAR, apertura, sonrisa, cierre por flujo) por lado, remuestreadas al instante del análisis de la cara. **No** lleva el flujo por ROI: eso se queda en el JSON de diagnóstico. Redondeo a 3 decimales; un protocolo pesa unos cientos de KB.
- **Sin identificación del paciente.** Solo `participantCode`, que escribe el clínico (el que ya existe en las tarjetas).
- **Compatibilidad:** `schemaVersion: "1"`. Un cambio que rompa la compatibilidad sube la versión.

## El esquema y su validación
- `docs/schema.md`: cada campo, su unidad, cuándo puede faltar y un ejemplo completo.
- `docs/orbicula-result.schema.json`: el esquema en **JSON Schema** (draft 2020-12), que valida de verdad.
- Un test que exporta un resultado real (de los JSON de las fases 5 y 6) y lo valida contra el esquema. Para validar uso `ajv`, **solo como dependencia de desarrollo**, con versión fija y de más de dos semanas.
- **Antes de fijar `schemaVersion: "1"`, revisión del esquema con Opus**, como indica `docs/modelos.md`.

### Revisión del esquema con Opus (hecha)
Se aprobaron los ocho cambios y se aplicaron antes de fijar `"1"`:
1. **Compatibilidad hacia delante:** el esquema ya no prohíbe campos de más. Añadir un campo o una métrica no cambia la versión; quitar o cambiar el significado, sí. Un test comprueba que el JSON lleva justo los campos conocidos.
2. **Nombres de las métricas** en el esquema (`$defs.metricSet`), con un test que los compara con los que produce `summary.js` y con `docs/schema.md`.
3. **Bloque `analysis`** con la procedencia: versiones de MediaPipe (y modelo) y OpenCV, configuración del flujo, parámetros del detector y del congelado. Nada del dispositivo.
4. **`timeseries.frozen`:** marca las muestras con el cierre por flujo congelado, que antes solo estaban en el CSV de flujo. También va como columna `closure_frozen` en el CSV de la cara.
5. **Códigos además de textos:** `calibration.reasonCode`, y `{ code, text }` en los avisos y en las notas de calidad.
6. **`tPeak`** en las contracciones.
7. **`participantCode` restringido** (`^[A-Za-z0-9_-]{1,24}$`): un nombre con espacios o tildes se rechaza, no se «limpia» (si no, «Juan Pérez» saldría como «JuanPrez»). La app no descarga nada y lo dice.
8. **Correcciones de `docs/schema.md`:** signo de la asimetría y significado de `closure` en la sonrisa.

## El CSV
Dos archivos, porque las series de la cara y las del flujo no comparten instantes:
- `orbicula-cara-….csv`: `t_ms, phase, left_ear, right_ear, left_aperture, right_aperture, left_smile, right_smile`.
- `orbicula-flujo-….csv`: `t_ms, phase, left_closure, right_closure, left_closure_frozen, right_closure_frozen, head_u, head_v` (el cierre por flujo y el movimiento de la cabeza).

Con coma como separador, punto decimal, cabecera y sin ningún dato del paciente. Los dos se descargan con un solo botón.

## Dónde se exporta
En los **tres resultados** que ya hay, con un botón «Resultados (JSON público)» y otro «CSV» junto al resumen:
1. El protocolo en directo.
2. El protocolo grabado y analizado fotograma a fotograma.
3. El análisis libre de un vídeo grabado.

El JSON de diagnóstico se queda como está, para el desarrollo.

## 7a bis. Sesiones guardadas (petición del autor, tras probar 7a)
Recargar la página perdía un protocolo o 2 minutos de análisis de vídeo. Se copió el diseño de `dualkinema` (IndexedDB, sin el vídeo, huella del archivo sin el nombre, cabecera y datos en dos almacenes, esquema con versión) y se adaptó a que el análisis de orbicula es de una sola pasada.
- **Cuándo se guarda:** al terminar, no de forma continua. Un análisis a medias no se reanuda (la calibración depende de un reposo continuo).
- **Privacidad (decidido por el autor):** se guarda por defecto, con aviso visible en la tarjeta; 5 sesiones como máximo; caducan a los 30 días; «Borrar» y «Borrar todo»; nada en modo alojado; solo el código anónimo (un nombre se rechaza).
- **Procedencia:** se guarda con la sesión el bloque `analysis` del momento del análisis; el JSON de una sesión recuperada lo usa, aunque la app se haya actualizado (el resumen sí se recalcula con la versión actual).
- **Comprobación:** `scripts/dev/check-saved.cjs` y `tests/persistence.test.js`.

## Modo alojado (`?host=physiq`)
- Se ocultan la cabecera y el pie; el resto de la app no cambia.
- **Tokens:** ya están todos en `src/styles/tokens.css`, con tema claro y oscuro. Para que adopte los del hub:
  - `?host=physiq` carga un bloque de tokens propios del hub, sobre los de orbicula, y respeta el tema que mande el hub.
  - **Necesito mirar el repo del hub** (`physiodevapp/physiq`) para tomar sus tokens y sus convenciones, como pide `CLAUDE.md`. Ninguna importación: se copian los valores.
- **Cabecera para el iframe:** ya hay `frame-ancestors 'self' https://physiodevapp.github.io` en `public/_headers`. El hub tiene que cargarla con `allow="camera"`, porque la política de permisos solo da la cámara a `self`.

### 7b: lo que se ha visto en el repo `physiq` (para 7d, `docs/integracion.md`)
- **Convenciones de los satélites:** cada uno detecta que va dentro del hub y oculta su cabecera (`in-hub`); los neutros son los mismos (`#0a0d12`, `#111620`, `#232d45`, `#2d3a58`, `#5a6e8a`) y cada satélite tiene su propio acento (morado, verde, naranja, rosa…). El hub es solo oscuro y `assessment` fuerza el oscuro dentro del iframe. Orbicula hace lo mismo y mantiene su cyan.
- **Lo que tiene que hacer el hub:** una entrada en `SATS` con `'/physiq/orbicula/?host=physiq'` (el hub carga cada satélite con una dirección fija; sin `?host=physiq` orbicula se ve con su cabecera), un `<iframe id="sat-orbicula" allow="camera" hidden>` y cargarlo **bajo demanda** (como `wiki`): precargarlo al arrancar bajaría el modelo de la cara y el WASM sin que nadie lo pida.
- **Color de la tarjeta:** el cyan de orbicula (`#5ec8d8`) se parece al de `balance` (`#22d3ee`). Convendría otro color para la tarjeta de orbicula en el hub.
- **Mensajes del hub (`PHYSIQ_SAT_VISIBLE`, `PHYSIQ_SAT_HIDDEN`, `PHYSIQ_MODE`):** el hub los manda con destino `'*'`. Orbicula no usa nunca `'*'` al enviar (solo al origen del hub); al recibirlos, valida el origen. Queda por decidir en 7c si al ocultarse apaga la cámara.

## API `postMessage`
- **`{ type: "orbicula:ready" }`** al cargar, hacia el origen del padre.
- **`{ type: "orbicula:result", payload }`** al terminar un protocolo, con el JSON público. También al terminar el análisis fotograma a fotograma del protocolo grabado, con `capture.analysis: "frame-by-frame"`.
- **`{ type: "orbicula:config", payload: { theme, lang, protocol } }`** que llega del hub:
  - `theme`: `light`, `dark` o `auto`;
  - `lang`: de momento solo `es`, y se guarda para cuando haya más idiomas;
  - `protocol`: `{ restSec, naturalSec, reps }`, los valores de la tarjeta del protocolo.
- **Orígenes permitidos:** una lista configurable en `src/integration/origins.js`, que de partida tiene el propio origen y `https://physiodevapp.github.io`. Cada mensaje entrante se valida con `event.origin`. **Los mensajes salientes van solo al origen del padre, si está en la lista:** el resultado es un dato clínico y nunca se manda con `"*"`. El origen del padre se saca de `location.ancestorOrigins` y, si el navegador no lo da, de `document.referrer` (la política `no-referrer` de orbicula afecta a lo que ella envía, no a lo que recibió); y si tampoco hay, del origen del primer mensaje válido (lo que haya que enviar espera hasta entonces).
- **Independencia:** ningún módulo importa nada de PhysiQ. El hub depende de orbicula.

### 7c: decisiones del autor y hallazgos
- **El hub oculta orbicula:** se aceptan `PHYSIQ_SAT_HIDDEN` y `PHYSIQ_SAT_VISIBLE` (los que el hub ya manda a sus satélites; solo de un origen permitido y sin importar nada del hub). Al ocultarse: cámara apagada y protocolo detenido conservando lo hecho; un análisis de vídeo sigue.
- **Qué se manda como `orbicula:result`:** solo el protocolo en directo y el protocolo grabado, con `sessionId`. El análisis de un vídeo suelto no.
- **Hallazgo:** dentro de un iframe, el bloqueo de pantalla exige `allow="screen-wake-lock"` en el iframe del hub (ahora se comprueba antes de pedirlo, y el `ready` informa de los permisos).

## Pasos (me detengo al final de cada uno para que lo pruebes en el móvil)
1. **7a. JSON público, esquema y CSV.** Botones en los tres resultados, el esquema en JSON Schema, `docs/schema.md`, los tests de validación y la revisión del esquema con Opus.
   - **Tu prueba:** hacer un protocolo, descargar el JSON público y el CSV, abrir el CSV en la hoja de cálculo del móvil y pasármelos.
2. **7b. Modo alojado.** `?host=physiq` y los tokens del hub.
   - **Tu prueba:** abrir la dirección con `?host=physiq` y ver que desaparecen la cabecera y el pie y que se ve con el tema del hub.
3. **7c. API `postMessage`.**
   - Una página de prueba que carga orbicula en un iframe y comprueba `ready`, `result` y `config`, con orígenes permitidos y no permitidos (criterio 6).
   - **Tu prueba:** abrir esa página de prueba en el móvil.
4. **7d. Cierre.** `docs/integracion.md` (la API para quien programe el hub), README, CHANGELOG y conclusión. **Después propongo la mejora pendiente:** el análisis de la cara en paralelo (fase 6).

## Pruebas
- **Tests unitarios:** construcción del JSON público desde los resultados de las tres fuentes; validación contra el esquema; asimetrías solo de magnitudes positivas; tiempos en ms y lados del paciente; sin ningún campo que identifique al paciente; el CSV (columnas, separadores, número de filas).
- **De punta a punta, con Playwright:** el protocolo con la cámara simulada → JSON público → validación contra el esquema. La página de prueba con un iframe → `ready`, `result` y `config`, y un origen no permitido que no recibe nada.
- **Privacidad:** comprobar que la CSP sigue sin permitir ningún origen externo y que `result` no se envía a un origen que no esté en la lista.

## Riesgos
- **Congelar el esquema demasiado pronto:** por eso la revisión con Opus y por eso `schemaVersion` se sube si algo rompe.
- **El tamaño del JSON:** un protocolo de 4 min a 30 Hz son ~7000 muestras por señal; con las 8 señales, unos 400–600 KB. Si pesa mucho al pasarlo por `postMessage`, se submuestrea o se manda solo el resumen.
- **Los tokens del hub:** si el repo del hub no es accesible desde la sesión, habrá que dejarlos como un bloque que el hub pueda sobrescribir.
- **El origen del padre:** `location.ancestorOrigins` existe en Chrome y no en Firefox; el respaldo por el primer mensaje cubre ese caso.

## Modelo recomendado
- **Plan:** Sonnet (este documento).
- **7a:** Sonnet, y **Opus con esfuerzo bajo-medio para revisar el esquema** antes de fijarlo.
- **7b, 7c y 7d:** Sonnet, esfuerzo medio.

## Decisiones que necesito del autor
1. **Origen del hub:** ¿`https://physiodevapp.github.io` es el único origen del hub, o hay más (un dominio propio, el de desarrollo…)?
2. **CSV:** ¿te vale en dos archivos (cara y flujo)? Es lo más limpio, porque no comparten instantes.
3. **Qué lleva `timeseries`:** las señales de la cara más el cierre por flujo, sin el flujo por ROI. ¿Te parece bien o quieres más?
4. **Tokens del hub:** ¿puedo leer el repo `physiodevapp/physiq`? Lo pide `CLAUDE.md`, y es la única forma de copiar bien sus tokens.
