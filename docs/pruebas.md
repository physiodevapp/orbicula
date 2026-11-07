# Asistente de pruebas

Guía paso a paso dentro de la app (tarjeta «Asistente de pruebas», debajo del vídeo) que registra las medidas de cada paso y las guarda en un archivo JSON para compartir con quien desarrolla la app. Sirve para probar cada fase sin ir y venir de capturas, y con datos reales del móvil para ajustar los umbrales.

**No es el JSON de exportación de resultados** (ese es la interfaz pública y se define en la fase 7, con `docs/schema.md`). Este es un archivo de diagnóstico con su propio esquema, `orbicula-test-session/1`.

## Cómo se usa
1. Activa la cámara y encuadra la cara. Elige cámara y prioridad **antes** de empezar: cambiarlas interrumpe el paso.
2. Pulsa **Empezar** (el código es opcional). Cada paso: cuenta atrás de 3 s, instrucción sobre el vídeo con tiempo restante y pitidos/vibración (se pueden desactivar), y una pantalla de revisión.
3. En la revisión se ve lo que ha detectado la app. Puedes anotar cuántos parpadeos has contado tú (opcional) y observaciones. **Repetir** descarta el paso y lo vuelve a grabar; **Siguiente** lo guarda.
4. Al final: **Descargar JSON** (carpeta de descargas del móvil), **Compartir** (si el navegador lo permite) o **Copiar resumen** (sin las series, para pegarlo en el chat).

`?escala=0.2` en la dirección acorta las duraciones de los pasos (mínimo 1,5 s), para comprobar el flujo rápido.

## Privacidad
Solo medidas numéricas y la configuración: ninguna imagen, ningún nombre. Incluye el modelo de navegador (`userAgent`) y datos del dispositivo (núcleos, memoria, pantalla) para interpretar los tiempos. Nada sale del móvil salvo que el usuario comparta el archivo.

## Estructura
```jsonc
{
  "app": "orbicula", "kind": "test-session", "schema": "orbicula-test-session/1",
  "createdAt": "ISO-8601", "startedAt": "ISO-8601", "participantCode": null,
  "build":    { "version": "", "branch": "", "commit": "" },
  "device":   { "userAgent": "", "hardwareConcurrency": 0, "deviceMemory": 0, "language": "", "screen": {} },
  "capture":  { "facing": "rear|front", "priority": "resolution|fps", "requested": {}, "settings": {}, "frame": {}, "strictFps": false, "previewMirrored": false },
  "analysis": { "mode": "worker|main", "delegate": "GPU|CPU", "imageSize": {}, "blendshapes": true, "swapNames": false },
  "detector": { /* umbrales del detector de parpadeos usados */ },
  "steps": [{
    "id": "wink-left", "title": "", "instruction": "",
    "status": "completed|skipped|interrupted", "interruptReason": null,
    "startedAt": "ISO-8601", "plannedMs": 0, "durationMs": 0,
    "expect": { "left": 5, "right": 0 },          // lo que se debería detectar
    "user": { "counted": null, "notes": "" },     // lo que anota el usuario
    "perf": { "cameraFps": 0, "analysisFps": 0, "analysisMs": 0 },
    "summary": { "samples": 0, "faceFraction": 0, "left": { /* parpadeos, cierres, duración, completitud, EAR… */ }, "right": {} },
    "events": { "left": [ { "kind": "blink|closure", "t": 0, "duration": 0, "min": 0, "baseline": 0, "completeness": 0 } ], "right": [] },
    "series": { "t": [], "left": { "ear": [], "aperture": [], "blink": [] }, "right": { } }   // t en ms desde el inicio del paso; null = sin cara
  }]
}
```
Los lados son siempre los del paciente. Las series completas permiten reproducir el detector con los datos reales y ajustar los umbrales sin repetir la prueba.
