# Plan de la fase 6: vídeo grabado

**Estado: fase hecha (6a–6d).** La conclusión y lo pendiente están en «Conclusión de la fase 6».

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

## Paso 6c (hecho; pendiente de la prueba en el móvil)
- **Casilla en el protocolo:** «Grabar el vídeo para analizarlo después, más sensible». Desmarcada por defecto, y solo aparece si el navegador graba MP4 (H.264).
- **Grabación:** `MediaRecorder` sobre el stream de la cámara, 4 Mb/s, en trozos de 1 s que se guardan en memoria. Tope de 300 MB (unos 10 min). **No hay URL, ni archivo, ni exportación del vídeo.** Se borra al terminar el análisis, al descartarlo, al detener el protocolo o al empezar otra sesión.
- **Lectura del MP4 fragmentado de MediaRecorder:** `openRecording` en `src/video/mp4.js`, con `mp4box`; saca todas las muestras con su tiempo, tipo y datos.
- **Las fases del vídeo salen de la sesión en directo:** `protocolWindows` toma el primer fotograma de cada paso (la marca de la cámara) menos el instante de arranque de la grabación. `windowedSteps` reproduce esos tiempos en el reloj del vídeo, con el reposo sin repetición. El primer paso arranca en su ventana y cada pausa lleva hasta la ventana del siguiente.
  - **Desvío:** cada cambio de paso se nota en el primer fotograma tras su hora; tras seis pasos son ~0,2 s, frente a gestos de 3 s y ventanas de ±1 s.
  - **Las marcas** de «ahora»/«suelta» salen exactas en el vídeo (1000 ms tras el inicio del gesto, y 2200 ms el «suelta»). En directo salían 1000–1290 ms, por el ritmo de 10 Hz de la interfaz y el retraso de la primera muestra.
- **Análisis:** el mismo de la 6b, solo desde 1 s antes del primer paso hasta 1 s después del último. Por defecto, un fotograma de cada dos (casilla). Al acabar, el resumen por fases, el JSON y el vídeo borrado.
- **JSON** del análisis: `plan: "protocol"`, `video.source: "recorded-during-protocol"`, con las ventanas, el procesado y el recuento del flujo.
- **Seguridad:** si el análisis no registra ningún par de flujo, da error en vez de entregar un resumen sin flujo. Una vez, en la nube, salió un análisis sin flujo y no se ha podido reproducir en dos repeticiones más.
- **En la nube** (cámara simulada, `escala=0.4`): el protocolo se graba (MP4 H.264, 720×720), se analiza el vídeo entero (2669 fotogramas en 5:41, 7,8 por segundo) y sale el resumen de las seis fases. Todos los pasos tienen un par de flujo por fotograma, la calibración es válida y no hay peticiones externas.

