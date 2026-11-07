# Plan de la fase 4: flujo óptico

Aprobado por el autor el 2026-11-07. Este documento recoge también el estado al final de la fase 3, para que una sesión nueva pueda empezar sin el historial de la anterior. Léelo junto con `CLAUDE.md`, `CHANGELOG.md`, `docs/rendimiento.md`, `docs/pruebas.md` y `docs/desarrollo.md`.

## Qué tiene que demostrar
La pregunta de la v0: **¿el flujo óptico sobre la región periocular da una señal útil para detectar movimientos más finos que los que capta un landmark?** Se cierra con dos criterios de aceptación de `CLAUDE.md`, con estos umbrales (aprobados):

- **Criterio 3:** con la cabeza quieta, durante la contracción mínima la energía del flujo es **≥ 3 veces el percentil 95 del reposo**, mientras el EAR cambia **menos que su propio ruido** (su desviación típica en reposo).
- **Criterio 4:** durante un cabeceo suave sin contracción, con la compensación, **ninguna ROI supera el percentil 99 del reposo**.

**Maniobra de contracción mínima** (frase elegida por el autor para el asistente): «Entrecierra los ojos lo mínimo, como si sonrieras con los ojos.»

## Estado al final de la fase 3 (medido en el móvil del autor)
Android 10, Chrome 156, 9 núcleos, 8 GB.

| | Frontal «fps» (720p) | Trasera «Resolución» (4K) | **Trasera «fps» (720p)** |
|---|---|---|---|
| Cámara real (`presentedFps`) | ~25–30 (dudoso) | ~53 | **60** |
| Análisis (worker), ms | 40 | 53 | **34** |
| Análisis (worker), análisis/s | 24 | 19 | **29** |
| Latencia captura → resultado (worker) | 74 ms | 117 ms | 67 ms |
| Copia del frame al worker | 1,3 ms | 7 ms | 1,5 ms |
| Pantalla con el worker / con el hilo principal | 60 / 14 Hz | 60 / 22 Hz | 60 / 27 Hz |

Decisiones tomadas: análisis de la cara **en worker** (el hilo principal congela la interfaz); **blendshapes encendidos** (cuestan < 1 ms); **prioridad por defecto «fps»**; **trasera «fps» es el punto de trabajo** (60 fps de cámara, EAR cada ~34 ms). El tiempo de MediaPipe no depende de la resolución (el modelo reduce la imagen). Con la trasera a 4K el móvil se calienta y se ralentiza al cabo de ~1,5 min.

Problemas abiertos que afectan a esta fase:
- **Falsos cierres al mirar hacia abajo.** El EAR y el blendshape de parpadeo no los distinguen (el párpado baja de verdad). El flujo tampoco lo resolverá. Las series del asistente ya guardan `lookDown`/`lookUp`; en esta fase, guardar también la **posición del iris** (landmarks 468 y 473, normalizada a las comisuras) para estudiarlo.
- **Medida de fps de cámara:** ni los callbacks de vídeo ni `presentedFrames` aciertan siempre; se usa el mayor de los dos (`FpsMeter`).
- **Latencia del worker (~67 ms):** la ROI dibujada va ~4 frames por detrás. Para el flujo no importa si se usan marcas de tiempo de captura.
- Idea no aplicada: `MediaStreamTrackProcessor` evitaría la copia del frame al worker (ganancia estimada 2–3 análisis/s).

