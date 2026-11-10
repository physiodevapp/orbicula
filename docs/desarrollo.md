# Desarrollo y pruebas en la nube

Cómo comprobar la app de punta a punta desde una sesión de Claude Code en la nube (sin móvil), antes de que el autor la pruebe. Las cifras de rendimiento de aquí **no valen** (Chromium sin GPU real, SwiftShader): para eso está la prueba de rendimiento en el móvil.

## Servir la build
```bash
npm run build                      # copia también el WASM de MediaPipe y OpenCV.js parcheado (prebuild)
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
node scripts/dev/check-app.cjs --video /tmp/caras/crop.y4m --flow --wait 15000   # con el flujo óptico activado
```
Vuelca las pastillas y el panel «Verificación de lado», las peticiones externas que salieron y los errores de consola (incluidas las llamadas que bloqueó la barrera). Playwright y Chromium están instalados de forma global: `require('playwright')`, sin `npm install`.

Parámetros útiles en la dirección: `?escala=0.25` (acorta el asistente y la prueba de rendimiento) y `?analysis=main` (análisis en el hilo principal).

## Comprobar el flujo con vídeos de respuesta conocida (fase 4)
```bash
node scripts/dev/check-flow.cjs --video /tmp/caras/lid.y4m   # párpado de 1,5 px: picos en su lado, EAR igual
node scripts/dev/check-flow.cjs --video /tmp/caras/nod.y4m   # cabeceo: la compensación lo anula
node scripts/dev/run-assistant.cjs --video /tmp/caras/lid.y4m --out /tmp/informe.json   # asistente entero (?escala=0.25)
```
`run-assistant.cjs --card protocol --video /tmp/caras/lid.y4m --out /tmp/protocolo.json --auto` recorre la tarjeta del protocolo clínico (con `nod.y4m`, el reposo sale no válido y se repite). `check-flow.cjs` abre la app con `?debug` (que expone las series en `window.__orbicula`), enciende la curva «Flujo» y resume un ciclo del vídeo por tramos de 0,5 s: el máximo de la velocidad residual del párpado superior por lado y compensación, y el EAR. El vídeo empieza en un punto cualquiera del bucle de 16 s: hay que buscar el patrón (en `lid.y4m`, un pico al bajar y otro al subir, 1,5 s después). `run-assistant.cjs` recorre el asistente pulsando «Siguiente» en cada revisión e imprime los resúmenes.

## Vídeo grabado (fase 6)
```bash
# MP4 de prueba: H.264 con fotogramas B y la marca de giro de los móviles (horario 90°), y VP9
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=60 -t 4 -c:v libx264 -pix_fmt yuv420p base.mp4
ffmpeg -display_rotation:v:0 -90 -i base.mp4 -c copy phone.mp4
node scripts/dev/check-video.cjs /tmp/phone.mp4 /tmp/informe-video.json
```
Análisis completo de un vídeo con cara (6b): el vídeo sintético de parpadeos, como lo guarda un móvil (tumbado y con la marca de giro), y la tarjeta procesándolo:
```bash
ffmpeg -stream_loop 2 -i /tmp/caras/blink.y4m -vf transpose=2 -c:v libx264 -crf 18 -pix_fmt yuv420p raw.mp4
ffmpeg -display_rotation:v:0 -90 -i raw.mp4 -c copy blink_phone.mp4
node scripts/dev/check-video-analysis.cjs blink_phone.mp4 /tmp/video.json --rest 20 [--mirror]
```
En `blink.y4m`, el ojo derecho del paciente parpadea tres veces por cada vuelta de 16 s y el izquierdo una: el resumen tiene que dar unos 11 y 4 parpadeos/min, y al revés con `--mirror`. En la nube tarda unos 4 min (análisis sin GPU, ~6 fotogramas/s).

El Chromium de Playwright decodifica H.264 y VP9 con WebCodecs. `tests/fixtures/` tiene tres MP4 diminutos para los tests: índice al final y girado, índice al principio, y fps variable. Para comprobar el giro, se comparan los cuadrantes de la miniatura con los del primer fotograma girado por `ffmpeg`:
```bash
ffmpeg -i phone.mp4 -frames:v 1 ref.png
```

## Protocolo grabado y analizado después (fase 6c)
```bash
node scripts/dev/check-protocol-video.cjs --video /tmp/caras/lid.y4m --live en-directo.json --out analisis-del-video.json --query '?escala=0.4&debug'
```
Hace el protocolo en directo con la casilla «Grabar el vídeo…» marcada (MediaRecorder; el Chromium de Playwright graba MP4 H.264), descarga el JSON del directo, analiza el vídeo grabado y descarga el JSON del análisis. Con `--full` procesa todos los fotogramas y no uno de cada dos. Tarda unos 10 min con `escala=0.4` (análisis sin GPU).

## Repetir los eventos de la fase 5 con datos reales
```bash
node scripts/dev/replay-events.mjs informe.json ['{"riseFloor":0.002}']
```
Calibra con el paso `rest` y repite el detector de eventos (`src/protocol/events.js`) sobre cada paso, como en directo. Por repetición marca si hubo contracción en cada ojo; en las pruebas con controles da aciertos y falsas alarmas.

## Repetir el detector con datos reales
```bash
node scripts/dev/replay-blinks.mjs informe.json '{"startRatio":0.8}'
```
Repite el detector de parpadeos sobre las series de un JSON del asistente de pruebas y compara con lo que vio la app y con lo anotado por el autor. Así se ajustan umbrales sin repetir la prueba en el móvil.

## Notas del entorno
- Un comando muy largo con un heredoc de Python incrustado puede ser rechazado por una comprobación de seguridad del entorno («could not be checked for dangerous rm operations»). Escribir el script de parche en un archivo (en el scratchpad) y ejecutarlo.
- La prueba con vídeos y Playwright tarda: dar tiempo de sobra a las esperas (el asistente con `?escala` tarda 1–3 min).
