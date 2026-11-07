# Qué modelo usar en cada fase

Guía para gastar menos tokens: usar el modelo más capaz solo donde el error sale caro
(señal, geometría, lateralidad, sincronía de frames) y uno más barato en el resto.
Se cambia con `/model` en Claude Code; Claude no puede cambiarlo por sí mismo.

| Modelo | Cuándo |
|---|---|
| **Opus** | Diseño con decisiones difíciles de deshacer, procesado de señal, depurar algo que no se entiende tras un intento, revisar un PR grande antes de fusionarlo. |
| **Sonnet** | Implementar un plan ya decidido, UI, tests, ajustes a partir de capturas del móvil. Es el modelo por defecto. |
| **Haiku** | Tareas pequeñas y mecánicas: README, CHANGELOG, textos de la interfaz, renombrar, dudas del panel de Cloudflare o de GitHub. |

## Por fase

| Fase | Plan | Implementación | Por qué |
|---|---|---|---|
| 1. Base | — | — | Hecha. |
| 2. Landmarks | Opus | Sonnet | El plan fija índices, ROI derivadas y la convención de lateralidad; implementarlo es mecánico. Si el guiño sale en el lado equivocado, depurar con Opus. |
| 3. EAR y parpadeos | Sonnet | Sonnet | Fórmulas conocidas y curvas. Opus solo si la detección de parpadeos da falsos positivos que no se entienden. |
| 4. Flujo óptico | Opus | Opus | Lo más delicado: OpenCV.js en un worker, Farnebäck sobre recortes a resolución completa, compensación de la cabeza. De esto depende la pregunta de la v0. |
| 5. Protocolo | Opus | Sonnet | Calibrar el umbral sobre el reposo y definir los eventos es diseño; las fases guiadas y el resumen son UI. |
| 6. Vídeo grabado | Opus | Opus | Decodificar frame a frame con tiempos exactos y orientación o espejo del archivo falla de formas sutiles. |
| 7. Exportación e integración | Sonnet | Sonnet | Esquema JSON, CSV y `postMessage`: bien especificados en `CLAUDE.md`. Opus para revisar el esquema antes de fijar `schemaVersion: "1"`. |

## Tareas sueltas

| Tarea | Modelo |
|---|---|
| Revisar capturas del móvil y ajustar UI o textos | Sonnet |
| Actualizar README, CHANGELOG o docs | Haiku |
| Abrir o vigilar un PR, fusionar | Haiku |
| CI en rojo con causa evidente | Sonnet |
| CI en rojo o fallo en el móvil sin causa clara tras un intento | Opus |
| Revisión final de una fase antes del PR | Opus |

## Esfuerzo

Con el esfuerzo de razonamiento pasa lo mismo: alto en el plan de las fases 4 y 6 y en la depuración difícil;
medio o bajo en lo demás.