## Arquitectura propuesta
1. **Worker de flujo propio** (`src/flow/flow.worker.js`) con OpenCV.js, separado del de MediaPipe (el flujo usa CPU/WASM, MediaPipe GPU: trabajan en paralelo). Importa `src/privacy/install.js` **lo primero**, como el worker de análisis.
2. **OpenCV.js 5.0.0-release.1** (`@techstark/opencv-js`, junio de 2026): un solo `opencv.js` de 13 MB con el WASM embebido; incluye `calcOpticalFlowFarneback`, `calcOpticalFlowPyrLK` y, en apariencia, `DISOpticalFlow` (verificar que está exportado). Servido desde el propio sitio (como el WASM de MediaPipe: copiado en el build, caché `immutable` con la versión en la ruta), **cargado solo al activar el flujo**. La CSP ya tiene `'wasm-unsafe-eval'`; comprobar que no necesita `eval`. Liberar siempre los `cv.Mat` (`delete()`) o se agota el heap de WASM: reutilizar buffers.
3. **Una franja periocular por frame** (ambos ojos, cejas y dorso nasal, con margen), recortada **del frame completo** en el hilo principal con `createImageBitmap(video, sx, sy, sw, sh)` (recorte en GPU), en **cada frame de la cámara** (hasta 60/s, no solo los ~29 que analiza MediaPipe), con su marca de tiempo de captura.
   - El flujo se calcula entre dos frames **con el mismo recorte**. La franja solo se recoloca cuando la cara se ha movido bastante; ese par no se mide.
   - Dentro de la franja, cada ROI (párpado superior e inferior, ceja, canto externo por lado; dorso nasal de referencia) se separa con su polígono, tomado de los últimos landmarks y pasado a coordenadas de la franja.
   - Escala de trabajo configurable (a 4K la franja ronda 1000 px de ancho: puede hacer falta reducirla).
   - Normalizar el brillo de cada recorte (media y varianza) contra el parpadeo de las luces a 50 Hz.
4. **Compensación de la cabeza: tres variantes calculadas a la vez** sobre el mismo flujo, para compararlas con los mismos datos:
   - **ninguna** (control);
   - **referencia:** restar el movimiento del dorso nasal (traslación, o afín si está bien condicionada);
   - **postura:** restar el movimiento rígido que predicen landmarks estables (dorso nasal, sienes, frente; o la matriz de transformación facial, `outputFacialTransformationMatrixes`), interpolado entre análisis. Sospecha: será la mejor, porque el dorso nasal no es rígido en el cierre forzado (prócer).
5. **Métricas por ROI y por lado del paciente:**
   - **energía residual** = media de |flujo − flujo de la cabeza|² en la ROI, con el desplazamiento normalizado a la distancia intercantal y por segundo (independiente de la distancia y de los fps);
   - **componente vertical con signo** (el párpado baja o sube);
   - **componente horizontal con signo «hacia la sien»** (comparable entre lados; con test de espejo, como en `tests/roi.test.js`).
6. **Interfaz:** métrica «Flujo» por ROI en las curvas (I y D); superposición opcional del campo de flujo; ms de flujo por frame en «Verificación de lado».

## Pasos (detenerse al final de cada uno para que el autor pruebe en el móvil)
- **4a. Rendimiento primero.** OpenCV.js en el worker, recorte de la franja, Farnebäck, y **ampliar la prueba de rendimiento** (`src/ui/benchmark.js`, `src/assistant/benchmark.js`) para medir los ms de flujo por frame y los frames por segundo que da, con la trasera «fps» (720p, 60 fps) y «Resolución» (4K). Si Farnebäck no llega, probar DIS o Lucas-Kanade sobre una rejilla. Sale de aquí el punto de operación.
- **4b. Medida completa:** métricas, las tres compensaciones, curvas, superposición y un **asistente de la fase 4** (pasos nuevos en `src/assistant/steps.js` o un segundo plan) que guarde en el JSON las series de flujo, EAR e iris. Pasos propuestos: reposo 20 s; «Entrecierra los ojos lo mínimo, como si sonrieras con los ojos» ×5 con pausas; entrecerrar algo más (que el EAR sí lo note) ×3; cabeceo suave 15 s; giro lateral suave 10 s; elevación de cejas ×3; parpadeo espontáneo 20 s.
- **4c. Análisis del JSON del autor** y decisión de la compensación y la normalización, con los números delante. Comprobar los criterios 3 y 4 con los umbrales de arriba.

## Resultados del paso 4a (móvil del autor, 2026-11-07)
Prueba de rendimiento `orbicula-benchmark/2`, análisis de la cara en worker con blendshapes y flujo a la vez.

