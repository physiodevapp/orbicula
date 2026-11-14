# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar]

### Añadido (sonrisa con las comisuras de la boca)
- **La sonrisa se mide con las comisuras de la boca** (landmarks 61/291, extremos de FACEMESH_LIPS), en un sistema 3D de la propia cara y en distancias intercantales: no cambia con la distancia, la inclinación ni, en primera aproximación, el giro de la cabeza. En la fase de sonrisa, por lado: **desplazamiento** de la comisura desde su reposo (`commissure`), **subida** (`commissureLift`) y **co-activación** con el cierre del ojo (`coactivationCorner`), con su asimetría. El reposo es el de la propia fase (fuera de las repeticiones) o, si no basta, el del paso de reposo.
- El blendshape `mouthSmile` casi satura con una sonrisa amplia y el modelo tiende a darlo simétrico; se mantiene en el JSON (`smile`, `coactivation`) por compatibilidad y en el resumen como «Sonrisa (modelo)».
- Las comisuras se dibujan como un punto del color de cada lado en la vista en directo.
- Series `cornerOut` y `cornerUp` en `timeseries` y cuatro columnas al final del CSV de la cara. Cambios compatibles: `schemaVersion` sigue en `"1"`.
- En un vídeo real (en la nube), el ruido de la comisura en reposo es de ~0,008 DI (≈ 0,3 mm), muy por debajo de una sonrisa.

### Añadido (cámara y análisis en directo)
- **La frontal se preselecciona si el navegador solo da esa cámara:** si se pide la trasera y da la frontal (un ordenador), la próxima vez la tarjeta de inicio ya marca «Frontal». Se olvida en cuanto da la trasera. Una elección del clínico no se recuerda: en el móvil, la trasera sigue siendo la de por defecto.
- **«Análisis en directo» (GPU / CPU)** en «Detalle del análisis», para medir si el directo va más rápido con la CPU, como el vídeo grabado. Se recuerda; cambiarlo recarga el modelo y empieza las medidas de cero. No se puede cambiar con una prueba en marcha. Por defecto, la GPU (como hasta ahora) hasta medirlo en el móvil.
- `scripts/dev/check-camera-prefs.cjs` comprueba las dos cosas.

### Revisado (umbral del reposo)
- Se probó apartar la sacudida suelta del reposo solo cuando salta su aviso. Deja igual las sesiones normales, pero en la de la sacudida el umbral cae a 0,0011 DI y aparecen contracciones falsas. **Se mantiene el máximo con el aviso** (`docs/plan-fase-5.md`).

### Añadido (análisis de la cara en paralelo para el vídeo grabado)
- **Varios análisis de la cara a la vez** al analizar un vídeo, en un «pool» que reparte los fotogramas y entrega los resultados en su orden (`src/landmarks/pool.js`, `src/landmarks/in-order.js`). Solo para el vídeo (modo IMAGE); el directo sigue con uno.
- **Variantes elegibles en la tarjeta del vídeo:** 1 CPU (**por defecto**), CPU + CPU, 1 GPU (como antes) y GPU + GPU. **Nunca se mezclan GPU y CPU:** no dan los mismos números para el mismo fotograma (el EAR difería de 2 a 5 veces el ruido del reposo). Si el segundo análisis no consigue el mismo acelerador, se usa uno y se dice.
- El informe del vídeo guarda los análisis usados, su acelerador, su tiempo y cuántos fotogramas hizo cada uno.
- **Medido en el móvil del autor** (vídeo de 68 s a 1080p, cámara trasera): 1 GPU 12,6–13,5 fotogramas/s, GPU + GPU 21,9, **1 CPU 27,4**, CPU + CPU 29,6. Por eso **el vídeo se analiza ahora con 1 CPU por defecto: unas dos veces más rápido** (68 s de vídeo en 75 s). GPU + GPU da resultados idénticos a 1 GPU, y CPU + CPU idénticos a 1 CPU. Entre CPU y GPU el EAR cambia unas centésimas y algún cierre que está justo en el umbral.
- Los contadores de diagnóstico del flujo se ponen a cero en cada análisis (acumulaban los de la cámara o de un análisis anterior).

### Corregido (análisis de vídeo)
- **El reloj de la sesión avanza con los resultados de la cara, no al enviar los fotogramas:** con varios en vuelo, las últimas muestras de un tramo caían en el siguiente.
- **La muestra de la frontera entre tramos ya no se pierde:** la sesión necesitaba tres pasos para cruzarla y se le daban dos. La variante de siempre pasa de 1439 a 1440 muestras de 1440.
- Los pares de flujo que esperan su pose al final del vídeo se registran antes de cerrar el último tramo.
- **Analizar otra vez el mismo vídeo sin volver a elegirlo fallaba en Android con «Decoder error»** (en la nube no). Ahora el archivo se vuelve a abrir (solo el índice) antes de cada análisis y de cada prueba de lectura, que es lo que hacía elegirlo de nuevo. Si aun así falla el decodificador, el mensaje dice que se vuelva a elegir el vídeo. Si Android ya no deja leer el archivo (el permiso de la galería caduca al salir de Chrome o pasado un rato), se avisa antes de empezar y se pide elegirlo otra vez.
- 12 tests nuevos.

