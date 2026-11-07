# Asistente de pruebas

Guía paso a paso dentro de la app (tarjeta «Asistente de pruebas», debajo del vídeo) que registra las medidas de cada paso y las guarda en un archivo JSON para compartir con quien desarrolla la app. Sirve para probar cada fase sin ir y venir de capturas, y con datos reales del móvil para ajustar los umbrales.

**No es el JSON de exportación de resultados** (ese es la interfaz pública y se define en la fase 7, con `docs/schema.md`). Este es un archivo de diagnóstico con su propio esquema, `orbicula-test-session/1`.

## Cómo se usa
1. Activa la cámara y encuadra la cara. Elige cámara y prioridad **antes** de empezar: cambiarlas interrumpe el paso.
2. Pulsa **Empezar** (el código es opcional). Cada paso: cuenta atrás de 3 s, instrucción sobre el vídeo con tiempo restante y pitidos/vibración (se pueden desactivar), y una pantalla de revisión.
3. En la revisión se ve lo que ha detectado la app. Puedes anotar cuántos parpadeos has contado tú (opcional) y observaciones. **Siguiente** guarda el paso.
4. Al final: **Descargar JSON** (carpeta de descargas del móvil), **Compartir** (si el navegador lo permite) o **Copiar resumen** (sin las series, para pegarlo en el chat).

## Si algo sale mal
No hace falta empezar de cero: solo se rehace lo que falló y lo ya guardado se conserva.
- **Repetir este paso** (durante el paso o en la revisión): descarta lo grabado y vuelve a la cuenta atrás del mismo paso.
- **← Paso anterior**: descarta el paso en curso y rehace el anterior (útil si te das cuenta después de pulsar «Siguiente»). Al terminar la sesión, **Rehacer el último paso** hace lo mismo con el último.
- **Detener**: guarda lo hecho y para. La tarjeta ofrece **Retomar sesión**, que continúa en el paso que se estaba haciendo, además de descargar lo hecho hasta ahora.
- **Saltar**: deja el paso sin grabar (queda como `skipped`).
- Si la cámara se reinicia (cambio de cámara o de prioridad, o salir de la pestaña), el paso en curso queda **interrumpido** y se ofrece repetirlo.
- Repetir no reinicia el reposo estimado del detector, así que los parpadeos de los primeros segundos se siguen detectando. En el JSON, `attempt` indica el número de intento de cada paso; solo se guarda el último.

`?escala=0.2` en la dirección acorta las duraciones de los pasos (mínimo 1,5 s), para comprobar el flujo rápido.

## Privacidad
`analysis.blockedHosts` lista los dominios a los que la librería de MediaPipe intentó llamar y la barrera de privacidad bloqueó (ver el README).

Solo medidas numéricas y la configuración: ninguna imagen, ningún nombre. Incluye el modelo de navegador (`userAgent`) y datos del dispositivo (núcleos, memoria, pantalla) para interpretar los tiempos. Nada sale del móvil salvo que el usuario comparta el archivo.

## Estructura
```jsonc
{
  "app": "orbicula", "kind": "test-session", "schema": "orbicula-test-session/1",
  "createdAt": "ISO-8601", "startedAt": "ISO-8601", "participantCode": null,
  "build":    { "version": "", "branch": "", "commit": "" },
  "device":   { "userAgent": "", "hardwareConcurrency": 0, "deviceMemory": 0, "language": "", "screen": {} },
  "capture":  { "facing": "rear|front", "priority": "resolution|fps", "requested": {}, "settings": {}, "frame": {}, "strictFps": false, "previewMirrored": false },
  "analysis": { "mode": "worker|main", "delegate": "GPU|CPU", "imageSize": {}, "blendshapes": true, "swapNames": false, "blockedHosts": [] },
  "detector": { /* umbrales del detector de parpadeos usados */ },
  "steps": [{
    "id": "wink-left", "title": "", "instruction": "",
    "status": "completed|skipped|interrupted", "attempt": 1, "interruptReason": null,
    "startedAt": "ISO-8601", "plannedMs": 0, "durationMs": 0,
    "expect": { "left": 5, "right": 0 },          // lo que se debería detectar
    "user": { "counted": null, "notes": "" },     // lo que anota el usuario
    "perf": { "cameraFps": 0, "analysisFps": 0, "analysisMs": 0 },
    "summary": { "samples": 0, "faceFraction": 0, "left": { /* parpadeos, cierres, duración, completitud, EAR… */ }, "right": {} },
    "events": { "left": [ { "kind": "blink|closure|narrowing", "t": 0, "duration": 0, "min": 0, "baseline": 0, "completeness": 0 } ], "right": [] },
    "series": { "t": [], "left": { "ear": [], "aperture": [], "blink": [], "lookDown": [], "lookUp": [] }, "right": { } }   // t en ms desde el inicio del paso; null = sin cara
  }]
}
```
Tipos de evento: `blink` (parpadeo, ≤ 0,8 s), `closure` (cierre de más de 0,8 s con el ojo muy cerrado, p. ej. un guiño mantenido) y `narrowing` («entornado»: más de 0,8 s pero con un cierre poco profundo, < 50 %). `lookDown` y `lookUp` son los blendshapes de mirada del modelo, para estudiar los falsos cierres al mirar hacia abajo.

Los lados son siempre los del paciente. Las series completas permiten reproducir el detector con los datos reales y ajustar los umbrales sin repetir la prueba.