| | Frontal «fps» | **Trasera «fps» (720p)** | Trasera «Resolución» (4K) |
|---|---|---|---|
| Cámara | 24 fps | 60 fps | 60 → 30 fps (se calienta) |
| Franja (frame completo) | 220 × 98 px | ~340 × 165 px | ~1100 × 500 px |
| Análisis de la cara sin flujo | 23,7/s | **28,1/s (35 ms)** | 18,5/s (53 ms) |
| Ídem con Farnebäck 320 px | 24,0/s | **22,2/s (44 ms)** | 14,0/s |
| Farnebäck 320 px: ms / pares/s | 12 / 24 | **23 / 25** | 56 / 11 |
| Copia de la franja a la CPU | 10 ms | **16 ms** | 24–64 ms |
| Lucas-Kanade 640 px: ms / pares/s | 8 / 24 | 19 / 29 | 139 / 6 |

Conclusiones:
- **4K en directo no sirve para el flujo** (Farnebäck sin reducir: 590 ms, 1,5 pares/s; la cámara cae a 30 fps por calor). Queda para el modo de vídeo grabado, como ya decía `CLAUDE.md`.
- **Punto de trabajo: trasera «fps» (720p) con Farnebäck a 320 px.** Lucas-Kanade apenas ahorra y da menos información.
- A 60 fps el flujo **frena a MediaPipe por debajo de 24 análisis/s** (criterio 1): los dos workers compiten por la CPU. Con la frontal (24 fps) no pasaba.
- Un tercio del tiempo del worker era **copiar la franja** (RGBA desde la GPU), no el flujo.
- Error encontrado: con la cara en el borde del frame, la franja se recolocaba en cada análisis (117 veces en una pasada). Corregido en el 4a bis.
- El autor observa que, al guiñar un ojo, el otro marca un cierre solo ~10 % menor: probablemente la malla de MediaPipe acopla los dos ojos. Añadir guiños por lado al asistente del 4b y compararlos con el flujo.

## Paso 4a bis
Para recuperar los 24 análisis/s con flujo: leer solo el **plano Y** del `VideoFrame` de la franja en el worker (sin RGBA; respaldo con `createImageBitmap` si el frame no es YUV legible, que se anota), **Farnebäck ligero** (2 niveles, ventana 9, 2 iteraciones) y **límite de 30 pares/s**. La prueba de rendimiento compara esas variantes con la referencia de la 4a (Farnebäck 320 px). Hacerla con la trasera en «fps».

### Resultados del 4a bis (trasera «fps», 2026-11-07, commit 72d0f3f)
La cámara dio ~40 fps en esta sesión (60 en la anterior; probablemente menos luz).

| | pares/s | ms flujo | ms copia | ms worker | análisis de la cara/s |
|---|---|---|---|---|---|
| Sin flujo | — | — | — | — | 28,4 |
| Farnebäck 320 (RGBA, como en la 4a) | 26 | 23 | 14,7 | 38 | 24,1 |
| Farnebäck 320, plano Y | 41 | 20 | **1,2** | 21 | 23,8 |
| Farnebäck ligero, plano Y | 40 | 19 | 1,3 | 20 | 23,6 |
| Ligero, plano Y, «30/s» | 21 | 22 | 1,6 | 24 | 26,0 |

- **El plano Y funciona en el móvil** (`I420`, sin respaldo): la copia baja de 15 a 1,2 ms y la latencia del flujo de 75 a 40 ms.
- **El Farnebäck ligero apenas ahorra** (19 frente a 20 ms): se descarta, para no perder precisión.
- El límite de 30/s daba 20/s con la cámara a 40 fps (saltaba un frame de cada dos). Corregido con un límite por crédito (`src/flow/rate.js`).
- El flujo sigue restando ~4 análisis de la cara por segundo (28 → 24); con el límite, ~2,5.
- **Punto de trabajo elegido: trasera «fps», Farnebäck 320 px, plano Y, 30 pares/s** (`farneback-320-vf-30`, la configuración por defecto). Se comprobará de paso con los datos de rendimiento del asistente del 4b.