### Añadido (aviso de versión nueva)
- **Aviso flotante «Hay una versión nueva»** con «Recargar» y «✕». Cada build publica `version.json` (`{ commit, branch }`, el mismo commit que el pie, servido sin caché); la app lo pide al abrir, al volver a ella (`visibilitychange`, `pageshow`) y cada 10 minutos mientras se ve. Resuelve el caso de una versión vieja que se queda abierta en las recientes de Android.
- **No interrumpe lo que está en marcha:** es `fixed` (no mueve la maquetación) y «Recargar» queda desactivado, con el motivo, mientras haya un protocolo, una prueba, un análisis de vídeo o un vídeo grabado sin analizar; se activa solo al acabar.
- **Se puede cerrar** y no vuelve hasta que se publique otra versión distinta. Un fallo (sin conexión, no es JSON, servidor de desarrollo) no avisa de nada.
- **Privacidad:** petición relativa al propio origen (`connect-src 'self'` y la barrera de `src/privacy/` la permiten); no sale ningún dato del paciente. Sin cambios en la CSP.
- **En modo alojado (`?host=physiq`) no se muestra:** allí decide el hub cuándo actualizar.
- `scripts/dev/check-version.cjs`: el aviso, el cierre, que no vuelve por lo mismo, que no deja recargar con algo en marcha, que no mueve la maquetación, el modo alojado y el fallo de red.

### Añadido (aviso de cara pequeña)
- **El aviso usa los píxeles del ojo, no una proporción del encuadre.** Con una webcam, con el ojo a ~50 px el reposo fallaba siempre («la cabeza se ha movido»); a ~70 px y con más luz calibró a la primera. El aviso anterior (cara < 30 % del lado corto) no saltó. Ahora avisa por debajo de **60 px** (provisional), con histéresis para que no parpadee, y dice cuánto mide el ojo.
- **También por voz:** «Cara pequeña. Acércate un poco», un tono grave y vibración, solo antes y durante el reposo (donde decide si la calibración vale), como mucho cada 15 s y **sin cortar la instrucción del paso**. Respeta las casillas de voz y de sonidos.
- **Si el reposo falla por movimiento y la cara es pequeña, lo dice** (en pantalla y por voz): «la cara es pequeña y eso se confunde con movimiento: acércate».
- **Cada sesión guarda el tamaño del ojo** (`eyePx` por muestra en el diagnóstico y `quality.<fase>.eyePx` en el JSON público, más la nota `small-face`), para ajustar el umbral con datos reales. Campos nuevos, sin cambiar `schemaVersion`.
- No se tocan los umbrales de movimiento de la cabeza.
- `scripts/dev/check-smallface.cjs`: con una cara pequeña y otra grande, el aviso en pantalla, la voz (simulada), que no habla sin protocolo, que no corta la instrucción y que no se repite a cada rato.
- 11 tests nuevos.

### Añadido (fase 7d: cierre de la integración)
- **`docs/integracion.md`:** la guía para quien programe el hub. Lista de comprobación, cómo cargar el iframe (`allow="camera; screen-wake-lock"`, bajo demanda, `?host=physiq`), los mensajes con sus campos, las reglas de orígenes y privacidad, un ejemplo de código del lado del hub, cómo probarlo, compatibilidad y limitaciones conocidas.
- **Selector Trasera / Frontal en la tarjeta «Cámara» de inicio** (antes solo aparecía tras activar la cámara). Comparte el estado con el de los controles, y elegir no enciende la cámara: se enciende con «Activar cámara». `scripts/dev/check-facing.cjs` lo comprueba.
- **Conclusión de la fase 7** en `docs/plan-fase-7.md`, con el estado de los criterios de aceptación.

### Añadido (fase 7c: API postMessage)
- **`orbicula:ready`** al cargar (con la versión de la app, la del esquema y los permisos que el hub ha concedido al iframe), **`orbicula:result`** al terminar el protocolo en directo y el análisis del protocolo grabado, y **`orbicula:config { theme, lang, protocol }`** de entrada. El resultado lleva `sessionId` fuera del JSON: el protocolo grabado manda un segundo resultado con el mismo, para que el hub reemplace el primero.
- **Orígenes:** solo el propio y `https://physiodevapp.github.io` (`src/integration/origins.js`), ampliable al construir con `VITE_ORBICULA_ORIGINS`, **nunca por la dirección**. Los mensajes salen solo al origen del padre, **nunca con `"*"`**, y los entrantes solo se aceptan si vienen del marco padre y de un origen permitido. Con un padre no permitido, orbicula no manda ni acepta nada.
- **Origen del padre:** `location.ancestorOrigins`; si no existe (Firefox, Safari), `document.referrer`; y si tampoco, el primer mensaje válido (lo que haya que enviar espera hasta entonces).
- **Configuración:** lo válido se aplica y lo malo se ignora con su motivo en la consola. Las duraciones del protocolo solo se cambian si no hay uno en marcha.
- **El hub oculta orbicula (`PHYSIQ_SAT_HIDDEN`):** se apaga la cámara y se detiene el protocolo en marcha, conservando lo hecho (como «Detener», con «Retomar sesión»). Un análisis de vídeo ya cargado sigue. **Cuando el hub la vuelve a mostrar (`PHYSIQ_SAT_VISIBLE`), la cámara se reabre sola** con la misma configuración, como al volver a la pestaña. Con la cámara apagada, los indicadores dicen «cámara apagada» y no se quedan congelados (los contornos de los ojos y las cifras de fps y análisis seguían pintados y parecía que seguía midiendo).
- **Botón «Enviar al hub»** en Resultados (solo dentro de un iframe), para reenviar con el código corregido. Un código que parece un nombre no viaja: se manda sin código.
- **Bloqueo de pantalla:** se comprueba el permiso antes de pedirlo. Dentro de un iframe sin `allow="screen-wake-lock"`, el navegador lo bloqueaba y dejaba un error en la consola.
- **`/hub-prueba/`:** página que hace de hub para probar la integración a mano (acepta `?orbicula=<dirección>`). Oculta y muestra el iframe como el hub de verdad: un iframe de otro origen que queda fuera de la pantalla se frena y no procesa el vídeo.
- `scripts/dev/check-hub.cjs`: un «hub» en otro origen frente a orbicula con y sin ese origen permitido; protocolo completo con resultado válido contra el esquema.
- 19 tests nuevos.