### Prueba del 6c en el móvil (2026-11-10 13:02, commit 0e5ea88, trasera)
- **Completo a la primera:** protocolo en directo y análisis del vídeo grabado, sin errores. **Vídeo:** 152 MB, H.264 720×1280, 9592 fotogramas en 271 s (**34 fps de media y variable**: de 5,8 a 143 ms entre fotogramas).
- **El análisis tardó 11,5 min** (8876 fotogramas, 12,9 fotogramas/s), con todos los fotogramas. El «un fotograma de cada dos» estaba marcado pero **no saltó ninguno**: la regla era «como mucho 30 fps» y con 34 no llega al umbral. Ahora la casilla es literal (uno de cada dos), va **desmarcada por defecto**, y la tarjeta estima el tiempo antes de empezar.
- **Las ventanas** de las seis fases y las seis marcas de cada gesto coinciden con el directo.
- **Flujo:** 6136 pares registrados, 1 por fotograma de cada fase; 127 recolocaciones de la franja y 11 fotogramas descartados por ocupación.
- **Directo frente a vídeo** (mismo protocolo, misma persona):

  | Medida | Directo | Vídeo |
  |---|---|---|
  | Umbral de los eventos, I / D | 0,045 / 0,062 | 0,049 / 0,064 |
  | Parpadeos por minuto, I / D | 12 / 18 | **17 / 24** |
  | Duración del parpadeo, I / D | 255 / 256 ms | **138 / 154 ms** |
  | Cierre del parpadeo / cierre máximo | 0,39 / 0,42 | 0,39 / 0,44 |
  | Cierre suave, I / D | 0,96 / 0,97 | 0,97 / 0,98 |
  | Cierre del ojo con la sonrisa, I / D | 0,11 / 0,17 (asimetría −0,22) | 0,17 / 0,27 (asimetría −0,22) |
  | Co-activación ojo–boca, I / D | 0,50 / 0,55 | **0,67 / 0,89** |
  | Cejas: subida de la ceja, I / D | 0,17 / 0,22 | 0,11 / 0,12 |

  - **Parpadeos:** el vídeo detecta un 40 % más y su duración es la de un parpadeo real (100–150 ms); en directo salen el doble de largos. Era lo esperado.
  - **Cierres y asimetrías:** iguales en las dos formas.
  - **Co-activación:** más alta y más limpia en el vídeo.
  - **Subida de la ceja:** más baja en el vídeo, con distinta asimetría. **Explicado el 2026-11-15:** no era la medida, era la deriva del reloj del vídeo (ver «Deriva del reloj del vídeo grabado» al final).

## Paso 6d (en curso; pendiente de la prueba en el móvil)
- **Criterio de aceptación 1, el aviso:** si el análisis de la cara en directo va por debajo de 24/s durante 5 s seguidos, sale un aviso con la velocidad actual que propone el vídeo grabado, o marcar «Grabar el vídeo» al hacer el protocolo. No sale mientras se procesa un vídeo (ahí no hay prisa) y se quita solo si la cámara se para. El aviso de los fps de la cámara ya no dice «llegará en una fase posterior».
- **Más rápido: dos fotogramas en vuelo a la vez** (`pipeline: 2`, por defecto). Mientras los workers analizan un fotograma, el hilo principal decodifica y prepara el siguiente. Cada cliente admite 2 en vuelo.
  - **En la nube** (CPU, sin GPU: el análisis tarda 118 ms por fotograma y es el cuello de botella): 1440 fotogramas en 2:57 frente a 3:44, **1,28 veces más rápido**, con los mismos resultados (840 muestras, 840 pares y 2 y 5 parpadeos).
  - **Medida de dónde se va el tiempo:** el JSON de un vídeo lleva ahora `video.processing` con los ms por fotograma que se esperan al decodificador, que se tarda en preparar y mandar, y que se espera a los workers, más los ms medios del análisis y del flujo. Con tu móvil sabremos si la mejora es mayor y qué queda por optimizar.
- **Calor:** el análisis de 11 minutos en el móvil no se notó caliente (el autor), así que se prioriza la velocidad.

### Prueba del 6d en el móvil: velocidad (2026-11-10 13:21, commit cc592ac, trasera)
- **Mismo vídeo que en el 6b** (68 s, 1080p, 2051 fotogramas): **2:20 frente a 4:04, a 14,6 fotogramas/s frente a 8,4. 1,74 veces más rápido**, con los **mismos resultados**: los guiños salen en el mismo lado y con los mismos cierres.
- **Desglose por fotograma (68,5 ms):** decodificar 1,1, preparar y mandar 2,0 y **esperar a los workers 65,2**. El **análisis de la cara tarda 55 ms** y el flujo 23: el cuello de botella es la cara. Va más lento que en directo (35–40 ms) porque el modo IMAGE vuelve a detectar la cara en cada fotograma, en vez de seguirla como el modo VIDEO.
- **Mejora posible no hecha:** un segundo análisis de la cara en paralelo. Los fotogramas son independientes en modo IMAGE, así que podría llegar a ~25 fotogramas/s. Hace falta reordenar los resultados (el procesador de flujo descarta los que llegan en desorden) y duplica el modelo en memoria. Se deja para más adelante si el tiempo molesta.

