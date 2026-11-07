# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar]

### Añadido (fase 3: EAR y parpadeos)
- El análisis de la cara corre en un Web Worker (`src/landmarks/analysis.worker.js`): el hilo principal queda libre para las curvas. Los frames se mandan como `ImageBitmap` reducido (lado corto ≤ 720 px, que no empeora los landmarks), con dos frames en vuelo para que el worker no espere, y las ROI se calculan sobre el frame completo. Si el worker no arranca se usa el hilo principal; `?analysis=main` lo fuerza para comparar tiempos.
- EAR de 6 puntos por lado (posiciones 3 y 5 de las cadenas de los párpados) y apertura palpebral central normalizada a la distancia intercantal; sustituyen a la «apertura rápida» de la fase 2.
- Detector de parpadeos por lado (`src/metrics/blinks.js`): reposo = percentil 90 de los últimos 5 s (o línea base fija, para la calibración de la fase 5), histéresis, duración a media altura con interpolación, completitud = cierre respecto al reposo, frecuencia por minuto y distinción entre parpadeo y cierre largo (> 800 ms). Umbrales provisionales.
- Dos curvas en tiempo real (I y D, ventana de 10 s, escala fija) de EAR, apertura o blendshape, con el reposo y los parpadeos marcados; contadores por lado, índice de asimetría (I − D) / (I + D) de los últimos 10 s y registro de los últimos parpadeos.
- Las marcas de tiempo son las de captura de la cámara (`captureTime`) cuando el navegador las da.
- Casilla «Calcular blendshapes» para medir su coste.
- **Asistente de pruebas** (`src/assistant/`, `src/ui/assistant.js`, `docs/pruebas.md`): guía paso a paso (reposo, parpadeo espontáneo, guiños, parpadeo flojo, cierre mantenido, mirada arriba y abajo, cabeceo) con cuenta atrás, instrucción sobre el vídeo, pitidos y vibración, pantalla encendida y revisión de cada paso (lo detectado, lo contado por el usuario y observaciones). Guarda un JSON de diagnóstico (`orbicula-test-session/1`) con configuración, rendimiento, eventos y series, que se descarga, se comparte o se copia sin series. El motor de pasos (`GuidedSession`) es la base del protocolo guiado de la fase 5.
- Asistente: **Repetir este paso** en cualquier momento (también durante la cuenta atrás o la grabación), **← Paso anterior**, **Rehacer el último paso** al terminar, y **Detener** que guarda lo hecho y permite **Retomar sesión** en el paso en curso. Lo ya guardado se conserva y el JSON anota el nº de intento de cada paso.
- 91 tests (señales sintéticas de parpadeo con ruido, jitter, deriva, pérdida de cara y espejo).

### Añadido (fase 2: landmarks)
- MediaPipe Face Landmarker 1.1.0 con el modelo (`public/modelos/`) y el WASM servidos desde el propio sitio; `scripts/copy-wasm.mjs` copia el WASM antes de `dev` y `build`. GPU con respaldo a CPU.
- ROI por lado del paciente (párpado superior, párpado inferior, ceja y canto externo) y ROI de referencia en el dorso nasal, en píxeles del frame completo (`src/roi/`). Los índices salen del mallado oficial y están documentados en `src/roi/indices.js`; el canto externo es una caja derivada.
- Lateralidad en un único sitio (`src/roi/laterality.js`): lado del paciente según la imagen analizada vaya o no en espejo, y blendshapes con lado. Tests de espejo para ROI y blendshapes.
- Superposición de las ROI (azul I, rosa D, referencia discontinua) con espejo solo en el dibujo, interruptor «Mostrar ROI».
- Pastillas de fotogramas analizados por segundo, ms de análisis y tamaño del ojo en píxeles; avisos de «no se detecta la cara» y «cara pequeña».
- Panel «Verificación de lado (guiño)»: blendshapes de parpadeo y apertura por landmarks, I y D, con opción de invertir los blendshapes.
- CSP con `'wasm-unsafe-eval'` para el WASM; sin orígenes externos.

### Verificado en el móvil del autor
- Lateralidad con guiños de cada ojo, con la cámara frontal y con la trasera: la apertura por landmarks y el blendshape de parpadeo suben en el lado correcto (I = izquierda del paciente). La asignación por defecto de los blendshapes es la correcta (no hace falta invertirla).
- Análisis con la frontal en prioridad «Resolución»: 25–28 análisis/s, 33–37 ms, GPU; ojo de ≈ 250 px de ancho.

