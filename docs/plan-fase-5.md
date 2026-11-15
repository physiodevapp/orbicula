# Plan de la fase 5: protocolo guiado

**Estado: fase hecha (5a–5d).** La conclusión y lo pendiente están en «Conclusión de la fase 5».

**Aprobado por el autor el 2026-11-07, con las recomendaciones:**
- umbral = máximo del reposo;
- duraciones de la tabla;
- tarjeta «Protocolo» aparte;
- la voz habla al paciente de **tú**.

Se lee junto con `CLAUDE.md` y la «Conclusión de la fase 4» de `docs/plan-fase-4.md`.

## Qué tiene que hacer
Un protocolo clínico guiado de seis fases que, al acabar, dé un **resumen por fase y lado con su asimetría** y un **registro de eventos**, con los umbrales calibrados sobre el reposo del propio paciente. Lo usa el clínico con el paciente delante: la voz y los pitidos van dirigidos al paciente.

## Decisiones de la fase 4 que se respetan
1. **Los eventos salen del cierre por flujo** (`closure` de `src/flow/processor.js`, compensado con el dorso nasal).
2. **El EAR, para los parpadeos y los cierres completos.** Cuando el párpado tapa el ojo, el flujo pierde el seguimiento.
3. **Puerta «cabeza en movimiento»:** mientras el dorso nasal se mueva más que en el reposo, no se registran eventos y sale un aviso.
4. **Reposo inicial largo y con la cabeza apoyada.** Si no es válido, se repite antes de seguir.
5. **Calor:** se guarda el ritmo del análisis de cada fase. Si una fase baja de 24 análisis/s, el resumen la marca como poco fiable.

## Las seis fases (duraciones por defecto, configurables)

| # | Fase | Cómo | Para qué |
|---|---|---|---|
| 1 | **Reposo (calibración)** | 30 s, mirando al frente y con la cabeza apoyada | Umbrales, apertura en reposo y ruido. Pico espectral en reposo (mioquimias). |
| 2 | **Parpadeo espontáneo** | 60 s | Frecuencia, duración y completitud de los parpadeos. |
| 3 | **Cierre suave** | 3 repeticiones de 3 s (pitido agudo: cierra; grave: abre) | Completitud del cierre (cierre incompleto). |
| 4 | **Cierre forzado** | 3 repeticiones de 3 s | Cierre máximo del paciente y reclutamiento de la ceja y el canto. |
| 5 | **Elevación de cejas** | 3 repeticiones de 3 s | Movimiento de la ceja y co-activación de los párpados. |
| 6 | **Sonrisa amplia** | 3 repeticiones de 3 s | Co-activación ojo–boca (sincinesia). |

Unos 4 minutos con las cuentas atrás habladas. Se reutiliza `GuidedSession` tal cual: cuenta atrás, pitidos (agudo = ahora, grave = suelta), modo seguido, voz con las voces del móvil, repetir, paso anterior, detener y retomar.

## Paso a paso de la calibración (fase 1)
Del reposo salen, por lado:
- **Apertura en reposo:** percentil 90 del EAR y de la apertura normalizada a la distancia intercantal, sin los parpadeos. Se fija como línea base del detector de parpadeos (`BlinkDetector`, opción `baseline`). Así, el detector deja de estimarla sobre la marcha.
- **Ruido del EAR:** su desviación típica.
- **Umbral de la cabeza quieta:** 3 × la mediana de la velocidad del dorso nasal en el reposo, con un mínimo de 0,1 DI/s. Es la regla de `analyze-flow.mjs`.
- **Umbral del cierre por flujo** (ver «Eventos»).
- **Ruido de la energía de la ceja y del canto:** su percentil 99, para sus eventos experimentales.

**Validez del reposo:** hacen falta al menos 15 s con la cabeza quieta y sin parpadeos. Si no se llega, el protocolo no sigue y dice: «La cabeza se ha movido durante el reposo. Apóyala y repetimos». Lo mismo si se pierde la cara más del 10 % del tiempo.

## Eventos
**Medida.** «Cuánto se ha cerrado el ojo respecto a cómo estaba justo antes». Es el mismo estadístico de la prueba que cumplió el criterio 4: lo máximo que sube el cierre por flujo en 1,5 s respecto a la mediana de los 0,6 s anteriores. Se calcula en directo, en versión causal:

  subida(t) = cierre(t) − mínimo, para h entre t − 1,5 s y t, de la mediana del cierre en [h − 0,6 s, h].