## Conclusión de la fase 6

**Qué hay:** el modo de vídeo grabado de `CLAUDE.md`.
- **Tarjeta «Vídeo grabado»:** carga un MP4 de la app de cámara y lo analiza fotograma a fotograma. Los primeros segundos son el reposo de calibración; del resto salen los parpadeos, las contracciones finas y la actividad rítmica.
- **Protocolo grabado:** casilla para grabar el vídeo del protocolo (solo en la memoria) y analizarlo después, con las fases exactas.
- **Aviso del criterio 1:** si el directo no llega a 24 análisis/s, la app lo dice y propone el vídeo.
- **Seguridad:** el vídeo se lee en el móvil, sin red, y no se guarda ni se exporta.

**Qué se ha comprobado** (un solo sujeto, el móvil del autor, Chrome 156–157):
- **Lectura:** H.264 y HEVC, con el giro y los tiempos de cada fotograma; con índice al principio o al final; fps variable. A 130 fotogramas/s decodificando.
- **Lateralidad (criterio 2): cumplido en vídeo grabado, con la trasera y con la frontal.** Cada guiño sale en su lado, también con la cámara frontal (HEVC, girada 270°).
- **El vídeo es más sensible que el directo:** con el mismo protocolo detecta un 40 % más de parpadeos y los mide con la duración de un parpadeo real (140–150 ms frente a 255 ms). Los cierres y las asimetrías salen iguales en los dos.
- **Velocidad:** 14,6 fotogramas/s, o sea, un protocolo de 4 min (~9600 fotogramas a 34 fps) tarda unos 11 min, o 5–6 con un fotograma de cada dos. El móvil no se calentó.

**Limitaciones:**
- Hace falta un navegador con WebCodecs y que pueda decodificar el códec del vídeo (HEVC solo si Chrome lo decodifica; si no, grabar en H.264).
- Un vídeo de 4 minutos tarda ~10 min en analizarse, con la pantalla encendida.
- Las fases del protocolo grabado dependen de los tiempos de la sesión en directo; el desvío tras seis pasos es de ~0,2 s.
- Una vez se obtuvo un análisis sin flujo en la nube y no se pudo reproducir (ahora da un error claro).
- La subida de la ceja sale más baja en el vídeo que en directo; sin explicar.

**Pendiente (no bloquea):**
- **Análisis de la cara en paralelo: hecho en la rama `feat/caras-en-paralelo`, pendiente de medir en el móvil** (ver «Análisis de la cara en paralelo» al final).
- *(Original)* **Análisis de la cara en paralelo** (ver 6d). **Decidido (2026-11-10): proponérselo al autor después de la fase 7.** Un segundo worker con el análisis de la cara, que en modo IMAGE son fotogramas independientes. Hay que reordenar los resultados por tiempo antes de pasarlos al procesador de flujo, que descarta los que llegan en desorden, y se duplica el modelo en memoria. Objetivo: de 14,6 a ~25 fotogramas/s. Opus, esfuerzo medio.
- Entender la diferencia en la subida de la ceja entre el directo y el vídeo.
- Probar HEVC con el protocolo grabado: `MediaRecorder` solo graba H.264 aquí.
- Medir la sonrisa con las comisuras de la boca (decidido para después de la fase 7).

**Siguiente:** fase 7 (exportación e integración). Sonnet, salvo la revisión del esquema con Opus antes de fijar `schemaVersion: "1"`.

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

## Análisis de la cara en paralelo (tras la fase 7)
**Qué se hizo.** Un «pool» de análisis de la cara (`src/landmarks/pool.js`) solo para el vídeo grabado (en modo IMAGE los fotogramas son independientes; en directo, el modo VIDEO suaviza entre fotogramas y exige un solo análisis). Los resultados llegan desordenados y se entregan en orden de envío (`src/landmarks/in-order.js`). Variantes elegibles en la tarjeta del vídeo: 1 CPU (por defecto desde la medida en el móvil), CPU + CPU, 1 GPU (como antes) y GPU + GPU. El segundo análisis vive solo mientras dura el vídeo.