### Añadido (fase 7b: modo alojado)
- **`?host=physiq`:** orbicula oculta su cabecera y su pie y adopta los tokens del hub: su texto (`#e8edf2`, `#8aa4bc`) y su rojo de error (`#ef4444`). El fondo, las superficies, los bordes y las fuentes ya coincidían. El acento sigue siendo el de orbicula: cada satélite del hub tiene el suyo.
- **Tema oscuro forzado**, como hace `assessment` dentro del hub (el hub es solo oscuro). Un tema elegido después (`orbicula:config`, en 7c) se respeta.
- **`public/host.js`:** aplica el modo antes de pintar, para que no se vea un instante la cabecera ni el tema claro. Un test comprueba que decide igual que `src/integration/host.js`.
- La versión y el commit pasan también a «Detalle técnico de la captura», porque el pie se oculta.
- Sin guardado de sesiones en modo alojado (ya estaba).
- `scripts/dev/check-host.cjs`: autónomo frente a alojado, con el sistema en claro y en oscuro, a 380 px.
- Arreglo menor: separación sobre el campo «Código» en los resultados.
- 7 tests nuevos.

### Corregido (fase 7a: el código del participante)
- **Un código no válido no daba ningún aviso:** el mensaje se escribía debajo de los botones, fuera de la pantalla del móvil. Ahora el campo del código **avisa al escribir** (borde rojo y un texto justo debajo), y los mensajes de exportar se traen a la vista.
- **Campo «Código» en Resultados del protocolo:** antes solo se podía escribir antes de empezar y no se podía corregir al exportar. Arranca con el código escrito antes. También se usa para el protocolo grabado.
- **Cierre por flujo (`docs/schema.md`):** se documenta que es una integral con fuga (nivel absoluto sin significado) y se exporta `analysis.closureTauMs`; y que un desfase de co-activación de ±300 ms está en el borde de la ventana.

### Añadido (fase 7a bis: sesiones guardadas en el dispositivo)
- **Recuperar el trabajo tras recargar la página.** Al terminar un protocolo (en directo o grabado) o el análisis de un vídeo, las medidas se guardan en IndexedDB (`src/persistence/`), sin el vídeo ni imágenes ni el nombre del archivo.
- **Tarjeta «Sesiones guardadas en este dispositivo»:** abrir una sesión (resumen, JSON y CSV), borrarla o borrar todo. Se conservan 5 y caducan a los 30 días.
- **Un vídeo ya analizado se reconoce al volver a elegirlo** («Recuperar el análisis»), por su huella (tamaño, fotogramas y duración, sin el nombre). Mismo criterio que `dualkinema`.
- **La procedencia (`analysis`) del JSON de una sesión recuperada es la de cuando se analizó**, aunque la app se haya actualizado después.
- Modo alojado (`?host=physiq`): no se guarda nada.
- `scripts/dev/check-saved.cjs`: protocolo → recarga → abrir → mismo JSON; huella con otro nombre; borrado; modo alojado.
- 14 tests nuevos.

### Cambiado (fase 7a: revisión del esquema antes de fijar `"1"`)
- **Compatibilidad hacia delante:** el esquema admite campos nuevos; añadirlos no cambia `schemaVersion`.
- **Nombres de las métricas** definidos en el esquema, con un test que los compara con el código y con `docs/schema.md`.
- **Bloque `analysis`:** versiones de MediaPipe, del modelo y de OpenCV, configuración del flujo y parámetros del detector. Sin datos del dispositivo.
- **`timeseries.frozen`** (y columna `closure_frozen` en el CSV de la cara): dónde el cierre por flujo estaba congelado.
- **Códigos estables** (`reasonCode`, y `{ code, text }` en avisos y notas) para poder traducirlos en el hub.
- **`tPeak`** en las contracciones.
- **`participantCode`** solo con letras sin tilde, números, `-` y `_` (hasta 24). Si no cumple, no se descarga nada y se avisa.
- 7 tests nuevos.

