# orbicula

Cuantificación de movimientos finos de la musculatura periocular (orbicular de los párpados y cejas) con la cámara del móvil, para valorar discinesias: sincinesias, mioquimias, blefaroespasmo y cierre palpebral incompleto.

> Herramienta de apoyo clínico y de seguimiento. **No es un dispositivo de diagnóstico.**
> Parte del ecosistema PhysiQ.

## Estado

v0, prueba de concepto. Hecho: **fase 1** (base: cámara, selector, fps y resolución reales) **fase 2** (Face Landmarker, ROI por lado y lateralidad) y **fase 3** (EAR, parpadeos y curvas en tiempo real). Ver [`CHANGELOG.md`](CHANGELOG.md).

## Uso clínico

> Borrador: se completará con lo aprendido en las pruebas de cada fase.

- **Navegador:** Chrome para Android, abriendo la app por su dirección `https://`.
- **Cámara:** la trasera da más resolución y suele dar más fps; úsala con el móvil en un soporte o trípode. La frontal sirve para que el paciente se vea, pero la imagen se muestra en espejo (las mediciones siempre se refieren a la izquierda y la derecha **del paciente**).
- **Encuadre:** la cara de frente, centrada, ocupando al menos la mitad del ancho de la imagen. La mirada al frente y la cabeza apoyada si es posible (respaldo o reposacabezas).
- **Distancia:** unos 30–50 cm entre el objetivo y la cara. Más cerca, la cara se sale del encuadre al moverse; más lejos, la región periocular tiene pocos píxeles.
- **Iluminación:** luz frontal, difusa y uniforme (por ejemplo, frente a una ventana sin sol directo). Evita contraluces, sombras sobre un solo lado de la cara y fluorescentes que parpadeen.
- **fps:** la app muestra los fps reales. Por debajo de 24 fps lo avisa: prueba la prioridad «fps» (menos resolución, más fotogramas).
- **fps medidos** (Chrome para Android, móvil del autor, luz de interior):

  | Cámara | Prioridad «Resolución» | Prioridad «fps» (exige ≥ 55 fps) |
  |---|---|---|
  | Trasera | 29.9 fps · 2160×4032 | **49.2 fps** · 720×1280 |
  | Frontal | 29.9 fps · 2160×3440 | 29.0 fps · 720×1280 |

  Ambas anuncian 60 fps, pero si solo se piden como «ideal» Chrome se queda en 30: por eso la prioridad «fps» exige un mínimo. La frontal acepta el mínimo pero sigue dando unos 30. Con poca luz la cámara alarga la exposición y baja los fps (la frontal llegó a 24). **Para medir en directo, usa la trasera con prioridad «fps» y buena luz.**
- **Privacidad:** la imagen se procesa en el propio móvil. No se envía nada a ningún servidor y el vídeo no se guarda. La librería de MediaPipe intenta enviar un registro de uso a `odml.pa.googleapis.com`: lo bloquean dos barreras independientes, la CSP de `public/_headers` y una barrera en el código (`src/privacy/`), que funciona aunque el hosting no sirva cabeceras. La sección «Verificación de lado» muestra qué dominios se han bloqueado.

## Parpadeos y curvas

- **EAR** (eye aspect ratio): apertura vertical media del ojo dividida por su ancho. Ronda 0,25–0,35 con el ojo abierto. Es la señal del detector de parpadeos.
- **Reposo**: la apertura habitual del ojo, estimada con los últimos 5 s (la línea discontinua de la curva). Hacen falta unos 1,5 s de señal antes de detectar.
- **Parpadeo**: cierre que baja del 75 % del reposo y vuelve a subir del 85 %. La **duración** se mide a media altura del cierre; la **completitud** es el cierre respecto al reposo. El EAR no llega a 0 con el ojo cerrado (el contorno del párpado tiene grosor): un cierre completo marca en torno al 70–80 %. Un cierre de más de 0,8 s se anota como «cierre», no como parpadeo.
- **Asimetría** = (I − D) / (I + D) sobre los últimos 10 s de la métrica elegida; I y D son siempre las del paciente.
- Todos los umbrales son provisionales y se ajustan con las pruebas en el móvil.

## Asistente de pruebas

Debajo del vídeo hay un asistente que guía por cada prueba y guarda las medidas en un JSON que se puede descargar y compartir. Ver [`docs/pruebas.md`](docs/pruebas.md). Más abajo, una **prueba de rendimiento** compara el análisis en worker y en el hilo principal, con y sin blendshapes ([`docs/rendimiento.md`](docs/rendimiento.md)).

## Créditos

Modelo Face Landmarker y librería `@mediapipe/tasks-vision` de Google (licencia Apache 2.0), servidos desde este repositorio.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests (Vitest)
npm run build    # build de producción en dist/
```

Stack: Vite + JavaScript sin framework. Detalles y fases en [`CLAUDE.md`](CLAUDE.md).

## Despliegue

Cloudflare Workers con archivos estáticos (`wrangler.jsonc`), conectado al repositorio con Workers Builds:

- `main` → producción: `https://orbicula.<subdominio>.workers.dev`
- cada rama → previsualización: `https://<rama>-orbicula.<subdominio>.workers.dev`

El pie de la app muestra la versión, la rama y el commit con que se construyó. GitHub Actions pasa los tests y la build en cada PR y en `main`.