Es exactamente el máximo de las ventanas del análisis que contienen t. El test lo comprueba sobre datos reales.

**Umbral (decisión para el autor).** Por defecto, el **máximo de la subida en el reposo válido**: es el umbral con el que el cabeceo y el giro dieron un 0 % de ventanas por encima (criterio 4). Alternativa: el percentil 95, que es el que dio 12/13 aciertos, pero con más falsas alarmas. Con el máximo, en la prueba de las 19:14 la contracción más débil multiplicaba por unas 8 veces el control más fuerte: hay margen. Además, un **suelo** absoluto evita que un reposo muy quieto dé un umbral ridículo. El suelo se fija con los JSON de la fase 4.

**Un evento** empieza cuando la subida pasa del umbral y acaba cuando baja de la mitad. Se guardan el lado, la fase, el inicio, la duración, el pico (en veces el umbral) y el tipo:

| Tipo | De dónde sale |
|---|---|
| `contraction` | Cierre por flujo por encima del umbral, sin un parpadeo a la vez. |
| `blink` / `closure` | Detector del EAR, solo los de cierre ≥ 50 % (lección de la fase 4). |
| `brow`, `canthus` (experimental) | Energía de la ROI por encima de su p99 del reposo × un margen. Van aparte en el resumen: con giros no son fiables. |

Si la contracción coincide con un parpadeo ≥ 50 % del mismo ojo, cuenta como parpadeo y no como contracción.

**Puerta de la cabeza.** Con la velocidad del dorso nasal por encima de su umbral, no se abren eventos y se descarta el que empiece hasta 0,5 s antes. Aviso sobre el vídeo: «Cabeza en movimiento: quieto». Cada fase guarda el % de tiempo válido.

**En directo:** una marca en las curvas y una lista con los eventos. El umbral se ve como una línea en la curva del cierre.

## Métricas por fase y lado
Todas con su índice de asimetría (I − D) / (I + D) (`src/metrics/asymmetry.js`). Las de signo variable (desplazamientos) se dan con su valor absoluto.

- **Todas las fases:** eventos por tipo, % de tiempo válido, análisis/s.
- **Reposo:** apertura (EAR y normalizada), ruido, energía del flujo por ROI (p95) y pico espectral.
- **Parpadeo espontáneo:** frecuencia (por minuto), duración media y completitud media. También la completitud **respecto al cierre forzado del propio paciente**. El EAR no llega a 0 con el ojo cerrado (un cierre completo ronda el 70–80 %), así que comparar con el cierre máximo del paciente es más justo. Además, el % de parpadeos incompletos (< 80 % de ese cierre). Esta cifra es provisional.
- **Cierre suave y forzado:** cierre máximo por repetición (EAR) y su media. Cierre del suave respecto al forzado. Energía de la ceja y el canto durante el cierre (reclutamiento).
- **Cejas:** desplazamiento de la ceja hacia arriba (flujo integrado, compensado) y pico de energía frente al reposo. Contracciones de los párpados durante la elevación.
- **Sonrisa:** intensidad de la sonrisa por lado (blendshape `mouthSmile`), cierre del ojo del mismo lado (cierre por flujo y bajada del EAR) y **co-activación**.

**Pico espectral (mioquimias).**
1. Señal: componente vertical compensado de los párpados (`dR`), por lado.
2. Se remuestrea a 20 Hz: con el ajuste por calor el flujo baja a 20 pares/s, así que se cubre hasta 10 Hz.
3. Se apartan los parpadeos.
4. Método de Welch: ventanas de 4 s con Hann y solape del 50 %, entre 0,5 y 8 Hz.
5. Resultado: la frecuencia del pico y su **prominencia** (dB sobre la mediana de la banda). Se marca «actividad rítmica» si la prominencia supera un umbral y el pico se repite en la mayoría de las ventanas.

Se calcula en el reposo y en el parpadeo espontáneo. Hay dos dudas:
- El pulso (~1–1,5 Hz) y la respiración pueden dar picos. Se mira si salen en el dorso nasal y, si salen, se descartan.
- No hay pacientes con mioquimias para validarlo. Se comprueba con un vídeo sintético con el párpado oscilando a 3 Hz, y el umbral queda como provisional.