**Hallazgo 1: no se pueden mezclar GPU y CPU.** Para el mismo fotograma no dan los mismos números: en la nube, el EAR difería 0,004 de mediana y hasta 0,014 en el 10 % peor, de 2 a 5 veces el ruido del EAR en reposo (0,0015–0,0026). Alternarlos metería ese ruido en la señal fina. GPU + CPU iba 2,5 veces más rápido en la nube y aun así **se descartó**. Ahora, si el segundo análisis no consigue el mismo acelerador que el primero, se usa uno solo y el resultado lo dice.

**Hallazgo 2: el reloj de la sesión avanzaba al enviar, no al recibir.** Con varios fotogramas en vuelo, las últimas muestras de un tramo llegaban cuando la sesión ya estaba en el siguiente (2 muestras del reposo en el tramo libre). Ahora el reloj avanza con los resultados de la cara, en orden. Al arreglarlo apareció un fallo antiguo: al cruzar una frontera la sesión necesita tres pasos y `advance` daba dos, así que la muestra de la frontera se perdía (antes no se notaba porque el reloj iba un fotograma adelantado). Ahora avanza hasta que la sesión queda estable: **la variante de siempre pasa de 1439 a 1440 muestras de 1440**, con los mismos valores.

**Medido en la nube** (4 núcleos y sin GPU real: la «GPU» es una emulación por software, así que solo vale para comparar entre sí las variantes de CPU y para comprobar resultados):
| Variante | Fotogramas/s | Resultados |
|---|---|---|
| 1 GPU (como hasta ahora) | 5,6 | — |
| GPU + GPU | 5,7 | **Idénticos** a 1 GPU (600 + 840 muestras, EAR igual en todas, mismos parpadeos y umbrales) |
| 1 CPU | 29,0 | — |
| CPU + CPU | 51,3 (1,8×) | **Idénticos** a 1 CPU |

En la nube GPU + GPU no gana porque la GPU emulada ya ocupa los 4 núcleos (cada análisis pasa de 174 a 330 ms). **En el móvil del autor la GPU es real y hay 8 núcleos más: la medida que decide es la del móvil.**

**Lo que queda igual o casi:** con dos análisis se pierden unos pares de flujo más **al principio del vídeo** (los de 0,1–0,2 s: el flujo va por delante mientras arrancan los análisis y sus primeros pares no tienen pose con la que normalizarse; con uno solo ya se perdían los tres primeros). No afecta a ninguna métrica: la subida del cierre necesita 2,1 s de historia.

**Medido en el móvil del autor (2026-11-14).** Android 10, Chrome 157, 9 núcleos. El mismo vídeo de 68,4 s (cámara trasera, 1080p a 30 fps, 2051 fotogramas), con 2 minutos de reposo entre pruebas:

| Variante | Fotogramas/s | Tiempo | Análisis de la cara (ms por fotograma) | Resultados |
|---|---|---|---|---|
| 1 GPU, producción (`main@a17bed8`) | 13,5 | 2:31 | 63 | 898 + 1152 muestras (la de la frontera se perdía) |
| 1 GPU, rama | 12,6 | 2:43 | 76 | 899 + 1152; 7 + 22 parpadeos |
| GPU + GPU | 21,9 | 1:34 | 84 y 87 (1046 y 1005 fotogramas) | **Idénticos** a 1 GPU |
| **1 CPU** | **27,4** | **1:15** | **33** | EAR hasta 0,03–0,04 distinto de la GPU; mismos parpadeos claros |
| CPU + CPU | 29,6 | 1:09 | 51 y 58 (1209 y 842 fotogramas) | **Idénticos** a 1 CPU |

Una primera prueba de 1 GPU en la rama dio 8,1 fotogramas/s; repetida, 12,6, como producción. Fue una medida suelta, no un fallo de la rama.

