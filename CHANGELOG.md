# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar]

### Añadido (fase 2: landmarks)
- MediaPipe Face Landmarker 1.1.0 con el modelo (`public/modelos/`) y el WASM servidos desde el propio sitio; `scripts/copy-wasm.mjs` copia el WASM antes de `dev` y `build`. GPU con respaldo a CPU.
- ROI por lado del paciente (párpado superior, párpado inferior, ceja y canto externo) y ROI de referencia en el dorso nasal, en píxeles del frame completo (`src/roi/`). Los índices salen del mallado oficial y están documentados en `src/roi/indices.js`; el canto externo es una caja derivada.
- Lateralidad en un único sitio (`src/roi/laterality.js`): lado del paciente según la imagen analizada vaya o no en espejo, y blendshapes con lado. Tests de espejo para ROI y blendshapes.
- Superposición de las ROI (azul I, rosa D, referencia discontinua) con espejo solo en el dibujo, interruptor «Mostrar ROI».
- Pastillas de fotogramas analizados por segundo, ms de análisis y tamaño del ojo en píxeles; avisos de «no se detecta la cara» y «cara pequeña».
- Panel «Verificación de lado (guiño)»: blendshapes de parpadeo y apertura por landmarks, I y D, con opción de invertir los blendshapes.
- CSP con `'wasm-unsafe-eval'` para el WASM; sin orígenes externos.

### Cambiado
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
