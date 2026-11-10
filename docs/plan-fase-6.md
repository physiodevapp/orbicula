# Plan de la fase 6: vídeo grabado

**Aprobado por el autor el 2026-11-08, con las recomendaciones:**
- **fases:** primero A (análisis libre) y después C (orbicula graba su propio vídeo durante el protocolo);
- en C, el vídeo **solo en memoria**, con una casilla, y borrado al procesarlo;
- reposo del análisis libre: **30 s**;
- la configuración de la app de cámara se lee del propio archivo en el 6a. Se lee junto con `CLAUDE.md`, la conclusión de `docs/plan-fase-5.md` y `docs/desarrollo.md`. La rama sale de `feat/fase-5-protocolo` (PR #5); cuando se fusione, se rebasa sobre `main`.

## Qué tiene que hacer
De `CLAUDE.md`:
- **Entrada:** un archivo grabado con la **app de cámara nativa**.
- **Procesado:** **frame a frame, en modo IMAGE**, sin el suavizado del seguimiento. Es el modo de **máxima sensibilidad**.
- **Criterio de aceptación 1:** si en directo no se llega a 24 análisis/s, la app lo dice y **propone este modo**.

**Por qué es más sensible que el directo:**

| | En directo | Vídeo grabado |
|---|---|---|
| Frames analizados | ~25 por segundo, con el resto perdidos | **todos** (30 o 60 por segundo) |
| Modo del modelo | VIDEO: suaviza entre frames | **IMAGE**: cada frame por separado |
| Presión de tiempo | sí: con calor, el flujo se rebaja a 20 pares/s | **ninguna** |
| Resolución | 720p (prioridad «fps») | la del archivo, hasta 4K |

Además, el parpadeo: a 60 fps, el mínimo de un parpadeo de 0,18 s ya no se pierde entre frames. Esto debería arreglar la subestimación de la completitud de la fase 5.

## Cómo se lee el archivo (decisión técnica)
- **Lectura del MP4:** se usa **WebCodecs** (`VideoDecoder`, disponible en Chrome para Android) más un lector de MP4 que separa los fotogramas comprimidos: `mp4box`, versión fija 2.4.1, de junio de 2026. Va en el propio bundle, sin red.
  - **Tiempos exactos:** los de cada muestra del archivo, aunque el fps sea variable (los móviles lo hacen).
  - **Decodificación en orden:** cada fotograma una vez. Saltar con `video.currentTime` obligaría a decodificar desde el último fotograma clave en cada paso, unas 30–60 veces más lento.
  - **Control del ritmo:** no se pide el siguiente fotograma hasta procesar el anterior.
- **Orientación:** los móviles guardan el vídeo en horizontal con una marca de giro (matriz del `tkhd`). Se lee y se gira cada fotograma antes de analizarlo.
- **Espejo:** el archivo no dice si la imagen va en espejo (depende del móvil y de la cámara). El usuario elige «grabado con la frontal / trasera» y «en espejo: sí / no» (por defecto, no). Se comprueba con un guiño, que es el criterio 2.
- **Códec:** H.264 o HEVC según el móvil. Antes de empezar se pregunta al navegador si lo puede decodificar (`VideoDecoder.isConfigSupported`); si no puede, la app lo dice y explica cómo cambiarlo en la app de cámara («Más compatible» / H.264).
- **El resto, igual que en directo:**
  - el análisis de la cara (worker, con un segundo modelo en modo IMAGE);
  - el flujo (worker, todos los pares de fotogramas, sin rebaja);
  - `FlowProcessor`, `BlinkDetector`, `calibrate`, `EventDetector` y `summarizeProtocol`.

  Los dos workers ya aceptan un `VideoFrame` en lugar del `<video>`: el cambio es pequeño.
- **Privacidad:**
  - El archivo se lee en el móvil y no sale de él.
  - No se guarda copia del vídeo.
  - La CSP y la barrera de privacidad no cambian.

**Tiempo de procesado:** el análisis tarda unos 35 ms por fotograma y el flujo unos 20 ms, en paralelo, así que se procesarían ~25 fotogramas por segundo. Un vídeo de 4 min a 60 fps son 14 400 fotogramas: **unos 10 minutos**, con barra de progreso, tiempo restante, pantalla encendida y botón de cancelar.
- Opción: «procesar a 30 fps», un fotograma de cada dos, para tardar la mitad.
- El paso 6a mide el tiempo real.

## Decisión clave para el autor: cómo se relaciona el vídeo con el protocolo
El vídeo de la app de cámara no sabe en qué fase está cada momento. Hay tres opciones, y no son excluyentes.

**A. Análisis libre del vídeo** (se necesita en cualquier caso).
- Los primeros N segundos son el reposo de calibración (por defecto 30 s; configurable).
- El resto se analiza entero: parpadeos, contracciones, cierres, actividad rítmica, curvas.
- Sirve para cualquier vídeo, por ejemplo uno de una consulta. No da el resumen por fases del protocolo.

**B. Protocolo sincronizado por sonido.**
- Mientras la app de cámara graba, el protocolo de orbicula suena: la voz y los pitidos. La grabación recoge ese sonido.
- Al cargar el vídeo, orbicula **reconoce sus propios pitidos** en el audio (frecuencias conocidas: 880 Hz «empieza», 1175 Hz «ahora», 392 Hz «suelta»…) y sitúa cada fase y cada repetición. Así da el mismo resumen por fases que en directo.
- **Problema:** el protocolo tiene que sonar desde **otro dispositivo** (otro móvil, una tableta, el ordenador de la consulta), o desde el mismo móvil en pantalla dividida, que es frágil: Android puede pausar la pestaña. Contigo solo y un móvil, no es práctico.

**C. orbicula graba su propio vídeo durante el protocolo** y luego lo procesa fotograma a fotograma.
- Durante el protocolo en directo, la app guarda el vídeo de la cámara en la memoria (`MediaRecorder`). Al acabar, lo procesa entero en modo IMAGE, con las fases y las repeticiones exactas, y **lo borra**.
- **Ventajas:** un solo móvil y sin sincronizar nada. Además, cada fotograma (60 por segundo) en vez de los ~25 que da tiempo a analizar.
- **Inconvenientes:**
  - El vídeo no es el de la app de cámara nativa: es el de `getUserMedia` (720p a 60 fps con la trasera), algo menos de calidad que la nativa a 4K.
  - `CLAUDE.md` dice que el vídeo no se guarda «por defecto». Aquí sería una casilla que hay que marcar, el vídeo solo existiría en la memoria mientras se procesa, nunca se exporta y se borra al terminar.

**Recomendación:** empezar por **A**, porque es la base de las otras dos y cumple `CLAUDE.md` tal cual. Después, **C**, que es la que puedes usar tú solo con un móvil y da el resumen por fases a máxima sensibilidad. **B** queda para cuando haya un segundo dispositivo en la consulta.

## Pasos (me detengo al final de cada uno para que lo pruebes en el móvil)
1. **6a. Leer el archivo, sin analizar.**
   - Tarjeta «Vídeo grabado»: elegir un archivo y ver su ficha (códec, resolución, giro, duración, fps reales según los tiempos de las muestras, si el fps es variable).
   - Prueba de decodificación: cuántos fotogramas por segundo decodifica el móvil, con el giro aplicado.
   - **Tu prueba:** grabar 10–20 s con la app de cámara (trasera, la configuración que usarías: 1080p a 60 fps si la tienes) y cargarlo. Si puedes, otro a 4K y otro con la frontal. Me pasas el JSON con la ficha y los tiempos.
2. **6b. Procesado fotograma a fotograma (opción A).**
   - Análisis en modo IMAGE y flujo en todos los pares.
   - Calibración con los primeros N segundos, eventos, resumen de un solo tramo, curvas del vídeo entero y JSON.
   - **Tu prueba:**
     - un vídeo con reposo y guiños de un solo ojo, con la trasera y con la frontal, para el criterio 2 con vídeo grabado;
     - el mismo gesto en directo y en vídeo, para comparar la sensibilidad.
3. **6c. Las fases del protocolo en el vídeo** (C, o B si lo prefieres). Protocolo completo con el resumen por fases a máxima sensibilidad.
4. **6d. Cierre.**
   - En directo, cuando el análisis se queda por debajo de 24/s, el aviso propone el vídeo grabado (criterio 1).
   - README, CHANGELOG y la conclusión.

## Paso 6a (hecho; pendiente de la prueba en el móvil)
- `src/video/mp4.js`: lee el índice del MP4 sin cargar el archivo. Busca las cajas de primer nivel y pasa a `mp4box` solo `ftyp` y `moov`; cada muestra se lee del archivo por su posición. Da:
  - el giro de la matriz de la pista;
  - el tamaño ya girado;
  - los tiempos de presentación de cada muestra (ms desde la primera);
  - el ritmo real y si es variable;
  - la configuración del decodificador.
- `src/video/decode.js`: un generador de fotogramas con WebCodecs, en orden de presentación, sin adelantar más de 3 fotogramas listos, y el giro con un lienzo (`rotateFrame`).
  - **Primer error, ya corregido:** con fotogramas B (H.264) el decodificador retiene varias muestras antes de dar el primer fotograma, y limitar la entrada por su cola lo bloqueaba. Ahora se limita por los fotogramas listos sin recoger, con un test que simula ese decodificador.
- Tarjeta «Vídeo grabado» (`src/ui/video.js`), visible sin activar la cámara:
  - archivo, ficha y cámara con que se grabó, con la casilla del espejo (para el 6b);
  - «Probar la lectura (15 s)» con miniatura del primer fotograma ya girado;
  - JSON `orbicula-video-probe/1`, sin el nombre del archivo ni imágenes.
- **En la nube (Chromium de Playwright):**

  | Vídeo | Fotogramas | Ritmo de lectura (descodificar y girar) |
  |---|---|---|
  | H.264 con fotogramas B, 60 fps y girado | 240/240 | 384 por segundo |
  | fps variable | 50/50 | — |
  | VP9 | 120/120 | — |

  El giro coincide con el que aplica `ffmpeg`: los cuadrantes de la miniatura son 110, 97, 141 y 143, y los de la referencia, 113, 99, 138 y 141.

### Primera prueba en el móvil (2026-11-08 22:04, commit 3d11b52)
- **Ficha:** trasera, H.264 (`avc1.640028`), 1920×1080 girado 90° (1080×1920 al verlo), 30 fps constantes, 36,6 s, 8,7 Mb/s, con audio y el índice al principio. **Sin espejo**, comprobado por el autor con el brazo.
- **Lectura:** 449/449 fotogramas en orden, pero **solo a 7,1 fotogramas/s** (0,24 × tiempo real): ~140 ms por fotograma, de los que girar es 3,8 ms.
- **Sospecha:** la lectura del archivo muestra a muestra. En Android, cada lectura de un archivo del selector pasa por el sistema. Ahora se lee en **bloques de 8 MB**, y la prueba da el desglose: leer, girar y decodificar.
- **En la nube, con un vídeo parecido** (1080p, 30 fps, girado, 8 Mb/s): 2 lecturas del archivo en 15 s y 59 fotogramas/s. Ahí el giro manda (16 ms, sin GPU).

### Segunda prueba en el móvil (commit e70a567)
- **Miniatura:** la cara sale **derecha**. El giro es correcto con un vídeo real.
- **Se quedaba colgado casi al final.** El decodificador de hardware (MediaCodec) solo puede tener unos pocos fotogramas sin devolver, y al final se esperaba a `flush()` sin recogerlos, así que los dos se quedaban esperándose. En la nube no pasaba: el decodificador es de software. Reproducido con un test (cupo de 2 fotogramas) y corregido: se pide el vaciado y se siguen entregando fotogramas.

### Tercera y cuarta prueba en el móvil (2026-11-09, commits 8e123fb y anterior)
- **Commit b0f6b15:** `NotReadableError` al leer los fotogramas, aunque el índice sí se había leído. Lo más probable es un archivo que se quedó elegido de antes de recargar la página, ya sin permiso. Ahora el selector se vacía al cargar, y si un bloque no se puede leer se sigue muestra a muestra y se anota.
- **Commit 8e123fb: funciona.** 449/449 fotogramas en orden, a **132 fotogramas/s (4,4 × tiempo real)**.

  | Por fotograma | Tiempo |
  |---|---|
  | Leer | 0,8 ms (3 lecturas en 15 s, sin respaldo) |
  | Girar | 0,7 ms |
  | Decodificar | 6,1 ms |

  La lentitud de la primera prueba (7 fotogramas/s) era leer muestra a muestra.
- **Conclusión del 6a:** leer, decodificar y girar no son el cuello de botella. Lo será el análisis de la cara (~35 ms por fotograma) junto con el flujo, así que el procesado completo irá a unos 25 fotogramas/s. Un vídeo de 4 min a 30 fps son 7200 fotogramas: **unos 5 minutos**.

## Paso 6b (hecho; pendiente de la prueba en el móvil)
- **`src/video/offline.js`:** cada fotograma, decodificado y girado, va al análisis de la cara y al flujo. No se pide el siguiente hasta tener los dos resultados, así que se procesan **todos**.
  - **Registro:** con el mismo motor que el protocolo (`GuidedSession`), con el **tiempo del vídeo** como reloj, en dos tramos: el reposo de calibración (por defecto, los primeros 30 s) y el resto del vídeo.
  - La calibración, los eventos, el resumen y el JSON son los de siempre: `plan: "video"`, con `video` (ficha y procesado) y `settings`.
- **Análisis en modo IMAGE:** se cambia el modelo del worker con `setOptions({ runningMode })` y se vuelve a VIDEO al acabar.
- **Flujo sin límite de ritmo:** `FlowClient.setUnlimited`, y el ajuste por calor no actúa mientras se procesa un vídeo.
- **Espejo:** la casilla de la tarjeta pasa a `frameMirrored`, la misma corrección que en directo.
- **La cámara se apaga** al empezar a analizar un vídeo; si no, sus frames se mezclarían con los del archivo.
- **Los dos workers** aceptan un `VideoFrame` además del `<video>` (`src/capture/source.js`).
- **Tarjeta:** reposo inicial (20, 30 o 45 s), «como mucho 30 fotogramas/s» (marcado si el vídeo va a más de 40), progreso con el tiempo restante, cancelar, el resumen (con la fase «Resto del vídeo») y el JSON.
- **En la nube** (vídeo sintético de parpadeos de 48 s, 720×720 a 30 fps, guardado tumbado con la marca de giro del móvil):
  - se procesan los 1440 fotogramas, con flujo en todos los pares (33 ms), sin errores ni peticiones externas;
  - **lateralidad:** en el resto del vídeo, ojo derecho 11 parpadeos/min e izquierdo 4, lo esperado (3 y 1 por cada vuelta de 16 s). Con «en espejo», 4 y 11: se intercambian.
  - Unos 6 fotogramas/s en la nube, sin GPU.

### Prueba del 6b en el móvil: frontal (2026-11-10, commit a345f0e)
- **Vídeo:** frontal, HEVC 1080p a 30 fps, girado 270°, 66 s y 157 MB, con el índice al final. **Sin espejo**, comprobado por el autor.
- **Procesado:** los 1975 fotogramas en 2:35, a **12,7 fotogramas/s** (0,42 × tiempo real); flujo en todos los pares. El plan estimaba ~25/s: con HEVC 1080p girado, más el análisis en modo IMAGE y el flujo, sale la mitad.
- **Reposo válido:** 25 s útiles de 30. Con el aviso de umbral alto (una sacudida suelta).
- **Lateralidad (criterio 2 con la frontal, en vídeo): correcta.**
  - **Guiños del ojo izquierdo** (3,5 s, 8,9 s y 14,7 s del resto): **cierres largos en I** (93 %, 92 % y 57 %, 2,4–3,3 s). En D, solo parpadeos cortos o entornados (32–42 %): el otro ojo acompaña, como en la fase 3.
  - **Guiños del ojo derecho** (20,7 s, 25,7 s y 30,4 s): **cierres largos en D** (85 %, 69 % y 78 %, 1,8–2,6 s). En I, entornados del 33–35 %, y un cierre del 57 % a los 23,1 s, justo después del primero.
- **Contracciones:** las cuatro que pasaron el umbral coinciden con los guiños y quedan como «era un parpadeo». No hay ninguna que cuente.

### Prueba del 6b en el móvil: trasera (2026-11-10, commit b3ddebe)
- **Vídeo:** trasera, H.264 1080p a 30 fps, girado 90°, 68 s. Sin espejo.
- **Procesado:** los 2051 fotogramas en 4:04, a **8,4 fotogramas/s** (0,30 × tiempo real). Más lento que el de la frontal (12,7/s). Quizá el calor, porque fue después del de la frontal: **pendiente de mirar en el 6d**. A ese ritmo, un protocolo de 4 min tardaría ~14 min.
- **Reposo válido:** 25 s útiles. Aviso de umbral alto.
- **Lateralidad: correcta.**
  - **Guiños izquierdos** (3,5 s, 9,2 s y 15,0 s): **cierres en I** del 70 %, 77 % y 87 %, de 2,0–2,3 s. En D, parpadeos cortos y entornados del 30–41 %.
  - **Guiños derechos** (21,5 s, 26,7 s y 33,2 s): **cierres en D** del 92 %, 88 % y 96 %, de 1,6–2,5 s. En I, parpadeos cortos y entornados del 28–33 %.
  - Un cierre suelto en D (54 %, 17,1 s) entre las dos tandas.
- **Criterio de aceptación 2, cumplido también en el vídeo grabado, con las dos cámaras.** El directo con la trasera ya estaba probado en fases anteriores.

## Pruebas
- **Vídeos de prueba fabricados con `ffmpeg`** a partir de los vídeos sintéticos de `make-face-videos.py`:
  - MP4 H.264 y VP9;
  - 30 y 60 fps;
  - con marca de giro de 90° y 270°;
  - en espejo;
  - con fps variable.

  La respuesta es conocida: el párpado de 1,5 px, el cabeceo, el guiño de un lado.
- **Tests unitarios:**
  - lectura del giro de la matriz del `tkhd`;
  - tiempos de las muestras (escala de tiempo, fps variable);
  - el paso de lado con espejo en el vídeo;
  - el planificador fotograma a fotograma (con decodificador simulado);
  - si se hace B, la detección de pitidos en un audio sintético.
- **De punta a punta en la nube** con Playwright, sin cámara: cargar el MP4 y comprobar el resultado.
- **Riesgo:** el Chromium de Playwright quizá no decodifique H.264 (códec propietario). Si es así, las pruebas en la nube usarán VP9, y el H.264 se comprueba en el móvil.

## Riesgos
- **HEVC:** si el móvil graba en HEVC y Chrome no lo decodifica, la app lo dirá, y habrá que grabar en H.264 («Más compatible» en la app de cámara).
- **Memoria con 4K:** cada fotograma decodificado ocupa ~12 MB. Hay que cerrar cada `VideoFrame` en cuanto se use y no adelantar más de 2–3 en la cola.
- **Duración del procesado:** unos 10 minutos para 4 min a 60 fps. Puede calentar el móvil, aunque sin presión de tiempo eso solo alarga el procesado.
- **Modo IMAGE:** sin el suavizado entre frames, los landmarks tiemblan más. Esto puede subir el ruido del EAR y de la compensación por postura. Se medirá en el 6b comparando el reposo grabado con el directo.
- **Espejo:** se elige a mano. Un error invierte los lados, así que el guiño de prueba lo tiene que comprobar.

## Modelo recomendado
- **Plan:** Opus, esfuerzo alto (este documento).
- **6a y 6b** (decodificación, giro, tiempos, modo IMAGE, lateralidad): Opus, esfuerzo medio.
- **6c:** Opus para la parte de sincronización si se hace B; Sonnet si es C.
- **6d:** Sonnet.

## Decisiones del autor (tomadas)
1. **Fases:** A y después C. B queda para cuando haya un segundo dispositivo.
2. **En C:** el vídeo, temporal y en memoria, con casilla.
3. **Reposo:** 30 s.
4. **App de cámara:** se lee del archivo (6a).