### Añadido (fase 7a: resultados en JSON y CSV)
- **JSON público de resultados** (`schemaVersion: "1"`; `src/export/result.js`). Es el formato estable de orbicula, distinto del de diagnóstico:
  - **Contenido:** captura, fases con su inicio y fin, calibración, métricas por lado y fase con su asimetría, calidad de cada fase, eventos y las series de la cara.
  - **Formato:** tiempos en milisegundos, lados del paciente y sin ninguna identificación; solo el código opcional.
  - **Documentación:** `docs/schema.md`, con las unidades de cada métrica, y esquema formal en `docs/orbicula-result.schema.json` (JSON Schema 2020-12).
  - **Validación:** un test la hace con `ajv` (dependencia de desarrollo, versión fija).
- **CSV de las series temporales**, en dos archivos: cara (EAR, apertura, parpadeo, sonrisa y cierre) y flujo (cierre por flujo, congelado y cabeza).
- **Botones «Resultados (JSON)» y «CSV de las series»** en los tres resultados: el protocolo en directo, el protocolo grabado y el análisis de un vídeo. La tarjeta del vídeo tiene ahora el código opcional.
- `scripts/dev/check-export.cjs`: protocolo → JSON y CSV → validación contra el esquema.
- 14 tests nuevos.

### Añadido (fase 6d: aviso y velocidad)
- **Aviso en directo (criterio 1):** si el análisis de la cara va por debajo de 24 por segundo durante 5 s seguidos, la app lo dice con la velocidad actual y propone el vídeo grabado.
- **El análisis del vídeo va más rápido:** dos fotogramas en vuelo a la vez. En la nube, 1,28 veces más rápido con los mismos resultados.
- El JSON de un vídeo analizado trae el desglose del tiempo por fotograma (decodificar, preparar, esperar a los workers, análisis y flujo).
- La casilla «un fotograma de cada dos» del protocolo grabado es literal, va desmarcada y la tarjeta estima el tiempo antes de empezar.
- 1 test nuevo.

### Añadido (fase 6c: protocolo grabado y analizado después)
- **Casilla «Grabar el vídeo para analizarlo después, más sensible»** en el protocolo (desmarcada por defecto). El vídeo de la cámara se graba en la memoria del móvil mientras haces el protocolo (MP4 H.264, 4 Mb/s) y, al acabar, un botón lo analiza **fotograma a fotograma**, con las fases y las repeticiones exactas del protocolo que acabas de hacer.
  - **Privacidad:** el vídeo solo existe en la memoria. Nunca se guarda como archivo ni se exporta. Se borra al terminar el análisis, al descartarlo, al detener el protocolo o al empezar otra sesión. Tope de 300 MB.
  - Un fotograma de cada dos por defecto (tarda la mitad; casilla).
  - Progreso con el tiempo restante y botón de cancelar. Al acabar sale el resumen por fases (el mismo formato que en directo) y un JSON con las ventanas de cada fase y el procesado.
- Lectura del MP4 fragmentado que graba `MediaRecorder` (`openRecording`).
- `scripts/dev/check-protocol-video.cjs`.
- Si el análisis no llega a medir el flujo, da error en vez de entregar un resumen sin flujo.
- 7 tests nuevos.

### Añadido (fase 6b: análisis de un vídeo grabado)
- **«Analizar el vídeo»**, en la tarjeta «Vídeo grabado», analiza **todos** los fotogramas, de uno en uno: la cara en modo IMAGE (sin el suavizado del directo) y el flujo en todos los pares (sin límite de ritmo).
  - Los primeros segundos (20, 30 o 45; por defecto, 30) son el reposo de calibración.
  - Del resto salen los eventos, las curvas y el resumen. Tramo nuevo, «Resto del vídeo»: parpadeos, cierre, contracciones y actividad rítmica.
  - Progreso con el tiempo restante, cancelar, y opción de procesar como mucho 30 fotogramas/s.
- **Espejo:** la casilla «El vídeo está en espejo» corrige los lados, igual que en directo. Comprobado con un vídeo sintético: los parpadeos de cada ojo salen en su lado y se intercambian con la casilla.
- **La cámara se apaga** al empezar a analizar un vídeo.
- **JSON:** el mismo formato que el protocolo (`orbicula-test-session/3`, `plan: "video"`), con la ficha del vídeo y cómo se procesó.
- `scripts/dev/check-video-analysis.cjs`.
- 7 tests nuevos.

### Añadido (fase 6a: lectura de vídeo grabado)
- **Tarjeta «Vídeo grabado».** Se elige un MP4 de la app de cámara y se ve su ficha:
  - códec y resolución;
  - giro y tamaño ya girado;
  - duración y fps reales (y si son variables);
  - fotogramas clave;
  - si el navegador lo puede decodificar.

  «Probar la lectura» decodifica los primeros 15 s y mide cuántos fotogramas por segundo da el móvil con el giro aplicado. Muestra una miniatura del primer fotograma ya girado.