**Decisión: 1 CPU por defecto.** En este móvil la CPU analiza la cara en la mitad de tiempo que la GPU: a esta resolución, subir y bajar el fotograma de la GPU pesa más de lo que gana. CPU + CPU solo gana un 8 % porque los dos análisis compiten por los mismos núcleos rápidos (cada uno pasa de 33 a 51–58 ms), y no compensa otro modelo en memoria ni más calor. Las demás variantes quedan en el selector.

**Consecuencias:**
- Un vídeo analizado ahora puede dar valores muy ligeramente distintos de uno analizado antes con la GPU: el EAR, unas centésimas (el ruido del EAR en reposo es igual con las dos, desviación típica 0,015–0,018), y algún cierre del 25–28 % que está justo en el umbral. Cada sesión se compara consigo misma, así que no rompe nada; para comparar dos vídeos, analízalos con la misma opción. El informe guarda la opción usada (`video.processing.face`).
- El umbral de flujo del reposo salió la mitad con CPU (0,006 frente a 0,013), pero no por la CPU: el percentil 95 del reposo es el mismo con las dos (0,003). El umbral es el **máximo** del reposo limpio, y con GPU entró en él una sacudida suelta del párpado (el propio análisis lo avisaba). **Pendiente aparte:** hacer el umbral más robusto frente a un solo pico.
- **Medido después (2026-11-14): en directo, no.** Con el protocolo completo en la cámara trasera a 720p, la GPU dio 24,1–28,8 análisis/s por fase (34–40 ms) y la CPU 22,4–23,9 (41–43 ms), con más ruido del EAR. En directo la CPU la comparten la cámara y el flujo, y el modo VIDEO le sienta mejor a la GPU. El directo sigue con la GPU (hay un selector para medirlo en otros móviles).

## Deriva del reloj del vídeo grabado (2026-11-15)
**Síntoma:** en el protocolo grabado del 2026-11-10, la subida de la ceja salía más baja en el vídeo (0,11 / 0,12 DI) que en directo (0,17 / 0,22).

**Lo que no era:** ni la medida ni la tasa de fotogramas. La velocidad de la ceja se normaliza por el intervalo de cada par, el vídeo no tenía huecos y la velocidad máxima de subida era la misma. **La primera repetición daba lo mismo** en los dos (0,21 / 0,22); en el vídeo, la 2 y la 3 se quedaban en 0,04–0,08.

**Lo que era:** en el vídeo la ceja **empezaba a subir antes del pitido «ahora»**, y la ventana de la medida empieza en el pitido. Correlando el EAR del directo con el del vídeo (`alignmentLag`), lo que pasa en el directo aparece en el vídeo cada vez antes de donde lo coloca la ventana:

| Fase | Reposo | Parpadeo | Cierre suave | Cierre forzado | Cejas | Sonrisa |
|---|---|---|---|---|---|---|
| Desfase (r) | +0,11 s (0,86) | −0,22 s (0,79) | −0,43 s (1,00) | −0,59 s (0,99) | **−0,84 s** (0,97) | −1,01 s (0,87) |

- El reloj de la sesión es bueno: los inicios de las fases según la cámara coinciden con la hora del sistema (±0,05 s en 4 min).
- **El MP4 de MediaRecorder se va quedando atrás:** ~1,1 s en ~4 min (~0,5 %), a tirones (0,33 s en el parpadeo, 0,2 s en el cierre suave), más propio de parones del grabador que de un reloj lento.
- Las marcas se colocaban como «instante de la sesión − arranque de la grabación», suponiendo los dos relojes iguales.
- Afecta a todo lo que depende de la ventana de las repeticiones en el vídeo: la subida de la ceja (empieza antes de la ventana), y en menor medida la sonrisa y su co-activación. Los parpadeos no (se miden en todo el paso).