**Co-activación (sincinesias).**
1. Por lado, correlación (Pearson) entre `mouthSmile` y el cierre del ojo del mismo lado, en una rejilla común de 10 Hz.
2. Se toma el mejor desfase entre −0,3 y +0,3 s.
3. Se da también la **amplitud**: cierre del ojo durante las sonrisas en veces el umbral del reposo.

Se calcula en la fase de sonrisa y, como referencia, en el reposo.

**Ojo:** una sonrisa amplia sana también cierra algo el ojo (sonrisa de Duchenne). La co-activación por sí sola no indica una sincinesia. Lo que informa es la **asimetría entre lados** y su evolución entre sesiones. El resumen lo dice así y no da ninguna clasificación (está fuera de alcance).

## Interfaz
- **Tarjeta nueva «Protocolo»**, encima del asistente de pruebas, que se queda como herramienta de desarrollo.
- **Antes de empezar:**
  - código anónimo opcional;
  - duración de cada fase o número de repeticiones;
  - modo seguido, voz y pitidos;
  - recordatorio: «cabeza apoyada, buena luz, de frente».
- **Durante el protocolo:**
  - fase e instrucción sobre el vídeo;
  - aviso de la cabeza en movimiento;
  - curvas izquierda y derecha;
  - eventos.
- **Resumen al acabar:**
  - tabla con una fila por métrica y fase y tres columnas: izquierda, derecha y asimetría;
  - fases poco fiables marcadas, con el motivo (cabeza, cara perdida, análisis/s bajo);
  - lista de eventos;
  - aviso fijo: «Herramienta de apoyo y seguimiento, no de diagnóstico».

  Debe leerse a 380 px: en el móvil, la tabla se parte en una tarjeta por fase.
- **Exportación en esta fase:** el JSON de diagnóstico del asistente pasa a `orbicula-test-session/3`, con las series, la calibración, los eventos y el resumen, para que el autor me lo pase. Además, el resultado se construye ya con la forma del JSON público de `CLAUDE.md` (`protocol`, `metrics`, `events`, `timeseries`). En la fase 7 solo quedará fijar el esquema, documentarlo y el CSV.

## Pasos (me detengo al final de cada uno para que lo pruebes en el móvil)
- **5a. Calibración y eventos, sin interfaz nueva.**
  - Módulos puros, con tests: `src/protocol/calibration.js`, `events.js` y `gate.js`.
  - Un script `scripts/dev/replay-events.mjs` que repite el detector sobre los JSON de la fase 4. Comprueba, sin pruebas nuevas en el móvil, que reproduce los aciertos y las falsas alarmas de las pruebas con controles (12/13 y 2/15 por ojo) y el 0 % del cabeceo y el giro. Con eso se fija el suelo del umbral.
  - En la app, en la prueba «contracción mínima con controles» del asistente: eventos en directo, aviso de la cabeza y la línea del umbral. **Tu prueba:** repetirla una vez y ver que los eventos salen en las contracciones y no en los controles.
- **5b. El protocolo guiado.**
  - Las seis fases, la configuración de duraciones, la comprobación del reposo y el registro por fase.
  - JSON `/3`.
  - **Tu prueba:** el protocolo entero con la trasera, en modo seguido. Me pasas el JSON.
- **5c. Métricas por fase y resumen.**
  - FFT, co-activación, asimetrías, completitud relativa al cierre forzado y la pantalla del resumen.
  - Los umbrales provisionales se ajustan con tu JSON del 5b.
  - **Tu prueba:** otro protocolo, mirando el resumen y si cuadra con lo que hiciste. Incluye una sonrisa más fuerte de un lado y un parpadeo incompleto a propósito.
- **5d. Cierre de la fase.**
  - Ajustes con los datos.
  - `README.md` con las instrucciones de uso clínico del protocolo, `CHANGELOG.md` y la conclusión en este documento.

## Paso 5a (hecho; pendiente de la prueba en el móvil)
- Módulo puro `src/protocol/events.js`: `RiseTracker`, `calibrate` y `EventDetector`, con sus tests.
- **Cambios respecto al plan:**
  - El umbral de «cabeza quieta» tiene también un techo provisional de 0,3 DI/s. Si la cabeza se mueve casi todo el reposo, la mediana ya es movimiento y el umbral relativo se inflaría.
  - La velocidad de la cabeza se suaviza con la mediana de 3 pares.
- **Cámara simulada:** el asistente se recorre entero, calibra, sin errores ni peticiones externas. Los vídeos sintéticos no sirven para la sensibilidad: el párpado de 1,5 px da un cierre de 0,0014 DI, por debajo del ruido del reposo.