## Paso 4b (hecho, pendiente de la prueba en el móvil)
- Implementado según la arquitectura de arriba (puntos 4–6) y el asistente propuesto, con guiños de cada ojo añadidos (problema del ojo que no guiña) y pitidos en cada repetición. Ver `CHANGELOG.md`.
- Decisión de diseño: el worker devuelve 14 sumas por ROI en vez del campo; así la compensación por postura puede esperar al análisis siguiente y las tres variantes se calculan exactas a partir de las mismas sumas.
- Vídeos sintéticos en Chromium (`scripts/dev/check-flow.cjs`): párpado de 1,5 px visto en su lado (máx. ~0,03 DI/s frente a 0 en reposo) sin cambio del EAR; cabeceo de 6 px: sin compensar 0,04–0,13 DI/s, dorso nasal 0,006–0,017, postura 0,014–0,107. **La postura añade el temblor de la malla** (0,01–0,03 DI/s con la cara quieta), comparable al movimiento fino del párpado. En el móvil MediaPipe va a ~28/s (no 9) y puede salir mejor: decidir en el 4c.
- Para el 4c: con el JSON del asistente, comparar por paso y compensación el p95/p99 de la energía frente al reposo (criterios 3 y 4), las marcas de las repeticiones frente a la energía, el EAR frente a su ruido y, en los guiños, el flujo del ojo que no guiña.

## Paso 4c: primer análisis (JSON del autor, 2026-11-07, commit bff7b1d)
Trasera «fps» (la cámara dio ~30 fps; poca luz), modo seguido. Análisis: `node scripts/dev/analyze-flow.mjs informe.json`.

- **Criterio 1 (rendimiento): cumple.** Con el flujo encendido, análisis de la cara 25–30/s y flujo ~29 pares/s.
- **Retraso del gesto:** llega 0,5–1 s (mediana ~0,8 s) después del pitido «ahora» (latencia del audio + reacción). El análisis se alinea con el movimiento real (bajada más rápida del EAR), no con el pitido.
- **Reposo** (sin parpadeos), p95 de la velocidad residual con el dorso nasal: párpado superior ~0,22 DI/s (los ojos nunca están del todo quietos), inferior 0,14–0,16, canto 0,11, ceja 0,09. Ruido del EAR: DT ≈ 0,010.
- **Detección:** el flujo marca cada contracción en las ROI que tocan (picos de energía ×10–160 el p95 del reposo) y la elevación de cejas sobre todo en la ceja (×50–240).
- **Criterio 3: sin concluir.** La «contracción mínima» cerró el ojo un 14–38 % según el EAR (5–12 DT de su ruido): **el EAR también la ve**, así que no era menor de lo que mueve el EAR. La apertura por flujo integrada (∫ componente vertical párpado inferior − superior) tiene una relación señal/ruido parecida (6–8 DT). Hace falta una contracción mucho más pequeña (EAR < 1 DT) para contrastarlo: se añade «tan poco que casi no lo notes» a la explicación hablada.
- **Criterio 4: cumple en los párpados, no en la ceja.** Con el dorso nasal, % de pares sobre el p99 del reposo: cabeceo, párpados 0 % y canto 0–3 %; giro, párpados 0–1 %, canto 5–27 %. La ceja falla (27–60 %): está lejos del dorso nasal y en los giros se mueve distinto (perspectiva); una traslación no basta. Pendiente: compensación afín local (más puntos de referencia a la altura de la ceja) o referencia por lado.
- **Compensación elegida: dorso nasal.** Menor ruido en reposo en todas las ROI y mejor en el criterio 4 para párpados y canto. La postura solo mejora la ceja en el cabeceo (11–19 % frente a 27–30 %) y añade el temblor de la malla. Se sigue calculando y guardando, como experimental.
- **Normalización (DI/s) adecuada:** valores coherentes entre lados y pasos.
- **Guiños (ojo que no guiña):** en el guiño izquierdo, el EAR dice que el ojo derecho se cierra un 66–86 % (el izquierdo, 79–91 %: la diferencia de ~10 % que vio el autor), mientras que el flujo integrado dice que se mueve la mitad que el que guiña. Apoya en parte que la malla exagera el cierre del otro ojo. En el guiño derecho no es concluyente: integrar el flujo no es fiable con cierres completos (el párpado tapa el ojo y el flujo pierde el seguimiento).