- **Lectura sin cargar el archivo en memoria:** solo el índice (`moov`) con `mp4box` 2.4.1, y cada fotograma comprimido desde su posición en el archivo. Se decodifica con WebCodecs, sin adelantar más de 3 fotogramas.
- JSON `orbicula-video-probe/1`: ficha y prueba de lectura, sin el nombre del archivo ni imágenes.
- **Lectura del archivo en bloques de 8 MB:** en el móvil, leer muestra a muestra dejaba la lectura en 7 fotogramas/s. La prueba da ahora el desglose por fotograma: leer, girar y decodificar.
- **Corregido: la lectura se quedaba colgada al final en el móvil.** El decodificador de hardware no termina el vaciado si no se le recogen los fotogramas.
- `scripts/dev/check-video.cjs` y tres MP4 diminutos en `tests/fixtures/`.
- 12 tests nuevos.

### Documentación (fase 5d)
- `README.md`: instrucciones de uso clínico del protocolo (preparación, fases, cómo leer el resumen y límites conocidos).
- `docs/plan-fase-5.md`: conclusión de la fase, tabla de parámetros provisionales y lo pendiente.

### Añadido (fase 5c)
- **Aviso de umbral alto:** si el máximo de la subida en el reposo supera 6 veces su p95, una sacudida suelta del párpado ha fijado el umbral. La calibración lo dice (`warning`) y propone repetir el reposo si se quiere más sensibilidad.
  - El umbral sigue siendo el máximo del reposo.
  - Las reglas que ignoran los picos se probaron con los seis JSON y traían falsas alarmas en los controles (`docs/plan-fase-5.md`).
- **Métricas por fase y lado, con su asimetría** (`src/protocol/summary.js`):
  - **Parpadeo espontáneo:** frecuencia, duración, completitud y completitud respecto al cierre máximo del propio ojo.
  - **Cierres:** cierre de cada ojo y reclutamiento de la ceja y el canto.
  - **Cejas:** apertura del ojo y desplazamiento de la ceja.
  - **Sonrisa:** sonrisa por lado, cierre del ojo y co-activación ojo–boca.
  - **Calidad de cada fase.**
- **Pico espectral** (`src/protocol/spectrum.js`, método de Welch) para la actividad rítmica de los párpados (mioquimias). Los umbrales son provisionales.
- **Pantalla del resumen** al acabar el protocolo (`src/ui/summary.js`):
  - una tarjeta por fase con izquierda, derecha y asimetría, preparada para 380 px;
  - los avisos de la calibración y las fases marcadas como «poco fiable», con el motivo;
  - la lista de contracciones finas, con su fase, lado, duración y pico;
  - el aviso de que no es una herramienta de diagnóstico.

  Las asimetrías de 0,20 o más se destacan, de forma orientativa. Los recuentos de contracciones no llevan asimetría.
- El JSON del protocolo lleva el resumen (`summary`) además de las series.
- **El reposo del protocolo exige un tercio de tiempo útil (10 s de 30) en vez de la mitad.** El reposo de las 17:24 dio 16,6 s: justo por encima de los 15 s anteriores. Los tramos tranquilos mínimos siguen siendo 3 s seguidos, que es lo que fija el umbral.
- **Cuando el reposo no vale, dice por qué, con números.**
  - Motivos: cara perdida, cabeza movida, demasiados parpadeos o sin tramos tranquilos seguidos. Se ve en la revisión y en el JSON (`calibration.reason`, `reasonCode`, `diagnosis`).
  - La voz da el motivo en lugar de un «no ha valido» genérico.
  - Los intentos no válidos se guardan en el JSON (`rejections`), también si detienes el protocolo sin haber pasado del reposo.
- `scripts/dev/summary.mjs`: imprime el resumen de un JSON del protocolo.
- 14 tests nuevos.

### Añadido (fase 5b: protocolo guiado)
- **Tarjeta «Protocolo clínico»**, encima del asistente de pruebas (que se queda como herramienta de desarrollo). Seis fases con voz y pitidos, en modo seguido por defecto:
  1. **reposo (calibración)**, 30 s;
  2. **parpadeo espontáneo**, 60 s;
  3. **cierre suave**;
  4. **cierre forzado**;
  5. **elevación de cejas**;
  6. **sonrisa amplia**.

  Cada gesto va con pitido agudo = ahora y grave = relaja. La voz habla de «tú». Son unos 4 minutos.
- **Configurable:** reposo (30/45/60 s), parpadeo (30/60/90 s) y repeticiones de cada gesto (3/4/5), más el código anónimo opcional. La configuración se guarda en el JSON (`settings`).
- **Si el reposo no vale** (cabeza movida, demasiados parpadeos o cara perdida), el protocolo no sigue. Suenan dos pitidos graves, la voz lo explica («Apoya la cabeza y quédate quieto. Repetimos.») y el reposo se repite solo a los 7 s. En la revisión, «Siguiente» está desactivado. Se exige como tiempo válido al menos la mitad del reposo.
- Los eventos y la calibración funcionan igual que en el asistente (misma `calibrate` y mismo `EventDetector`).
- El JSON (`orbicula-test-session/3`) lleva ahora la serie **`smile`** (blendshape de sonrisa, por lado) y `settings`. Es lo que necesitará la co-activación ojo–boca.
- `createAssistant` admite varias tarjetas (`prefix`, `rootId`, `busyKey`, `plan`); no se pueden grabar dos a la vez. `scripts/dev/run-assistant.cjs --card protocol` recorre el protocolo.
- 12 tests nuevos.
- **Sin eventos mientras se calibra:** al empezar el reposo (también al repetirlo) se quitan los umbrales del intento anterior. Antes, el reposo repetido mostraba «contracciones» calculadas con los umbrales de un reposo que no había valido.