### Repetición sobre los JSON de la fase 4 (17:47, 18:38, 18:55 y 19:14)
Comando: `node scripts/dev/replay-events.mjs informe.json`. Para las 18:38, con `--fix micro-1:1=act`.

**Dos problemas en la primera versión:**
1. **Eventos falsos al empezar cada paso:** la subida se calculaba sin la historia completa. Ahora no hay subida hasta tener 2,1 s de señal.
2. **Eventos falsos hasta ~2 s después de cada parpadeo:** con el ojo tapado, el flujo pierde el seguimiento. Al integrarlo, el cierre queda desplazado, sobre todo en el parpadeo espontáneo y en un control de las 19:14. Alargar la ventana de fusión con el parpadeo lo quitaba, pero también quitaba contracciones.

   **Solución:** **congelar el cierre** (no integrarlo) mientras algún ojo esté cerrado más de la mitad según el EAR, con 150 ms de margen (`SHUT_FRACTION` en `src/flow/processor.js`). Las contracciones mínimas cierran un 14–38 %, así que no se congelan. El script recalcula así los JSON antiguos.

**Umbral.** Un margen sobre el máximo del reposo no ayuda. Con ×1,25 se perdían casi todas las contracciones de las 18:38: poca luz, reposo ruidoso y un umbral el doble de alto. Se queda en el **máximo del reposo**, como se aprobó. El suelo (0,001 DI) no actúa en ningún JSON real: los umbrales van de 0,020 a 0,057 DI.

**Primera prueba en el móvil con la 5a** (19:57, commit 57e261c, trasera, controles):
- La app en directo y la repetición coinciden.
- 10/10 contracciones en cada ojo, pero **3/9 falsas alarmas por ojo**.
- Casi todas las falsas alarmas coinciden con un parpadeo incompleto (20–45 %) y son **breves**.

**Duración mínima.** Juntando los cinco JSON, para cada repetición se toma la contracción más larga:

| | Duración |
|---|---|
| Contracciones mantenidas (80 repeticiones-ojo) | 600–1800 ms, salvo dos (272 y 393 ms) |
| Falsas alarmas en los controles (13) | 140–400 ms |
| Eventos en reposos y parpadeo espontáneo | 80–470 ms |

Por eso una contracción de **menos de 0,5 s queda como `brief`** («breve»). Se guarda, pero no cuenta (`minDurationMs`).

**Resultados finales del 5a** (umbral = máximo del reposo, cierre congelado en los parpadeos, duración ≥ 0,5 s):

| Prueba | Ojo izquierdo | Ojo derecho |
|---|---|---|
| Con controles: contracciones detectadas | **25/29** | **26/29** |
| Con controles: falsas alarmas | **0/26** | **0/26** |

| Prueba | Contracciones | Falsas alarmas |
|---|---|---|
| Contracción mínima, 17:47 | 3/4 | — |
| Contracción mínima, 18:55 | 5/5 | — |
| Cabeceo y giro | — | 0 eventos |
| Reposos y parpadeo espontáneo | — | 0 eventos |

- Las pruebas con controles son las de las 18:38, 19:14 y 19:57. Se excluyen las repeticiones con un parpadeo de verdad.
- Contracciones detectadas por prueba: 18:38, 7/10 y 8/10; 19:14, 8/9 y 8/9; 19:57, 10/10 y 10/10.
- Las contracciones perdidas son cortas, de la prueba con poca luz (18:38).
- Los dos controles con movimiento real de la fase 4 eran breves y ya no cuentan.
- Referencia del EAR en la fase 4: 6/13 y 10/13.
- **Límite:** un solo sujeto. Un parpadeo incompleto o una sacudida de menos de 0,5 s no cuentan como contracción, pero quedan registrados como «breve». Para las mioquimias (5c), esos eventos breves pueden ser justo lo que interesa.
- **Ceja y canto** (experimentales): demasiados eventos, decenas por paso con contracciones o parpadeos. No salen en el resumen hasta revisarlos en el 5c.

