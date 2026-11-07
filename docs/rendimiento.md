# Prueba de rendimiento

Tarjeta «Prueba de rendimiento» (debajo del asistente de pruebas).

**Desde la fase 4a (esquema `orbicula-benchmark/2`) mide el flujo óptico.** Con el análisis de la cara en su punto de trabajo (worker, con blendshapes), ejecuta sola 10 pasadas de 12 s (5 configuraciones × 2) y exporta un JSON con los tiempos. Una de las configuraciones es sin flujo, para ver cuánto frena el flujo al análisis de la cara.

- **4a**: Farnebäck con la franja de los ojos reducida a 320 px de ancho, a 640 px y sin reducir (hasta 1280), y Lucas-Kanade sobre una rejilla a 640 px. Resultados en `docs/plan-fase-4.md`.
- **4a bis** (la actual): Farnebäck a 320 px como en la 4a (`farneback-320`), leyendo solo el plano Y del frame (`farneback-320-vf`), Farnebäck ligero con plano Y (`lite-320-vf`) y lo mismo limitado a 30 pares/s (`lite-320-vf-30`). Hacerla con la trasera en «fps».

La versión 1 (fase 3) comparaba el análisis en worker y en el hilo principal, con y sin blendshapes; sus conclusiones están en `docs/plan-fase-4.md` y la descripción de su JSON, al final de este documento.

## Cómo se usa
1. Activa la cámara y elige **antes** la cámara y la prioridad (cambiarlas cancela la prueba). Para comparar con otra sesión, usa la misma configuración y la misma luz.
2. Pulsa **Empezar**. Hay una cuenta atrás de **10 s para colocarte** (no cuenta en la medida; los últimos 3 s suenan). Después, mantén la cara quieta y de frente durante los ~2 minutos y medio. El aviso sobre el vídeo muestra la pasada en curso y el tiempo restante.
   - **Con la cámara trasera** no ves la pantalla: apoya el móvil a unos 40 cm de tu cara, en un soporte o contra algo. Un pitido largo marca el inicio; si se pierde la cara suena un tono grave cada 3 s (corrige el encuadre de oído); tres pitidos ascendentes y una vibración larga avisan de que **ha terminado** y ya puedes coger el móvil.
   - La pantalla se mantiene encendida durante la prueba (si se apagara, la cámara se pararía). Los avisos se pueden desactivar con la casilla.
3. Al terminar: tabla resumen, **Descargar JSON**, **Compartir** o **Copiar resumen** (sin las series).

`?escala=0.25` en la dirección acorta las pasadas (mínimo 2,5 s), para comprobar el flujo rápido.

## Diseño
- Cinco configuraciones, cada una **dos veces**; la segunda ronda va en orden inverso (ABBA) para que el calentamiento del móvil o un cambio de luz no favorezcan siempre a la misma. La primera y la última pasada son sin flujo.
- Los primeros 3 s de cada pasada (arranque de la GPU) no cuentan en los resúmenes, pero las series los incluyen.
- Se mide con el mismo código y la misma cámara que la app, en el móvil: el análisis, la cámara y el repintado de la pantalla.

## Qué mide cada pasada: flujo (`summary.flow`)
- **flowFps**: pares de frames con flujo por segundo (el flujo se calcula en cada frame de la cámara, hasta 60/s, si el worker da abasto); **flowFraction**: qué fracción de los frames de la cámara.
- **flowMs**: lo que tarda el algoritmo (Farnebäck o Lucas-Kanade). **readMs**: pasar la franja de la GPU a la CPU dentro del worker. **prepMs**: escala de grises y normalización del brillo. **totalMs**: todo el trabajo del worker por frame. **cropMs**: recorte y reducción de la franja en el hilo principal.
- **latencyMs**: de la captura del frame a tener el flujo; **dtMs**: tiempo entre los dos frames de cada par.
- **size / strip**: tamaño de trabajo de la franja y su rectángulo en el frame completo.
- **counts**: frames mandados al worker, descartados porque estaba ocupado (`busy`), sin franja todavía (`noStrip`), saltados por el límite de pares/s (`capped`) y recolocaciones de la franja (`replaced`).
- **sources**: de dónde salió la imagen en grises en cada frame: `bitmap` (recorte RGBA en el hilo principal), `y-plane: <formato>` (plano Y del frame) o `worker-bitmap: <motivo>` (el frame no se podía leer como YUV).
- `summary.analysisFpsLoss`: análisis de la cara por segundo que se pierden con cada configuración respecto a la pasada sin flujo.

