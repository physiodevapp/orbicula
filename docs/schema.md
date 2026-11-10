# Esquema del JSON público de resultados (`schemaVersion: "1"`)

El JSON de resultados es la **interfaz pública de orbicula**: lo que consume el hub PhysiQ y lo que se junta en un estudio. Está definido formalmente en [`orbicula-result.schema.json`](orbicula-result.schema.json) (JSON Schema, draft 2020-12) y un test lo valida con un resultado generado por la propia app (`tests/export.test.js`, `scripts/dev/check-export.cjs`).

> No es el JSON de diagnóstico del asistente de pruebas (`orbicula-test-session/3`, [`pruebas.md`](pruebas.md)), que lleva las series completas del flujo por ROI y sirve para ajustar umbrales. **Este es el estable.**

**Compatibilidad:** no se rompe sin subir `schemaVersion`. Añadir un campo opcional dentro de `metrics` no la rompe; cambiar el nombre, la unidad o el significado de un campo, sí.

## Reglas generales
- **Tiempos en milisegundos** desde el inicio de la grabación (el primer fotograma del primer paso es 0).
- **Lados del paciente:** `left` es la izquierda **del paciente**, también con la cámara frontal o con un vídeo en espejo (la app ya lo corrige; ver `capture.mirrored`).
- **Sin identificación del paciente:** ni nombre, ni archivo, ni imagen. Solo `participantCode`, que escribe el clínico (máx. 24 caracteres).
- **Distancia intercantal (DI):** la distancia entre las comisuras internas de los ojos; las magnitudes de movimiento se dan en DI para no depender de la distancia a la cámara.
- **Valores que faltan** valen `null`; nunca se omiten campos obligatorios.

## Estructura
```jsonc
{
  "app": "orbicula",
  "appVersion": "0.1.0",
  "schemaVersion": "1",
  "createdAt": "2026-11-10T13:02:00.000Z",
  "participantCode": "P01",            // o null
  "capture": { "source": "live", "analysis": "live", "camera": "rear", "fps": 29.97, "width": 720, "height": 1280, "mirrored": false },
  "protocol": [ { "phase": "rest", "start": 0, "end": 30014 } ],
  "calibration": { "valid": true, "reason": null, "thresholds": { "left": 0.045, "right": 0.062 }, "earBaseline": { "left": 0.34, "right": 0.32 }, "headStill": 0.1, "warnings": [] },
  "metrics": { "left": { "natural": { "blinksPerMin": 12 } }, "right": { }, "asymmetry": { } },
  "quality": { "natural": { "reliable": true, "faceFraction": 1, "headMoving": 0, "analysisFps": 26.4, "notes": [] } },
  "events": [ { "phase": "natural", "side": "left", "kind": "contraction", "status": "ok", "t": 38600, "duration": 1566, "peak": 1.0 } ],
  "timeseries": { "t": [], "phase": [], "left": { "ear": [], "aperture": [], "blink": [], "smile": [], "closure": [] }, "right": { } }
}
```

## Campos
### `capture`
| Campo | Valores | Significado |
|---|---|---|
| `source` | `live`, `file` | `live`: la cámara de la app (también un vídeo que la app graba durante el protocolo); `file`: un vídeo grabado con otra app. |
| `analysis` | `live`, `frame-by-frame` | En directo, o vídeo analizado fotograma a fotograma (más sensible). |
| `camera` | `rear`, `front`, `null` | Cámara con que se grabó. |
| `fps` | número o `null` | Fotogramas por segundo de la cámara (en directo, la mediana de los pasos; en un vídeo, los del archivo). |
| `width`, `height` | enteros o `null` | Tamaño de la imagen, ya girada. |
| `mirrored` | booleano | La imagen analizada iba en espejo y los lados ya están corregidos. |

### `protocol`
Las fases que se hicieron, con `start` y `end` en ms (entre una fase y la siguiente hay un hueco: cuenta atrás y pausa). Fases (`phase`):

| Valor | Fase |
|---|---|
| `rest` | Reposo (calibración) |
| `natural` | Parpadeo espontáneo |
| `soft` | Cierre suave |
| `forced` | Cierre forzado |
| `brows` | Elevación de cejas |
| `smile` | Sonrisa amplia |
| `free` | Resto de un vídeo grabado, tras el reposo |

### `calibration`
Sale del reposo del propio paciente; `null` si no hubo reposo.
| Campo | Significado |
|---|---|
| `valid`, `reason` | Si el reposo valía (cara, cabeza quieta, pocos parpadeos) y, si no, por qué. |
| `thresholds` | Umbral de los eventos por lado: subida del cierre por flujo, en DI. |
| `earBaseline` | EAR en reposo por lado. |
| `headStill` | Velocidad del dorso nasal (DI/s) por debajo de la cual se considera la cabeza quieta. |
| `warnings` | Avisos (p. ej. «umbral alto por una sacudida suelta del párpado»). |

### `metrics`
`metrics.left.<fase>.<métrica>`, `metrics.right.<fase>.<métrica>` y `metrics.asymmetry.<fase>.<métrica>`. La **asimetría** es `(I − D) / (I + D)`, de −1 a +1; 0 es simétrico, y solo se calcula para magnitudes positivas (no para recuentos de contracciones). **Puede faltar cualquier métrica**, según la fase y los datos.