**Corrección (`mediaClock`, `src/video/offline.js`):**
1. Al grabar, con cada trozo de 1 s de MediaRecorder se anota cuándo llegó y cuántos bytes iban (`FrameRecorder.timeline`).
2. Al abrir el vídeo, el último fotograma entero de esos bytes dice hasta qué tiempo del vídeo se había grabado en ese instante. La diferencia (sesión − vídeo), con una mediana de 5 trozos, es la deriva.
3. Se corrige solo lo que crece desde el principio: el desfase inicial (+0,1 s) se deja como estaba. Si los trozos no cuadran (menos de 3, o más de un 5 % de deriva), no se toca nada.
4. **Comprobación en cada análisis:** el JSON del vídeo guarda `video.alignment` con el método, la deriva corregida y, por fase, el desfase que queda entre el EAR del directo y el del vídeo (lo ideal, ~0; vacío si la correlación es menor de 0,5, p. ej. en una fase sin parpadeos). En la nube (cara sintética) sale `chunks` con 26 trozos.

**Prueba en el móvil (2026-11-15, P03, `d3fc590`):** deriva detectada y corregida de **1,17 s** (73 trozos). El desfase que queda ya no crece: **+0,55, +0,53, +0,54, +0,51, +0,43 y +0,39 s** por fase (r 0,81–0,99), frente a +0,11 → −1,01 s sin corregir. **La subida de la ceja ya coincide:** directo 0,223 / 0,221 DI, vídeo 0,230 / 0,225 (antes 0,11 / 0,12). La comisura, también (0,49 / 0,48 frente a 0,52 / 0,49).

**El desfase fijo de ~0,5 s:** la corrección tomaba como referencia el primer trozo. Al arrancar, el codificador llena su cola y los primeros trozos llegan antes, así que ese llenado contaba como deriva. Ahora la referencia es el inicio del primer paso (`anchorMs`): ahí el reloj queda como sin corregir (+0,1 s el día 10) y se corrige la deriva a partir de ese punto. El JSON guarda además la curva de la corrección (`video.alignment.curve`, cada ~5 s) para comprobarlo en la próxima prueba.

**Prueba con la referencia nueva (2026-11-15, P04, `06e61d0`):** deriva corregida de 1,28 s (72 trozos), casi lineal (~0,54 %). El desfase que queda: **+0,21, +0,17, +0,10, +0,08, −0,02 y −0,04 s** por fase (r 0,86–0,99), frente a ~0,5 s fijo en P03 y hasta −1,01 s sin corregir. Subida de la ceja: directo 0,153 / 0,177 DI, vídeo 0,163 / 0,194.
- Queda una pendiente pequeña (~0,25 s en 4 min, algo de más corregido): se deja así. Para afinarla harían falta más grabaciones, y ±0,2 s no cambia las ventanas de las repeticiones (empiezan en el pitido y duran 4 s).
- La comisura sale algo más alta en el vídeo (0,63 / 0,56 frente a 0,51 / 0,51): en directo el modo VIDEO suaviza los puntos y recorta los picos. Como con los parpadeos, compara directo con directo y vídeo con vídeo.

## «El ojo se abre» al subir las cejas: directo frente a vídeo (2026-11-15)
En P03 salía 0,08 / 0,11 en directo y 0,00 / 0,01 en el vídeo. **No es un fallo sistemático:**
- En **P04** (con el reloj del vídeo ya bien alineado) sale ~0 en los dos: −0,004 / 0,015 en directo y 0,006 / −0,002 en el vídeo.
- En P03, el EAR de las cejas en directo llegaba más alto (p90 0,386 frente a 0,357 en el vídeo de la misma actuación). Lo más probable es que el seguimiento del modo VIDEO arrastre un poco los puntos del párpado con la ceja; en P04 no pasó.
- Es una medida pequeña (el ojo apenas se abre al subir las cejas) comparada con su ruido: **se marca como orientativa** en el resumen y en `schema.md`, sin cambiar el cálculo. Para la elevación de cejas, la medida fiable es la subida de la ceja por flujo (`browLift`), que sí coincide entre directo y vídeo.