## Paso 5b (hecho; pendiente de la prueba en el móvil)
- Tarjeta «Protocolo clínico» (`index.html`, `src/protocol/steps.js`) sobre el mismo motor del asistente (`createAssistant` con prefijo de ids). Aparte del asistente de pruebas, como se aprobó.
- El reposo exige `requireValid`: la tarjeta repite el reposo si la calibración no vale, también en modo seguido (a los 7 s, con aviso de voz).
- **Tiempo válido mínimo:** un tercio del reposo (10 s de 30). Se bajó de la mitad (15 s) tras la prueba de las 17:24, que dio 16,6 s. Los tramos limpios mínimos para el umbral siguen siendo 3 s.
- **Cámara simulada:**
  - `lid.y4m`: las seis fases se completan solas, sin errores ni peticiones externas.
  - `nod.y4m` (la cabeza se mueve): el reposo sale «no válido» y se repite solo.
- **Lo que no hace todavía (5c):** resumen por fase y lado, asimetrías, FFT, co-activación y completitud relativa al cierre forzado. El JSON ya lleva lo necesario, incluida la serie `smile`.
- **Pendiente de decidir con tus datos:** los gestos duran 3 s con 4 s de pausa.

### Primera prueba del protocolo en el móvil (2026-11-08 13:38, commit d3d77ed, trasera «fps»)
- **Completo y limpio:** las seis fases en unos 4 min y 30 s, sin errores. Rendimiento: análisis de la cara de 23,8 a 27,1/s, flujo de 27 a 30 pares/s y sin rebaja automática, con el móvil frío.
- **Reposo:** el primer intento no valió y se repitió solo. El segundo dio 22,9 s de tiempo válido y calibración válida.
- **Parpadeo espontáneo:** 19 por minuto en el ojo izquierdo y 21 en el derecho.
- **Cierres (suave y forzado):** el EAR baja un 82–97 %, así que todas las repeticiones cuentan como parpadeos largos y el flujo se congela. En los cierres manda el EAR.
- **Sonrisa:** el blendshape de sonrisa llega a 0,96–0,98 en los dos lados, simétrico. En las repeticiones 1 y 2 el EAR baja un 67–69 % en los dos ojos (sonrisa de Duchenne), y en la 3 casi cierra el ojo.
- **Elevación de cejas:** la repetición 3 da una subida del cierre de 0,09–0,10 DI sin que cambie el EAR. Es la ceja moviendo el párpado superior.

**El umbral del reposo.** Salió de 0,063 DI en los dos ojos, el más alto de todas las pruebas (las anteriores, de 0,020 a 0,057). Lo fija un solo pico a los 25,7 s: el cierre sube 0,06 DI en un par de frames y el EAR baja un 13 %. Es una sacudida del párpado de menos de 0,2 s. El percentil 95 del reposo es 0,0045 DI.

## Paso 5c

### 1. Umbral del reposo (decidido: se queda el máximo, con un aviso)
Se probaron tres reglas sobre los seis JSON con flujo (17:47, 18:38, 18:55, 19:14, 19:57 y el protocolo de las 13:38):

| Regla | Contracciones (controles) | Falsas alarmas (controles) | Reposos y parpadeo espontáneo |
|---|---|---|---|
| **Máximo del reposo** (la aprobada) | 25/29 · 26/29 | **0/26 · 0/26** | 0 eventos, salvo en el protocolo de las 13:38 |
| Máximo tras mediana móvil de 200 ms | 27/29 · 27/29 | 2/26 · 1/26 | eventos en tres sesiones |
| Máximo tras mediana móvil de 300–400 ms | 27/29 · 27/29 | 2/26 · 2/26 | más eventos |
| «Sostenida»: lo mínimo para que el reposo no dé un evento de 0,5 s | 27/29 · 27/29 | 4/26 · 6/26 | más eventos |

- Las reglas que quitan los picos bajan el umbral **en todas las sesiones**, no solo en la de la sacudida, y traen falsas alarmas.
- **Se queda el máximo del reposo**, y la calibración da un **aviso** (`warning`) cuando el máximo supera 6 veces el p95 del reposo. En los JSON, la razón es de 1,4 a 2,5 en los reposos normales y de 14 a 23 en el de la sacudida.
- El aviso sale en la revisión y en la franja de calidad: «Umbral alto en el ojo…: lo ha fijado una sacudida suelta del párpado durante el reposo. Vale, pero detectará menos contracciones finas; si quieres más sensibilidad, repite el reposo».