| Métrica | Fases | Unidad | Significado |
|---|---|---|---|
| `ear` | `rest` | — | EAR en reposo (apertura vertical / ancho del ojo). |
| `earNoise` | `rest` | — | Desviación típica del EAR en reposo. |
| `aperture` | `rest` | — | Apertura palpebral / distancia intercantal. |
| `threshold` | `rest` | DI | Umbral de los eventos de ese ojo. |
| `spectrumFreqHz` | `rest`, `natural`, `free` | Hz | Frecuencia del pico espectral del párpado. |
| `spectrumProminenceDb` | ídem | dB | Prominencia de ese pico sobre la mediana de la banda 0,5–8 Hz. |
| `spectrumRhythmic` | ídem | booleano | Actividad rítmica (≥ 10 dB y constante). **Provisional.** |
| `blinksPerMin` | `natural`, `free` | 1/min | Parpadeos por minuto. |
| `blinkMs` | ídem | ms | Duración media del parpadeo. |
| `blinkCompleteness` | ídem | 0–1 | Cierre medio de los parpadeos respecto al reposo. |
| `blinkVsMax` | `natural` | 0–1,5 | Cierre medio del parpadeo respecto al cierre máximo de ese ojo (el mayor del suave y el forzado). |
| `incompletePct` | `natural` | % | Parpadeos con menos del 80 % de ese cierre máximo. Orientativo: a ~27 fps se subestima el cierre de un parpadeo breve. |
| `closure` | `soft`, `forced`, `smile` | 0–1 | Cierre del ojo: en los cierres, `1 − EAR mínimo / EAR en reposo`; en la sonrisa, la mediana del EAR sin parpadeos. |
| `browRecruit`, `canthusRecruit` | `soft`, `forced` | × | Pico del movimiento de la ceja / del canto externo, en veces su p99 del reposo. |
| `eyeOpening` | `brows` | 0–1 | Cuánto se abre el ojo al subir las cejas. |
| `browLift` | `brows` | DI | Desplazamiento de la ceja hacia arriba (flujo integrado). |
| `browPeak` | `brows` | × | Pico de movimiento de la ceja, en veces su p99 del reposo. |
| `smile` | `smile` | 0–1 | Blendshape `mouthSmile` de ese lado. **Casi satura** con una sonrisa amplia: da la dirección, no la magnitud. |
| `coactivation` | `smile` | r | Correlación entre la sonrisa y el cierre del ojo del mismo lado. |
| `coactivationLagMs` | `smile` | ms | Desfase de esa correlación (−300 a +300). |
| `contractions` | todas menos `rest` | recuento | Contracciones finas que cuentan en la fase (estado `ok`). |
| `brief` | ídem | recuento | Movimientos breves del párpado (< 0,5 s) que no cuentan como contracción. |

### `quality`
Por fase: `reliable`, `faceFraction` (0–1), `headMoving` (fracción del tiempo con la cabeza en movimiento), `analysisFps` (análisis de la cara por segundo; `null` en un vídeo analizado) y `notes`. Una fase es **poco fiable** si el análisis fue a menos de 20/s, se perdió la cara o la cabeza se movió más del 20 % del tiempo.

### `events`
En orden de tiempo. `t` es el inicio y `duration` la duración, en ms.
| `kind` | Significado | Campo propio |
|---|---|---|
| `contraction` | Subida del cierre por flujo por encima del umbral del reposo. | `peak`: pico en veces el umbral. |
| `blink` | Parpadeo (≤ 0,8 s). | `completeness` |
| `closure` | Cierre de más de 0,8 s con el ojo muy cerrado. | `completeness` |
| `narrowing` | Más de 0,8 s con un cierre poco profundo (< 50 %). | `completeness` |

`status`: `ok` cuenta; `head` se descartó por mover la cabeza; `blink` era un parpadeo; `brief` dura menos de 0,5 s. Los parpadeos y cierres van siempre con `ok`. **Quien use las contracciones debe filtrar por `status: "ok"`.** Los eventos de ceja y canto son experimentales y no se exportan.

### `timeseries`
Un solo eje `t` (ms) con las señales de la cara de todas las fases, y los arrays `phase` y de cada señal con la **misma longitud que `t`**. Por lado:
| Señal | Significado |
|---|---|
| `ear` | EAR. |
| `aperture` | Apertura palpebral / distancia intercantal. |
| `blink` | Blendshape de parpadeo (0 abierto, 1 cerrado). |
| `smile` | Blendshape de sonrisa de ese lado (0–1). |
| `closure` | Cierre por flujo (DI, + = se cierra), de la muestra de flujo más cercana (≤ 40 ms) o `null`. |

Las series del **flujo** (cierre por flujo muestra a muestra, si estaba congelado y la velocidad de la cabeza) van en el CSV.

## CSV
Dos archivos por resultado, con coma como separador, punto decimal, cabecera, tiempos en ms y sin datos del paciente; los valores que faltan, vacíos.
- **`orbicula-cara-….csv`:** `t_ms, phase` y, por lado, `left_ear, left_aperture, left_blink, left_smile, left_closure, right_…`. Las mismas filas que `timeseries`.
- **`orbicula-flujo-….csv`:** `t_ms, phase, left_closure, right_closure, closure_frozen, head_u, head_v`. Cierre por flujo de cada ojo (DI), si estaba congelado (1 = algún ojo cerrado más de la mitad) y velocidad de la cabeza que se resta (DI/s). El primer `t_ms` puede ser algo negativo (−33): el par de flujo de ese fotograma llega antes que su análisis de la cara.

## Qué cambia respecto al JSON de diagnóstico
No están: las series del flujo por ROI, las compensaciones alternativas, los eventos experimentales de ceja y canto, el modelo de navegador y los datos del dispositivo. Están, ya ordenados: la asimetría de cada métrica, la calidad de cada fase y los tiempos en un solo reloj.
