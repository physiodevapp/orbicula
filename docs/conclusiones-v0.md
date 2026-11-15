# Conclusiones de la v0 (prueba de concepto)

**Fecha:** 2026-11-15. **Versión:** `main` tras el PR #13. **Sujeto:** uno, sano (el autor), con su móvil Android (Chrome 156–157, 9 núcleos) y, en algunas pruebas, la webcam de un ordenador.

Este documento reúne lo que demostraron las pruebas de las fases 4 a 7 y de las mejoras posteriores. El detalle de cada prueba está en `docs/plan-fase-4.md` … `docs/plan-fase-7.md`; aquí va la respuesta, con qué datos se sostiene y qué no se sabe todavía.

## La pregunta

> ¿El flujo óptico sobre la región periocular, con la cámara de un móvil, da una señal útil para detectar movimientos más finos que los que capta un landmark?

**Respuesta: sí, en este sujeto y en estas condiciones.** El **cierre por flujo** (desplazamiento vertical integrado del párpado inferior respecto al superior, compensado con el movimiento del dorso nasal) detecta contracciones mínimas del orbicular que el EAR de los landmarks no distingue del reposo, sin más falsas alarmas.

| Prueba | Medida | Contracciones mínimas detectadas (por ojo) | Falsas alarmas (controles) |
|---|---|---|---|
| Fase 4, dos sesiones con controles al azar (18:38 y 19:14) | EAR | 6/13 y 10/13 | 2/15 |
| | **Cierre por flujo** | **12/13 y 12/13** | 2/15 (las mismas: movimientos reales) |
| Fase 5, tres sesiones con controles y el detector definitivo (umbral calibrado en el reposo) | **Cierre por flujo** | **25/29 y 26/29** | **0/26** |

- **Margen:** en la sesión de las 19:14, la contracción más débil multiplicaba por ~8 el control más fuerte con el flujo, y por 1,1–3 con el EAR. Las dos separan, pero el flujo con mucho más margen.
- **Lo que el flujo no hace:** cuando el párpado tapa el ojo (parpadeo o cierre completo) el flujo pierde el seguimiento. Para parpadeos y cierres completos manda el EAR; el flujo es para los movimientos finos. La app usa cada uno para lo suyo.
- **Velocidad no, desplazamiento sí:** la energía del flujo (velocidad) no discrimina, porque en reposo los ojos ya hacen sacadas rápidas. Lo que funciona es el desplazamiento integrado.

## Criterios de aceptación de `CLAUDE.md`

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | En directo, 24 fps o más; si no llega, lo dice y propone el vídeo | **Cumplido** | Protocolo completo con GPU (2026-11-14): 24,1–28,8 análisis/s por fase. Aviso por debajo de 24 durante 5 s. Con el móvil caliente baja a 22–24: es el límite real. |
| 2 | Un guiño en el lado correcto, con las dos cámaras | **Cumplido** | Directo con la trasera y vídeo grabado con la trasera y la frontal (HEVC girada 270°). Test de lateralidad con espejo. |
| 3 | El flujo distingue una contracción mínima menor que la que mueve el EAR | **Cumplido** | Tabla de arriba. |
| 4 | Un cabeceo suave no genera eventos | **Cumplido** | 0 eventos en cabeceo y giro con la medida que genera los eventos (fases 4 y 5), con la puerta «cabeza en movimiento». |
| 5 | El JSON exportado valida contra el esquema | **Cumplido** | `ajv` en los tests, `check-export` y los JSON reales del móvil. |
| 6 | En un iframe con `?host=physiq`: `ready`, `result` y configuración | **Cumplido** | A mano en el móvil y el ordenador, y `check-hub`. |
| 7 | Despliegue en Cloudflare por HTTPS (producción y previsualizaciones) | **Cumplido** | Previsualizaciones por rama todo el desarrollo; producción comprobada en `main@a17bed8`. |

## Qué mide la v0 y con qué fiabilidad