**Umbral con una sacudida suelta: revisado el 2026-11-14 y descartado.** Se probó apartar la sacudida **solo cuando salta el aviso** (máximo > 6 × p95): quitar [pico − 0,5 s, pico + 1 s] y volver a tomar el máximo, hasta dos veces. Con `scripts/dev/replay-events.mjs` sobre los seis JSON:
- Las cinco sesiones sin aviso quedan **idénticas** (no se tocan).
- En la de la sacudida (protocolo de las 13:38) el umbral baja de 0,063 a **0,0011 DI** (casi el suelo): lo que queda del reposo es muy quieto, y casi todo lo que estaba por encima del p95 iba pegado a la sacudida. Con ese umbral aparecen contracciones en fases sin gesto: 2+1 → 9+7 en el parpadeo espontáneo y 1+0 → 2+1 en el propio reposo.
- **Se queda el máximo con el aviso.** Repetir el reposo sigue siendo la forma de recuperar sensibilidad. El análisis de vídeo del 2026-11-14 (1 GPU) dio un caso así en el ojo derecho (máximo/p95 = 6,3), con su aviso.

### 2–5. Métricas por fase y lado (`src/protocol/summary.js`, `src/protocol/spectrum.js`)
`summarizeProtocol(pasos)` da, para cada fase y lado:
- sus métricas;
- su asimetría, solo en las magnitudes positivas;
- su calidad: cara detectada, cabeza en movimiento y ritmo del análisis. Por debajo de 24/s queda una nota; por debajo de 20/s, la fase es poco fiable.

`node scripts/dev/summary.mjs informe.json` lo imprime.

| Fase | Métricas |
|---|---|
| Reposo | EAR y apertura de referencia, ruido, umbral, pico espectral. Sin eventos: es la calibración. |
| Parpadeo espontáneo | Parpadeos por minuto, duración, completitud y completitud respecto al **cierre máximo** del ojo; % de incompletos (< 80 % de ese cierre); contracciones; pico espectral. |
| Cierre suave y forzado | Cierre (1 − EAR mínimo / reposo) y reclutamiento de la ceja y el canto (pico de energía en veces su p99 del reposo). |
| Cejas | Cuánto se **abre** el ojo (mediana del EAR sin parpadeos), desplazamiento de la ceja hacia arriba (flujo integrado, DI) y pico de energía de la ceja. |
| Sonrisa | Sonrisa por lado (`mouthSmile`), cierre del ojo (mediana del EAR sin parpadeos) y **co-activación**: Pearson entre la sonrisa y el cierre del ojo del mismo lado, en una rejilla de 10 Hz, con el mejor desfase en ±0,3 s y sin los parpadeos. |

**Decisiones con el JSON del protocolo (13:38):**
- **Cierre máximo = el mayor del suave y del forzado.** Al apretar, la malla se deforma y el EAR baja menos: 0,89 en el forzado frente a 0,93–0,96 en el suave.
- **Cejas y sonrisa: mediana del EAR sin parpadeos, no el mínimo.** Con el mínimo, un parpadeo dentro de la ventana daba un «cierre» del 60 % en las cejas.
- **Co-activación sin parpadeos:** con ellos, r valía 0,63 y 0,47; sin ellos, 0,93 y 0,83.
- **Pico espectral:** método de Welch, a 20 Hz, sobre la velocidad vertical del párpado superior, con ventanas de 4 s y la banda de 0,5 a 8 Hz. Los pares congelados valen 0. Marca «rítmica» con prominencia ≥ 10 dB y el pico en la mitad de las ventanas, como mínimo. En el reposo y el parpadeo del protocolo, la prominencia es de 1–2 dB: sin actividad rítmica. Una oscilación sintética de 3 Hz sí sale. **Umbrales provisionales:** no hay pacientes con mioquimias.
- **Eventos de ceja y canto:** no se resumen; salen decenas por paso con los parpadeos y los gestos. En su lugar, el reclutamiento (energía) de los cierres y de las cejas.

**Resultado con el protocolo de las 13:38** (sujeto sano, gestos simétricos):

| Métrica | I | D | Asimetría |
|---|---|---|---|
| Parpadeos por minuto | 19 | 20 | −0,03 |
| Parpadeo / cierre máximo | 0,61 | 0,63 | −0,02 |
| Cierre suave | 0,93 | 0,96 | −0,02 |
| Cierre forzado | 0,89 | 0,90 | −0,01 |
| Apertura del ojo con las cejas | 0,20 | 0,19 | 0,01 |
| Sonrisa (boca) | 0,97 | 0,97 | −0,01 |
| Cierre del ojo con la sonrisa | 0,18 | 0,22 | −0,10 |
| Co-activación | 0,93 | 0,83 | — |