## Paso 4c: segundo análisis (JSON del autor, 2026-11-07, commit ef4c2a5)
Trasera «fps», modo seguido con voz, contracción mínima más pequeña. Luz de interior escasa y a contraluz (ventana detrás): la cámara volvió a dar ~30 fps y el ruido del flujo sin compensar en reposo subió (párpado superior p95 0,33 DI/s frente a 0,23). Auriculares: si son Bluetooth, añaden latencia a los pitidos (parte de los ~0,8 s de retraso del gesto).

- **Criterio 1: justo.** Análisis de la cara 22–28/s (por debajo de 24 en varios pasos; quizá el móvil caliente tras la prueba anterior o la poca luz). Vigilar; si hace falta, bajar el flujo a 25 pares/s.
- **Criterio 3: primera evidencia a favor, con el estadístico adecuado.** La energía (velocidad) no discrimina: en reposo los ojos ya tienen movimientos rápidos (sacadas). Lo que funciona es el **desplazamiento integrado**: apertura por flujo = ∫(componente hacia abajo del párpado inferior − del superior) dt, compensada con el dorso nasal. Calibrado frente a ventanas de reposo sin parpadeos (percentil; ≥ 95 = detectado):
  - contracción mínima, repeticiones 1–3: **flujo 100 en los dos ojos; EAR 60–95** (solo una de seis por encima de 95). Repetición 4: flujo 82–91, EAR 54–68. Repetición 5: ninguno.
  - primer JSON: flujo 100 en las 5; EAR 86–100.
  - Limitaciones: pocas repeticiones, ventanas nulas solapadas (57) y sin control de «no hacer nada». Para cerrarlo hace falta una prueba con más repeticiones y **repeticiones de control** (pitido sin gesto), que dé tasas de acierto y de falsos positivos para el EAR y para el flujo.
- **Criterio 4:** párpados, 0 % sobre el p99 del reposo en cabeceo y giro con el dorso nasal (cumple). Canto y ceja no: en el giro, 47–58 % con el dorso nasal y 30–41 % con la postura; en el cabeceo, el dorso nasal empeora el canto (10–20 % frente a 5 % sin compensar). Las regiones laterales necesitan su propia compensación (afín local con puntos cercanos, o la postura para ellas).
- **Guiños:** en el guiño izquierdo, ojo que no guiña / ojo que guiña: EAR 0,6 y flujo integrado 0,5. Esta vez se parecen; sigue sin estar claro si la malla exagera. El flujo integrado no es fiable con el ojo cerrado del todo.

## Paso 4c: prueba con controles (JSON del autor, 2026-11-07, commit 89eba00)
Plan «contracción mínima con controles»: 20 repeticiones al azar (10 contracciones mínimas, 10 controles). Análisis: `node scripts/dev/analyze-flow.mjs informe.json` (apartado «CRITERIO 3 CON CONTROLES»).

- Se apartan solo las repeticiones con un parpadeo de verdad (cierre ≥ 50 %): 5 de 20. El detector marca además eventos poco profundos (20–35 %) tras muchas contracciones; son la propia contracción o ruido, y apartarlos quitaba sobre todo contracciones (primera versión del análisis: 11 de 20 apartadas, 7 de ellas contracciones).
- Resultado (7 contracciones y 8 controles válidos; detectada = por encima del p95 de 108 ventanas de reposo):

  | medida | aciertos | falsas alarmas | AUC |
  |---|---|---|---|
  | EAR izquierdo | 2/7 | 1/8 | 0,77 |
  | EAR derecho | 4/7 | 1/8 | 0,84 |
  | **cierre por flujo, izquierdo** | **6/7** | 1/8 | 0,88 |
  | **cierre por flujo, derecho** | **6/7** | 1/8 | 0,96 |

