# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar]

### Añadido
- Fase 1 (base): esqueleto Vite sin framework.
- Cámara en directo: trasera por defecto, selector trasera/frontal y de dispositivo (si hay más de dos), petición de 60 fps y máxima resolución, con prioridad «resolución» o «fps».
- Medición de fps reales con `requestVideoFrameCallback` y resolución real de los frames; aviso si el directo no llega a 24 fps.
- Vista frontal en espejo (solo la vista previa).
- Tokens visuales en `src/styles/tokens.css` con tema oscuro y claro; fuentes servidas desde el propio sitio.
- Despliegue en Cloudflare Workers (producción en `main`, previsualización por rama) con CSP que impide llamadas externas.
- CI en GitHub Actions: tests y build.