**Límite:** el % de parpadeos incompletos sale alto (70–84 %). A unos 27 análisis/s, el mínimo de un parpadeo de unos 180 ms cae a menudo entre dos frames, así que la completitud sale por debajo de la real. Esta métrica es orientativa: sirve para comparar lados y sesiones, y el vídeo grabado (fase 6) la mejorará.

### 6. Pantalla del resumen (hecha; pendiente de la prueba en el móvil)
- `src/ui/summary.js`, dentro de la tarjeta «Protocolo clínico», al terminar (o detener) el protocolo: una tarjeta por fase, con I, D y asimetría, y a 380 px sin desbordar.
- **Las asimetrías de 0,20 o más se destacan.** Es orientativo: no hay datos de referencia, y el resumen no clasifica nada.
- **Sin asimetría en los recuentos de contracciones:** con 1 o 2 eventos, 2 frente a 1 daba +0,33 sin significar nada.
- **El reposo no lista eventos:** es la calibración.
- El mismo resumen va en el JSON (`summary`).
- **Comprobado en la nube:** con la cámara simulada, el protocolo termina solo y saca las seis tarjetas y la lista de contracciones. Sin errores y sin desbordar a 380 px.

### Segunda prueba del protocolo (2026-11-08 17:24, commit a15d6dc)
- **Completo a la primera:** reposo válido al primer intento y sin intentos rechazados. Análisis de 25,5 a 28,3/s y sin rebaja del flujo.
- **El reposo, justo:** 16,6 s de tiempo útil de 30. La cabeza se movió un 13 % del tiempo (6,7 s apartados) y los parpadeos apartaron 5 s. Por eso se baja el mínimo a un tercio.
- **Umbral de nuevo alto** (0,061 y 0,059 DI) sin aviso: no es una sacudida suelta, el flujo del reposo es más ruidoso (la cabeza se movía más).
- **Parpadeo:** 13–14 por minuto; el cierre de los parpadeos es de solo un 40 % del cierre máximo (92 % incompletos). Menos que a las 13:38 (61 %): parpadeos más suaves o más breves, con el límite de siempre de ~27 fps.
- **Sonrisa:** el blendshape de sonrisa **satura** a 0,97–0,98 en los dos lados, y el cierre del ojo con la sonrisa es de 31 % y 29 %. Con una sonrisa amplia no se distingue qué lado sonríe más. Sin datos de que se hiciera asimétrica.

## Conclusión de la fase 5 (paso 5d)

**Qué hay:** el protocolo clínico guiado de `CLAUDE.md`. Son seis fases con voz y pitidos, un reposo que se repite solo si no vale (y dice por qué), la calibración de los umbrales sobre el reposo del propio paciente, los eventos en directo y un resumen por fase y lado con su asimetría. El resumen se ve en pantalla y viaja en el JSON.

**Qué se ha comprobado y con qué datos** (todo con un solo sujeto sano, el autor; la cámara trasera de su móvil):
- **Contracciones mínimas** (tres pruebas con controles): 25/29 y 26/29 detectadas por ojo, con **0/26 falsas alarmas**. En la fase 4, el EAR sacaba 6/13 y 10/13.
- **Reposos, parpadeo espontáneo, cabeceo y giro:** sin eventos que cuenten.
- **Dos protocolos completos en el móvil** (13:38 y 17:24): sin errores, con 25–28 análisis/s y sin rebaja del flujo, con el móvil frío. Los gestos simétricos dan asimetrías cercanas a 0.
- **Criterios de aceptación 3 y 4** (de la fase 4) siguen cumpliéndose con la medida que genera los eventos.

**Parámetros provisionales** (se fijaron con esos datos; cámbialos solo con más pruebas):

| Parámetro | Valor | Dónde |
|---|---|---|
| Umbral de los eventos | máximo de la subida en el reposo válido; suelo 0,001 DI | `events.js` |
| Duración mínima de una contracción | 0,5 s | `events.js` |
| Aviso de umbral alto | máximo > 6 × el p95 del reposo | `events.js` |
| Cabeza quieta | 3 × la mediana del reposo, entre 0,1 y 0,3 DI/s | `events.js` |
| Congelar el cierre por flujo | EAR < 50 % de su reposo, con 150 ms de margen | `processor.js` |
| Reposo válido | cara ≥ 90 %; tiempo útil ≥ ⅓ del reposo; 3 s tranquilos seguidos | `steps.js`, `events.js` |
| Parpadeo incompleto | < 80 % del cierre máximo del ojo | `summary.js` |
| Asimetría destacada | ≥ 0,20 | `ui/summary.js` |
| Actividad rítmica | prominencia ≥ 10 dB, pico en la mitad de las ventanas | `spectrum.js` |
| Fase poco fiable | análisis < 20/s, cara < 90 % o cabeza en movimiento > 20 % del tiempo | `summary.js` |