## Qué mide cada pasada: análisis de la cara
- **inferMs**: lo que tarda MediaPipe en cada frame (la media es la que se compara).
- **analysisFps / cameraFps / analysedFraction**: análisis por segundo, fps de la cámara y qué fracción de los frames se llega a analizar. `cameraFps` es el mayor de dos recuentos que se quedan cortos en situaciones distintas, ninguno se pasa: `callbackFps` (callbacks de vídeo, que se pierden si el hilo principal está ocupado) y `presentedFps` (contador `presentedFrames` del navegador, que con la frontal se quedó por debajo de los frames analizados).
- **intervalMs**: tiempo entre resultados (su dispersión).
- **latencyMs**: de la captura del frame a tener el resultado.
- **bitmapMs / roundTripMs** (solo worker): lo que cuesta copiar el frame en el hilo principal y la ida y vuelta completa.
- **ui**: fluidez del hilo principal. `frameMs` es el intervalo entre repintados (16,7 ms = 60 Hz), `over50ms` / `over100ms` cuentan los repintados lentos («tirones») y `longTasks` las tareas largas del navegador. Es lo que el worker debería mejorar.
- **faceFraction**: fracción de análisis con cara detectada (con menos de ~0,9 la comparación no es limpia).

## Estructura del JSON (`orbicula-benchmark/2`)
```jsonc
{
  "app": "orbicula", "kind": "benchmark", "schema": "orbicula-benchmark/2",
  "build": {}, "device": {}, "capture": {}, "analysis": {},
  "flow": { "library": "OpenCV.js", "version": "5.0.0-release.1", "loadMs": 0, "farneback": {}, "lucasKanade": {} },
  "plan": { "runMs": 12000, "warmupMs": 3000, "order": ["none", "farneback-320", "farneback-640", "farneback-full", "lk-640", "lk-640", "farneback-full", "farneback-640", "farneback-320", "none"] },
  "summary": {
    "groups": [ { "flow": "farneback-320", "method": "farneback", "maxWidth": 320, "runs": 2, "flowFps": 0, "flowMsMean": 0, "totalMsMean": 0, "size": { "width": 0, "height": 0 }, "analysisFps": 0, "cameraFps": 0 } ],
    "analysisFpsLoss": { "farneback-320": 0 }
  },
  "runs": [ { "index": 1, "round": 1, "flow": "none", "summary": { "flow": null /* o el bloque de flujo */ }, "series": { "tRel": [], "inferMs": [], "flowT": [], "flowMs": [], "workerMs": [] } } ]
}
```

## Estructura del JSON de la fase 3 (`orbicula-benchmark/1`)
```jsonc
{
  "app": "orbicula", "kind": "benchmark", "schema": "orbicula-benchmark/1",
  "createdAt": "ISO-8601", "startedAt": "ISO-8601", "participantCode": null,
  "build": {}, "device": {}, "capture": {}, "analysis": {},   // como en docs/pruebas.md
  "plan": { "runMs": 12000, "warmupMs": 3000, "order": ["worker+blend", "worker-blend", "main-blend", "main+blend", "main+blend", "main-blend", "worker-blend", "worker+blend"] },
  "summary": {
    "groups": [ { "mode": "worker", "blendshapes": true, "runs": 2, "inferMsMean": 0, "analysisFps": 0, "cameraFps": 0, "frameMsP99": 0, "over50ms": 0 } ],
    "effects": { "workerMinusMain_withBlendshapes": 0, "blendshapesOnMinusOff_worker": 0 }   // ms por análisis; positivo = la primera opción es más lenta
  },
  "runs": [ { "index": 1, "round": 1, "mode": "worker", "blendshapes": true, "startedAtMs": 0, "durationMs": 0,
              "summary": { /* los estadísticos de arriba */ }, "series": { "tRel": [], "inferMs": [] } } ]
}
```