### Añadido (fase 5a: calibración y eventos)
- **Calibración sobre el reposo** (`src/protocol/events.js`, `calibrate`). Por lado salen:
  - el umbral de los eventos;
  - la apertura en reposo (EAR y apertura normalizada) y el ruido del EAR;
  - el umbral de «cabeza quieta»: 3 × la mediana de la velocidad del dorso nasal, entre 0,1 y 0,3 DI/s;
  - el p99 de la energía de la ceja y el canto.

  Dice si el reposo vale (tiempo sin parpadeos y con la cabeza quieta, cara detectada) y, si no, por qué.
- **Eventos en directo** (`EventDetector`):
  - **Medida:** la *subida* del cierre por flujo, es decir, cuánto se ha cerrado el ojo respecto a la mediana de los 0,6 s anteriores. Es la versión causal del estadístico del criterio 4 de la fase 4, con un test que lo comprueba.
  - **Umbral:** el máximo de esa subida en el reposo válido, con un suelo provisional.
  - **Puerta de la cabeza:** si el dorso nasal se mueve, se descartan los eventos de alrededor (±0,5 s). La velocidad se suaviza con la mediana de 3 pares, para que un pico suelto no descarte nada.
  - **Parpadeos:** una contracción que coincide con un parpadeo de verdad (≥ 50 %) del mismo ojo cuenta como parpadeo.
  - **Ceja y canto:** eventos experimentales por energía.
- **Asistente:** el reposo de las pruebas de la fase 4 calibra al terminar, y desde ahí los eventos salen en directo.
  - Aviso «Cabeza en movimiento».
  - Contracciones en la lista de eventos.
  - Curva nueva **«Eventos»**, con la subida, el umbral y las franjas de las contracciones; estas franjas salen también en «Cierre F».
  - La revisión de cada paso dice cuántas contracciones hubo por ojo.
- JSON del asistente **`orbicula-test-session/3`**: `calibration` (en el reposo) y `detections` (eventos de cada paso).
- `scripts/dev/replay-events.mjs`: repite la calibración y el detector sobre un JSON del asistente. Da aciertos y falsas alarmas en las pruebas con controles, y eventos en el cabeceo y el giro.
- **Selector de la curva:** en el móvil, en dos filas de tres.
- **El cierre por flujo se congela durante los parpadeos.** Mientras algún ojo está cerrado más de la mitad según el EAR, no se integra. Así un parpadeo no deja el cierre desplazado ni da falsos eventos en los 2 s siguientes. El JSON guarda en `flow.frozen` los pares congelados.
- **La subida del cierre necesita 2,1 s de historia:** sin ella no hay eventos al empezar.
- **Repetición sobre los cuatro JSON de la fase 4:** contracciones mínimas detectadas por ojo, 17/19 y 16/19, con 3/17 y 4/17 falsas alarmas (dos de ellas, movimientos reales). Ningún evento en el cabeceo y el giro. Detalle en `docs/plan-fase-5.md`.
- `replay-events.mjs` recalcula el cierre congelado en los JSON antiguos. Acepta `--fix paso:rep=act|control` y `--events`.
- **Duración mínima de 0,5 s:** una contracción más corta queda como «breve» (`status: "brief"`) y no cuenta. Con los cinco JSON (la fase 4 y la prueba de la 5a de las 19:57):
  - contracciones mínimas detectadas, 25/29 en el ojo izquierdo y 26/29 en el derecho;
  - **0/26 falsas alarmas** en los controles;
  - 0 eventos en el reposo, el parpadeo espontáneo, el cabeceo y el giro.
- Los eventos que empiezan en la cuenta atrás no se guardan en el paso.
- 18 tests nuevos.