**Limitaciones:**
- Un solo sujeto, sin pacientes ni patrón de referencia (EMG): ninguna cifra es todavía un valor clínico de referencia.
- La actividad rítmica (mioquimias) solo se ha validado con señales sintéticas.
- A ~27 fps, el cierre de un parpadeo breve se subestima: el % de incompletos es orientativo.
- Con el móvil en la mano o con la cabeza moviéndose, el umbral sube y se pierde sensibilidad.
- Los eventos de ceja y canto son experimentales y no se resumen.

**Pendiente (no bloquea cerrar la fase):**
- **Sonrisa asimétrica (probada, 2026-11-08 17:44, commit bf010c5, más fuerte a la derecha):**
  - **Cierre del ojo con la sonrisa:** I 19 % y D 29 %, asimetría −0,21, destacada en el resumen y en la dirección correcta. Es la medida que detecta la asimetría.
  - **Sonrisa de la boca (`mouthSmile`):** I 0,948 y D 0,972, asimetría −0,013. La derecha sale más alta en las tres repeticiones, pero por solo 0,02–0,03: el indicador está casi saturado y **da la dirección, no la magnitud**.
  - **Co-activación:** I 0,81 y D 0,75. No distingue.
  - **Decidido (2026-11-08): después de la fase 7.** Medir la posición de las comisuras de la boca (landmarks 61 y 291, respecto al reposo y normalizada a la distancia intercantal) para tener una magnitud de la sonrisa sin saturar.
- **Cámara frontal** (criterio de aceptación 2): el guiño de un solo ojo en el lado correcto está probado con la trasera, no con la frontal.
- **Calor:** probar un protocolo con el móvil caliente (tras varias pruebas seguidas).

**Siguiente:** fase 6 (vídeo grabado), con Opus para el plan y la implementación.

## Pruebas
- **Tests unitarios:**
  - que la subida causal equivale al estadístico por ventanas;
  - el umbral del reposo y la validez del reposo;
  - la puerta de la cabeza (incluido el descarte retroactivo de 0,5 s);
  - la fusión de contracción y parpadeo;
  - FFT/Welch con senos conocidos;
  - la co-activación con señales sintéticas y desfase;
  - la asimetría.
- **Datos reales:** repetir el detector sobre los JSON de la fase 4 (paso 5a).
- **Vídeos sintéticos** (`make-face-videos.py`):
  - un párpado oscilando a 3 Hz (pico espectral en su lado);
  - un cabeceo (sin eventos);
  - si el modelo responde, una comisura de la boca desplazada (sonrisa de un lado).
- **De punta a punta en la nube**, con la CSP real (`docs/desarrollo.md`).

## Riesgos
- **Pocos datos:** los umbrales salen de un solo sujeto. Quedan como provisionales y documentados.
- **Calor en sesiones de 4–5 min:** se registra por fase. Si se repite el problema, se puede bajar el flujo antes de la fase de sonrisa.
- **Contracciones durante cierres completos:** en el cierre suave y el forzado, el flujo pierde el seguimiento. Ahí manda el EAR y no se abren eventos `contraction` mientras el EAR marque un cierre.
- **El blendshape de sonrisa con la cara girada o con poca luz:** se marca como poco fiable si la cara se pierde o la cabeza se mueve.

## Decisiones del autor (tomadas)
1. **Umbral de los eventos:** el máximo del reposo.
2. **Duraciones por defecto:** las de la tabla de fases.
3. **Tarjeta «Protocolo» aparte** del asistente de pruebas.
4. La voz habla al paciente de **tú**.

## Modelo recomendado
- **Plan:** Opus, esfuerzo alto (esta sesión).
- **5a** (la medida de los eventos y su calibración, que es procesado de señal) y la parte de señal del 5c (FFT y co-activación): Opus, esfuerzo medio.
- **5b, la interfaz del resumen y el 5d:** Sonnet, esfuerzo medio. Para README y CHANGELOG basta Haiku.
