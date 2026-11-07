# Prueba de rendimiento

Tarjeta «Prueba de rendimiento» (debajo del asistente de pruebas). Ejecuta sola 8 pasadas de 12 s que comparan el análisis de la cara **en un worker y en el hilo principal, con y sin blendshapes**, y exporta un JSON con los tiempos de cada análisis. Sirve para decidir cómo organizar el análisis sin pedir medidas sueltas.

## Cómo se usa
1. Activa la cámara y elige **antes** la cámara y la prioridad (cambiarlas cancela la prueba). Para comparar con otra sesión, usa la misma configuración y la misma luz.
2. Pulsa **Empezar**. Mantén la cara quieta y de frente durante los ~2 minutos y medio. El aviso sobre el vídeo muestra la pasada en curso y el tiempo restante.
3. Al terminar: tabla resumen, **Descargar JSON**, **Compartir** o **Copiar resumen** (sin las series).

`?escala=0.25` en la dirección acorta las pasadas (mínimo 2,5 s), para comprobar el flujo rápido.

## Diseño
- Cuatro combinaciones, cada una **dos veces**; la segunda ronda va en orden inverso (ABBA) para que el calentamiento del móvil o un cambio de luz no favorezcan siempre a la misma. Solo hay dos cambios de modo.
- Los primeros 3 s de cada pasada (arranque de la GPU) no cuentan en los resúmenes, pero las series los incluyen.
- Se mide con el mismo código y la misma cámara que la app, en el móvil: el análisis, la cámara y el repintado de la pantalla.

## Qué mide cada pasada
- **inferMs**: lo que tarda MediaPipe en cada frame (la media es la que se compara).
- **analysisFps / cameraFps / analysedFraction**: análisis por segundo, fps de la cámara (ritmo de los callbacks de vídeo) y qué fracción de los frames se llega a analizar. `presentedFps` es el contador `presentedFrames` del navegador, solo para diagnóstico: en el móvil del autor se queda corto.
- **intervalMs**: tiempo entre resultados (su dispersión).
- **latencyMs**: de la captura del frame a tener el resultado.
- **bitmapMs / roundTripMs** (solo worker): lo que cuesta copiar el frame en el hilo principal y la ida y vuelta completa.
- **ui**: fluidez del hilo principal. `frameMs` es el intervalo entre repintados (16,7 ms = 60 Hz), `over50ms` / `over100ms` cuentan los repintados lentos («tirones») y `longTasks` las tareas largas del navegador. Es lo que el worker debería mejorar.
- **faceFraction**: fracción de análisis con cara detectada (con menos de ~0,9 la comparación no es limpia).

## Estructura del JSON (`orbicula-benchmark/1`)
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