- Por ojo, el flujo detectó 6 contracciones que el EAR no vio y el EAR ninguna que el flujo no viera.
- El autor se equivocó en la repetición 1 de la primera tanda (contrajo en un control): `--fix micro-1:1=act`. No cambia nada, porque esa repetición ya quedaba apartada por un parpadeo; el flujo la marcó (100/100) y el EAR no (69/85). En el resto hizo el gesto que tocaba, así que la falsa alarma (el mismo control en las cuatro medidas) es real: coincide con un cierre parcial poco profundo (23–33 %) que el detector marcó como parpadeo.
- **Criterio 3: cumplido de forma provisional.** El cierre por flujo detecta contracciones mínimas que el EAR no distingue del reposo, sin más falsas alarmas. Muestra pequeña: conviene repetirlo otro día, con buena luz, para confirmarlo.
- Rendimiento: análisis de la cara 20–25/s (por debajo de 24 en las tandas), probablemente por calor tras tres pruebas seguidas. Pendiente: bajar el flujo (p. ej. a 24 pares/s) cuando el análisis de la cara no llegue.

## Propuesta para terminar la fase 4 (1 y 2 hechos; aprobada por el autor)
1. **Apertura por flujo** como métrica de la app (curva y JSON), con corrección de la deriva (integrador con fuga o restar la línea base de los últimos segundos).
2. **Prueba de contracción mínima con controles**: ~10 contracciones mínimas y ~10 controles en orden aleatorio, con dos pitidos distintos («contrae» / «no hagas nada»); tasas de acierto y falsos positivos del EAR y del flujo.
3. **Compensación de las regiones laterales** (canto y ceja). **Hecho:** variante «dorso nasal + giro» (giro 3D estimado con los landmarks; ver `CHANGELOG.md`), junto con el ajuste automático del ritmo del flujo. Pendiente de la prueba completa de la fase 4 en el móvil para comparar `eR` y `eH` en el cabeceo y el giro (criterio 4).

## Pruebas
- **Vídeos sintéticos con la respuesta conocida** (ampliar `scripts/dev/make-face-videos.py`): mover solo el párpado 1–2 px (el flujo lo tiene que ver) y, por separado, toda la cara simulando un cabeceo (la compensación lo tiene que anular).
- **Tests unitarios:** energía, máscaras de ROI en coordenadas de la franja, recolocación de la franja, signos con espejo y el ajuste del movimiento rígido.
- La prueba de punta a punta con la CSP real: `docs/desarrollo.md`.

## Riesgos
- Tamaño de OpenCV.js (13 MB, una vez y en caché).
- Velocidad en el móvil: quizá solo 30 fps o escala reducida (lo dice el paso 4a).
- Parpadeo de las luces a 50 Hz → flujo falso: normalizar brillo; para las pruebas, luz natural o lámpara sin parpadeo.
- Poca textura en la piel lisa → flujo ruidoso; las pestañas y las cejas dan buena señal.
- Calentamiento del móvil con dos workers y la cámara: vigilarlo en la prueba de rendimiento.

## Forma de trabajar con el autor
- Responde en español, claro y sin jerga innecesaria; el autor es fisioterapeuta y trabaja solo desde el móvil.
- Al terminar cada paso: URL de la previsualización de la rama y qué probar. El autor prefiere **asistentes guiados que exporten JSON** a pasar capturas, con pitidos y cuenta atrás para cuando usa la cámara trasera y no ve la pantalla.
- PR y fusión solo cuando el autor lo pida. Commits sin `Co-Authored-By`.
- Modelo: Opus para el plan y la implementación de esta fase (`docs/modelos.md`).
