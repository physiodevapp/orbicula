# Desarrollo y pruebas en la nube

Cómo comprobar la app de punta a punta desde una sesión de Claude Code en la nube (sin móvil), antes de que el autor la pruebe. Las cifras de rendimiento de aquí **no valen** (Chromium sin GPU real, SwiftShader): para eso está la prueba de rendimiento en el móvil.

## Servir la build
```bash
npm run build                      # copia también el WASM de MediaPipe (prebuild)
# Con las cabeceras de public/_headers (CSP incluida), como en Cloudflare:
CI=1 WRANGLER_SEND_METRICS=false npx wrangler dev --port 4173 --ip 127.0.0.1 &
# Sin cabeceras, como en GitHub Pages (sirve para probar la barrera de privacidad sola):
npx vite preview --port 4174 --strictPort &
```
`*.workers.dev` puede no ser accesible desde la nube: se prueba en local así.

## Cámara simulada con una cara
```bash
python3 -I scripts/dev/make-face-videos.py /tmp/caras      # portrait.y4m, crop.y4m, blink.y4m
```
Descarga la foto de ejemplo de MediaPipe (no se guarda en el repo). `blink.y4m` cierra el ojo de la izquierda de la imagen (derecho del paciente) a los 3, 6 y 9 s y el otro a los 12 s; el vídeo se repite en bucle cada 16 s. Chromium etiqueta la cámara simulada como frontal.

## Comprobar la app
```bash
node scripts/dev/check-app.cjs --video /tmp/caras/blink.y4m --wait 14000 --shot /tmp/captura.png
node scripts/dev/check-app.cjs --video /tmp/caras/crop.y4m --query '?escala=0.25' --bench /tmp/rendimiento.json
node scripts/dev/check-app.cjs --url http://127.0.0.1:4174/   # sin cabeceras; sin --video = sin cara
```
Vuelca las pastillas y el panel «Verificación de lado», las peticiones externas que salieron y los errores de consola (incluidas las llamadas que bloqueó la barrera). Playwright y Chromium están instalados de forma global: `require('playwright')`, sin `npm install`.

Parámetros útiles en la dirección: `?escala=0.25` (acorta el asistente y la prueba de rendimiento) y `?analysis=main` (análisis en el hilo principal).

## Repetir el detector con datos reales
```bash
node scripts/dev/replay-blinks.mjs informe.json '{"startRatio":0.8}'
```
Repite el detector de parpadeos sobre las series de un JSON del asistente de pruebas y compara con lo que vio la app y con lo anotado por el autor. Así se ajustan umbrales sin repetir la prueba en el móvil.

## Notas del entorno
- Un comando muy largo con un heredoc de Python incrustado puede ser rechazado por una comprobación de seguridad del entorno («could not be checked for dangerous rm operations»). Escribir el script de parche en un archivo (en el scratchpad) y ejecutarlo.
- La prueba con vídeos y Playwright tarda: dar tiempo de sobra a las esperas (el asistente con `?escala` tarda 1–3 min).