### Añadido (fase 4b: medida del flujo por ROI)
- **Flujo por ROI y por lado del paciente** (párpado superior e inferior, ceja y canto externo). El worker devuelve, por ROI, 14 sumas de su campo de flujo («momentos», `src/flow/metrics.js`); con ellas el hilo principal calcula el flujo medio y la energía residual frente a cualquier movimiento afín de la cabeza, sin volver a recorrer los píxeles.
- **Tres compensaciones de la cabeza a la vez** (`src/flow/processor.js`): ninguna, **dorso nasal** (restar su traslación) y **postura** (movimiento afín de puntos estables de la cara —dorso nasal, extremos del óvalo y frente—, interpolados entre los análisis que rodean a cada frame; cada par espera hasta 300 ms al análisis siguiente).
- Métricas normalizadas: velocidad en **distancias intercantales por segundo (DI/s)**, independiente de la distancia y de los fps; energía en su cuadrado; componentes con signo **hacia abajo** y **hacia la sien**, con los ejes sacados de la propia cara (valen igual con espejo; con test).
- **Posición del iris** (landmarks 468 y 473, asignados al ojo más cercano) normalizada a las comisuras, en las series del asistente, para estudiar los falsos cierres al mirar hacia abajo.
- Curva **«Flujo»** (escala logarítmica, DI/s) con selector de ROI y de compensación; casilla **«Campo de flujo»** que dibuja el flujo sobre el vídeo (ampliado ×6).
- **Asistente de la fase 4** (plan por defecto; el de la fase 3 sigue disponible): reposo, contracción mínima («Entrecierra los ojos lo mínimo, como si sonrieras con los ojos») ×5, contracción algo mayor ×3, cabeceo, giro, cejas ×3, guiños de cada ojo ×3 y parpadeo espontáneo. Las repeticiones van con **pitidos** (agudo = ahora, grave = suelta) y el aviso «¡Ahora!/Suelta» sobre el vídeo; sus marcas de tiempo se guardan. Enciende el flujo solo.
- JSON del asistente **`orbicula-test-session/2`**: plan, iris, series del flujo por ROI (energía con las tres compensaciones y componentes con referencia y postura), movimiento de la cabeza restado, marcas de las repeticiones y resumen del flujo por paso (p50, p95 y p99 de la energía).
- Vídeos sintéticos con la respuesta conocida (`scripts/dev/make-face-videos.py`): **cabeceo** de 6 px sin contracción y **párpado** que baja 1,5 px. Scripts `scripts/dev/check-flow.cjs` y `scripts/dev/run-assistant.cjs`; `?debug` expone las series para ellos.
- En los vídeos sintéticos (Chromium): el párpado de 1,5 px se ve en su lado y no en el otro, y el EAR no cambia; el cabeceo se anula con el dorso nasal (de 0,04–0,13 a 0,006–0,017 DI/s). La postura compensa peor y añade 0,01–0,03 DI/s de temblor de la malla con la cara quieta (en Chromium MediaPipe solo analiza ~9/s; se decidirá con los datos del móvil en el 4c).
- 22 tests nuevos.

- **Modo seguido** en el asistente (casilla): sin pantalla de revisión entre pasos; al terminar uno (dos pitidos) el siguiente empieza solo 2 s después. Pensado para hacerse la prueba uno mismo con la cámara trasera sin tocar el móvil. Un paso interrumpido sí se detiene en la revisión.
- **Voz** (casilla, activada por defecto): dice «Paso N: nombre» al empezar cada cuenta atrás y «Prueba terminada» al final. Solo con voces instaladas en el móvil (`localService`), para que ningún texto salga del dispositivo; si no hay ninguna en español, no se oye nada.

- **La voz explica cada paso** durante la cuenta atrás: en los pasos con repeticiones, que hay que esperar al pitido agudo y mantener el gesto hasta el grave; en el cabeceo y el giro, que se hace sin parar desde el pitido de inicio. Con voz, la cuenta atrás dura lo que tarda en leerse la explicación.
- `scripts/dev/analyze-flow.mjs`: análisis del JSON del asistente de la fase 4 (criterios 3 y 4, alineado con el gesto real).
- Primer análisis (4c) en `docs/plan-fase-4.md`: criterio 1 cumple; criterio 4 cumple en párpados y canto con el dorso nasal, no en la ceja; criterio 3 sin concluir (la contracción «mínima» también la veía el EAR). Compensación por defecto: dorso nasal.

- `analyze-flow.mjs`: detección calibrada frente al reposo (percentil de cada repetición entre ventanas de reposo sin parpadeos) para el EAR y la apertura por flujo integrada. Segundo análisis en `docs/plan-fase-4.md`: con contracciones más pequeñas, el flujo integrado detecta 3 de 5 que el EAR no ve.

- **Cierre por flujo** (curva «Cierre F» y serie `flow.closure` del JSON): desplazamiento acumulado del párpado superior hacia abajo menos el del inferior, compensado con el dorso nasal, en DI (+ = se cierra), con un integrador con fuga de 5 s para que no derive. Es la medida que detectó contracciones que el EAR no distinguía del reposo.
- **Prueba «contracción mínima con controles»** (nuevo plan del asistente, unos 3 min): reposo, 2 × 10 repeticiones en orden al azar (mitad contracciones mínimas con el pitido agudo, mitad controles con **dos pitidos cortos: no hacer nada**) y reposo final. Las marcas guardan la condición de cada repetición. `analyze-flow.mjs` da, para el EAR y el flujo, aciertos, falsas alarmas y AUC (criterio 3).

- Prueba con controles en el móvil: el cierre por flujo detectó 6/7 contracciones mínimas en cada ojo frente a 2/7 y 4/7 del EAR, con las mismas falsas alarmas (1/8). Criterio 3 cumplido de forma provisional (`docs/plan-fase-4.md`).

- **Compensación «dorso nasal + giro»** (cuarta variante, `hybrid`, serie `eH`/`dH`/`tH`): la traslación del dorso nasal más, para cada ROI, la diferencia de movimiento que produce el giro 3D de la cabeza entre esa ROI y el dorso nasal. El giro se estima por mínimos cuadrados con los puntos estables en 3D (la z del modelo); cada ROI tiene su punto 3D. Pensada para el canto externo y la ceja, que fallaban al girar la cabeza. En un giro sintético deja en el canto menos de 1/20 del error del dorso nasal solo; con la cabeza solo trasladándose añade algo de ruido (la z de los landmarks también tiembla).
- **Ajuste automático del ritmo del flujo** (`src/flow/governor.js`): si el análisis de la cara pasa 3 s por debajo de 24/s, el flujo baja a 20 pares/s; vuelve a su ritmo cuando el análisis pasa de 27/s durante 10 s. Se ve en «Verificación de lado» y queda en el JSON (`perf.flowRateCap`). No actúa durante la prueba de rendimiento.

