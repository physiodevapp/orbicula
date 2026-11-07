# Plan de la fase 5: protocolo guiado

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

## Estado del paso 5a (hecho; pendiente de los JSON y de la prueba en el móvil)
- Módulo puro `src/protocol/events.js`: `RiseTracker`, `calibrate` y `EventDetector`, con 16 tests.
- **Cambios respecto al plan:**
  - El umbral de «cabeza quieta» tiene también un techo provisional de 0,3 DI/s. Si la cabeza se mueve casi todo el reposo, la mediana ya es movimiento y el umbral relativo se inflaría.
  - La velocidad de la cabeza se suaviza con la mediana de 3 pares.
- **Cámara simulada** (vídeo `lid.y4m`, plan de la fase 4 con `?escala=0.6`): calibra, sin errores ni peticiones externas, y no da ningún evento.
  - El párpado sintético de 1,5 px da un cierre máximo de 0,0014 DI. Ese cierre queda por debajo del máximo del reposo, porque el vídeo en bucle también lo tiene en el reposo. No sirve para validar la sensibilidad.
  - Por eso el suelo del umbral se deja en 0,001 DI, que solo protege de umbrales ridículos.
- **Falta:**
  - Repetir el detector sobre los JSON reales de la fase 4 (`node scripts/dev/replay-events.mjs informe.json`). No están en el repo: el autor tiene que volver a pasarlos.
  - Comprobar que reproduce las cifras de la fase 4: 12/13 aciertos y 2/15 falsas alarmas por ojo en las pruebas con controles, y 0 % en el cabeceo y el giro.
  - Con esos datos, fijar el suelo.

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

## Decisiones que necesito del autor
1. **Umbral de los eventos:** el máximo del reposo (menos falsas alarmas; recomendado) o el percentil 95 (más sensible).
2. **Duraciones por defecto** de la tabla de fases.
3. **Tarjeta «Protocolo» aparte** del asistente de pruebas (recomendado) o sustituirlo.
4. Si la voz habla al paciente de **tú** (como ahora) o de **usted**.

## Modelo recomendado
- **Plan:** Opus, esfuerzo alto (esta sesión).
- **5a** (la medida de los eventos y su calibración, que es procesado de señal) y la parte de señal del 5c (FFT y co-activación): Opus, esfuerzo medio.
- **5b, la interfaz del resumen y el 5d:** Sonnet, esfuerzo medio. Para README y CHANGELOG basta Haiku.