### Añadido: prueba de rendimiento y barrera de privacidad
- **Prueba de rendimiento** (`src/assistant/benchmark.js`, `src/ui/benchmark.js`, `docs/rendimiento.md`): 8 pasadas de 12 s (worker / hilo principal × con / sin blendshapes, dos rondas en orden cruzado) que registran el tiempo de cada análisis, los fps, la latencia, el coste de copiar el frame al worker y la fluidez del hilo principal (repintados lentos y tareas largas). Exporta un JSON `orbicula-benchmark/1`.
- **Barrera de privacidad** (`src/privacy/`): bloquea fetch, XMLHttpRequest, WebSocket, EventSource y sendBeacon a cualquier otro origen, en la página y en el worker. Motivo: la librería de MediaPipe intenta enviar un registro de uso a `odml.pa.googleapis.com/v1/log`; la CSP lo bloqueaba, pero solo si el hosting sirve `_headers` (GitHub Pages, donde copiará el hub, no lo hace) y un worker no hereda la CSP de la página. Los dominios bloqueados se muestran en «Verificación de lado» y se guardan en los JSON.
- Prueba de rendimiento pensada para la cámara trasera, sin mirar la pantalla: cuenta atrás de 10 s para colocarse, pitido de inicio, tono grave cada 3 s si se pierde la cara, tres pitidos y vibración al terminar, y pantalla siempre encendida (`src/ui/cues.js`).
- `WorkerAnalysis` mide el coste de la copia del frame (`bitmapMs`) y la ida y vuelta (`roundTripMs`), y tiene `dispose()`.

### Corregido (a partir de las pruebas de rendimiento con la frontal y la trasera)
- Los fps de la cámara se miden con el **mayor** de dos recuentos que se quedan cortos en situaciones distintas: los callbacks de vídeo (se pierden con el hilo principal ocupado: con la trasera a 4K, 44 en el worker y 20 en el hilo principal frente a unos 53 reales) y `presentedFrames` (con la frontal quedó por debajo de los frames analizados: 28 por segundo frente a 25,9). Los JSON de rendimiento llevan `callbackFps` y `presentedFps` además de `cameraFps`. Los 24–25 fps de las sesiones anteriores con la frontal probablemente infravaloraban la cámara.
- **Prioridad por defecto «fps»** en vez de «Resolución»: con la trasera a 4K el análisis iba a 16–21 por segundo.

### Cambiado (a partir de la primera sesión real con la cámara frontal)
- Detector de parpadeos: un cierre ya no acaba al recuperar un % fijo del reposo sino al recuperar el 60 % de **su propia profundidad** (o el 90 % del reposo, lo que ocurra antes). Antes, si el ojo se quedaba un rato más entornado, el detector se «atascaba» durante segundos y se tragaba los parpadeos siguientes (en los datos: un cierre de 5,4 s que ocultaba cuatro parpadeos). Reposo de 20 s: de 10 y 7 parpadeos detectados a 14 y 13 (anotados a mano: unos 13).
- Umbral de inicio 0,75 → 0,8 del reposo (y fin 0,85 → 0,9): recoge bajadas flojas que el muestreo de ~20 Hz apenas ve. Sin falsos eventos en mirada y cabeceo.
- Un parpadeo muy rápido de una sola muestra cuenta si cierra al menos el 40 %.
- Nuevo tipo de evento `narrowing` («entornado»): más de 0,8 s pero con un cierre menor del 50 %. Se distingue de `closure`.
- Las series del asistente guardan también los blendshapes de mirada (`lookDown`, `lookUp`) para estudiar los falsos cierres al mirar hacia abajo.
- Asistente: textos de revisión más claros («cierres de más de 0,8 s») y avisos en los pasos de guiño y de mirada.
- Los fps de la cámara se miden con `presentedFrames`, para que el análisis no los infravalore.

### Añadido
- Fase 1 (base): esqueleto Vite sin framework.
- Cámara en directo: trasera por defecto, selector trasera/frontal y de dispositivo (si hay más de dos), petición de 60 fps y máxima resolución, con prioridad «resolución» o «fps».
- Medición de fps reales con `requestVideoFrameCallback` y resolución real de los frames; aviso si el directo no llega a 24 fps.
- Prioridad «fps»: intento estricto con un mínimo de 55 fps (con solo «ideal», Chrome para Android se queda en 30) y, si la cámara no puede, sin él.
- Vista frontal en espejo (solo la vista previa).
- Tokens visuales en `src/styles/tokens.css` con tema oscuro y claro; fuentes servidas desde el propio sitio.
- Despliegue en Cloudflare Workers (producción en `main`, previsualización por rama) con CSP que impide llamadas externas.
- CI en GitHub Actions: tests y build.