- Análisis de la prueba completa con buena luz: la compensación «dorso nasal + giro» no mejora con datos reales (se quita de la curva); el criterio 4 se cumple con el cierre por flujo (lo que generará los eventos) en la prueba con un reposo válido; la referencia de reposo ahora excluye los tramos con la cabeza en movimiento.

- **Fase 4 cerrada** (`docs/plan-fase-4.md`): en dos pruebas con controles, el cierre por flujo detectó 12/13 contracciones mínimas en cada ojo frente a 6/13 y 10/13 del EAR, con las mismas falsas alarmas, y con mucho más margen de separación (×8 frente a ×1–3 en la prueba con la cabeza apoyada).

### Corregido (fase 4b)
- `analyze-flow.mjs`: en la detección calibrada solo se apartan los parpadeos de verdad (cierre ≥ 50 %); antes apartaba también los eventos poco profundos que provoca la propia contracción mínima.
- La asimetría de las curvas fallaba al elegir una métrica que no está en la serie de la cara.

### Añadido (fase 4a bis: aligerar el flujo)
- El worker de flujo puede leer **solo el plano de brillo (Y)** de la franja directamente del frame de la cámara (`VideoFrame`), sin pasar por RGBA. Si el móvil entrega el frame en un formato que no se puede leer así, recorta con `createImageBitmap` dentro del worker y lo anota en el JSON (`sources`).
- **Farnebäck ligero** (2 niveles, ventana 9, 2 iteraciones) y **límite de pares por segundo** (30), para dejar procesador al análisis de la cara.
- La prueba de rendimiento compara ahora: sin flujo, Farnebäck 320 px como en la 4a, con plano Y, ligero con plano Y, y ligero con plano Y a 30/s. Añade la columna «ms copia».
- Resultados del 4a en el móvil del autor en `docs/plan-fase-4.md`: 4K descartado para el flujo en directo; punto de trabajo trasera «fps» con Farnebäck a 320 px; a 60 fps el flujo bajaba el análisis de la cara de 28 a 22 por segundo.

- **Punto de trabajo del flujo** (tras la prueba en el móvil): trasera «fps», Farnebäck a 320 px leyendo el plano Y, con un máximo de 30 pares por segundo (`farneback-320-vf-30`, por defecto). El plano Y bajó la copia de 15 a 1,2 ms; el Farnebäck ligero apenas ahorraba y se descarta.

### Corregido (fase 4a bis)
- El límite de pares por segundo dejaba pasar solo 20 con la cámara a 40 fps (saltaba un frame de cada dos): ahora reparte el ritmo por crédito y da 30.
- Con la cara en el borde del frame, la franja del flujo se recolocaba en cada análisis (y el flujo casi no se medía): ahora solo cuenta la parte de las ROI que cae dentro del frame.
- El origen de la franja va en coordenadas pares (necesario para leer frames YUV).

### Añadido (fase 4a: rendimiento del flujo óptico)
- **Worker de flujo óptico** (`src/flow/flow.worker.js`) con **OpenCV.js 5.0.0-release.1** (`@techstark/opencv-js`), separado del de MediaPipe para que trabajen en paralelo, con la barrera de privacidad importada lo primero. OpenCV.js (13 MB, WASM embebido) se sirve desde `opencv/<versión>/` con caché `immutable` y se carga solo al activar el flujo o al empezar la prueba de rendimiento.
- **Parche de OpenCV.js sin `eval`** (`scripts/opencv-patch.mjs`, aplicado al copiarlo): su capa embind genera funciones con `new Function`, que la CSP bloquea; se sustituyen por cierres equivalentes. Comprobado que da los mismos resultados que el original. La CSP no cambia (sin `'unsafe-eval'`).
- **Franja periocular** (`src/flow/strip.js`): rectángulo con los dos ojos, cejas, cantos y dorso nasal, con margen, recortado del frame **completo** con `createImageBitmap` en cada frame de la cámara (no solo en los que analiza MediaPipe), reducido al tamaño de trabajo y con la marca de tiempo de captura. Solo se recoloca cuando la cara se sale de ella o se aleja; el par de ese cambio no se mide.
- Farnebäck (flujo denso) y Lucas-Kanade piramidal sobre una rejilla, con el brillo de cada recorte normalizado (media y desviación). DIS no está disponible en OpenCV.js 5.0.0 (solo exporta sus constantes).
- **Prueba de rendimiento del flujo** (`orbicula-benchmark/2`): 10 pasadas (Farnebäck a 320 px, 640 px y sin reducir, Lucas-Kanade a 640 px, y sin flujo), con el análisis de la cara a la vez; mide ms de flujo, pares por segundo, copia, latencia y cuánto frena al análisis de la cara.
- Casilla «Calcular flujo óptico (en pruebas)» en «Verificación de lado», con selector de configuración, ms y pares por segundo, y la franja dibujada sobre el vídeo.
- 21 tests nuevos (franja, tamaño de trabajo, resumen del flujo, parche y prueba de rendimiento).

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