| Medida | Qué es | Notas de las pruebas |
|---|---|---|
| EAR y apertura | Landmarks del párpado, normalizados | Ruido en reposo ~0,008–0,010 (desviación típica), algo más con la CPU (0,014). |
| Parpadeos | Detector sobre el EAR: frecuencia, duración, completitud | En directo salen ~2 veces más largos (~250 ms) que en el vídeo grabado (140–170 ms, la duración real) y se detectan ~40 % menos. Para medir parpadeos, el vídeo grabado. |
| Cierres (suave, forzado) | 1 − EAR mínimo / EAR del reposo | Iguales en directo y en vídeo (0,96–0,98). |
| Contracciones finas | Subida del cierre por flujo sobre el umbral del reposo | La medida que responde a la pregunta. Duración mínima 0,5 s; las más cortas quedan como «breves». |
| Cejas | Subida integrada por flujo (DI) | Directo y vídeo coinciden desde que se corrigió el reloj del vídeo (0,15–0,23 DI). |
| Sonrisa | **Comisura de la boca** (landmarks 61/291 en un sistema 3D de la cara), en DI | La asimetría de una sonrisa más fuerte en un lado sale ~5 veces mayor que con el blendshape del modelo, que casi satura (91–96 % en los dos lados). Repetible: −0,13 y −0,09 en dos sesiones. Ruido en reposo ~0,008 DI (≈0,3 mm). |
| Co-activación ojo–boca | Correlación de la comisura con el cierre del ojo del mismo lado | Varía mucho entre sesiones (de −0,1 a 0,9): orientativa. |
| Actividad rítmica | Pico espectral del párpado superior | Sin casos positivos en las pruebas (sujeto sano): no se ha podido validar. |

**Directo frente a vídeo grabado:** el vídeo es más sensible (parpadeos reales, picos sin suavizar) y no depende de la velocidad del móvil, pero tarda en analizarse (un protocolo de 4 min grabado, ~4–5 min de análisis con la CPU: 24–27 fotogramas/s). Los valores no son intercambiables: hay que comparar directo con directo y vídeo con vídeo.

## Lo que enseñaron las pruebas (y no habría salido sin ellas)

- **La referencia del reposo manda:** sin apartar los tramos con la cabeza en movimiento, el criterio 4 «se cumplía» sin significar nada. Reposo largo, con la cabeza apoyada.
- **La cara pequeña parece movimiento:** con el ojo por debajo de ~60 px, el ruido de la cámara se confunde con movimiento de la cabeza y el reposo no valida. De ahí el aviso por píxeles del ojo.
- **El reloj del vídeo de Android deriva:** ~0,5 % (1,1–1,3 s en 4 min), y las marcas caían tarde. Corregido con los tiempos de llegada de cada trozo de la grabación; queda ±0,2 s.
- **En directo gana la GPU; en el vídeo, la CPU:** en directo la CPU la comparten la cámara y el flujo (22–24 análisis/s frente a 24–29). En el vídeo la CPU va el doble de rápida (27 frente a 13 fotogramas/s).
- **Taparse con la mano no es «cara perdida»:** el modelo sigue ajustando una cara. Solo se detecta la cara fuera del encuadre.
- **Con la trasera no se ve la pantalla:** todos los avisos importantes tienen voz (cara pequeña, cara perdida, reposo no válido, fase repetida).

## Limitaciones

- **Un solo sujeto, sano.** Ningún paciente con sincinesias, mioquimias o blefaroespasmo: no se sabe cómo se comportan las medidas con una patología real.
- **Sin patrón de referencia.** No hay EMG ni valoración clínica independiente; «contracción mínima» es lo que el sujeto intentó hacer.
- **Un móvil.** El rendimiento y la calidad dependen de la cámara, la luz y la temperatura del móvil.
- **Umbrales provisionales.** La tabla de `plan-fase-5.md` (umbral de eventos, duración mínima, cara pequeña, asimetría destacada…) se fijó con estos datos y puede cambiar con más.
- **Las regiones laterales (canto, ceja) compensan peor el giro** que los párpados: la puerta «cabeza en movimiento» evita eventos falsos, pero sus energías no son fiables con la cabeza girando.
- **Herramienta de apoyo, no de diagnóstico:** no clasifica patologías (fuera de alcance de la v0).

## Recomendaciones para una v1

1. **Validación con más sujetos:** varios sanos (variabilidad del reposo, repetibilidad entre sesiones) y después pacientes con las discinesias objetivo. Es lo que más falta.
2. **Una referencia:** EMG de superficie del orbicular en un subgrupo, o una valoración clínica ciega en vídeo, para saber qué es una «contracción» real.
3. **Valores de referencia de la asimetría:** hoy se destacan las asimetrías ≥ 0,20 sin datos que lo respalden.
4. **Actividad rítmica:** probarla con un caso de mioquimia o blefaroespasmo; sin un positivo, el detector espectral no está validado.
5. **Si el protocolo se usa con pacientes:** grabar el vídeo por defecto y usar sus métricas (más sensibles), con el directo como guía durante la prueba.
