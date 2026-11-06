# orbicula

Herramienta web para **cuantificar movimientos finos de la musculatura periocular** (orbicular de los párpados y cejas) con la cámara del móvil, orientada a valorar discinesias: sincinesias, mioquimias, blefaroespasmo y cierre palpebral incompleto.

Es una marca independiente, **integrable en el hub PhysiQ** como satélite. Es una herramienta de apoyo clínico y de seguimiento, **no un dispositivo de diagnóstico**.

## Contexto del autor

- El desarrollo se hace **solo desde un móvil Android** (con pantalla y teclado externos), sin entorno local. Todo tiene que poder probarse en Chrome para Android y desplegarse sin pasos manuales.
- El autor es fisioterapeuta. La terminología clínica de la interfaz va en español.

## Objetivo de la v0 (prueba de concepto)

Responder a una pregunta: **¿el flujo óptico sobre la región periocular, con la cámara de un móvil, da una señal útil para detectar movimientos más finos que los que capta un landmark?**

## Stack

- HTML + JavaScript (ES modules) con **Vite**. Sin framework, salvo que haya una razón clara. Antes de empezar, si puedes acceder al repo del hub (`physiodevapp/physiq`) o a otros satélites, revisa sus convenciones y sigue las mismas.
- **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`) para localizar la cara y las regiones de interés.
- **OpenCV.js** para el flujo óptico denso (Farnebäck), ejecutado en un **Web Worker**.
- Despliegue en **GitHub Pages** mediante GitHub Actions, con rutas relativas (`base` de Vite configurada para el subpath del repo).
- El modelo `.task` y los archivos WASM se **sirven desde el propio repo**, no desde un CDN, para que funcione sin red una vez cargado.

## Pipeline

1. **Entrada**, con dos modos:
   - **Cámara en directo**: `getUserMedia`, con la cámara trasera por defecto (selector para la frontal). Pide 60 fps y la mayor resolución disponible, y muestra en la interfaz los fps y la resolución reales obtenidos.
   - **Vídeo grabado**: carga de un archivo grabado con la app de cámara nativa. Se procesa frame a frame en modo IMAGE, sin el suavizado del tracking. Es el modo de máxima sensibilidad.
2. **Localización**: Face Landmarker obtiene los landmarks y los blendshapes y, a partir de ellos, define estas regiones (ROI) por lado:
   - párpado superior, párpado inferior, ceja y canto externo (patas de gallo);
   - además, una ROI de referencia rígida (dorso nasal o frente) para compensar el movimiento de la cabeza.
   - Obtén los índices de landmarks del mallado canónico oficial de MediaPipe y documéntalos en `src/roi/indices.js`. No los inventes.
3. **Medición**:
   - Flujo óptico denso sobre cada ROI, **recortada del frame a resolución completa** (no del recorte interno del modelo).
   - **Compensación del movimiento de cabeza**: resta el movimiento de la ROI de referencia, o el que se deriva de la matriz de transformación facial. Sin esto, la señal no vale nada.
4. **Lateralidad**: izquierda y derecha se refieren siempre **a la cara del paciente**. Si la imagen va en espejo (cámara frontal), corrige tanto los blendshapes como las ROI. Añade un test que lo verifique.

## Métricas (por lado, salvo que se indique otra cosa)

- **EAR** (eye aspect ratio) y apertura palpebral normalizada a la distancia intercantal.
- **Parpadeos**: frecuencia, duración y completitud (porcentaje de cierre respecto a la apertura en reposo).
- **Energía de flujo residual** por ROI, tras la compensación de la cabeza.
- **Índice de asimetría** = (I − D) / (I + D) para cada métrica.
- **Pico espectral** (FFT sobre la señal de flujo) para detectar actividad rítmica, como las mioquimias.
- **Co-activación**: correlación entre la señal periocular y los blendshapes de la boca (smile) para detectar sincinesias.
- **Registro de eventos**: momentos en que una ROI supera un umbral, calibrado sobre el reposo del propio paciente.

## Protocolo guiado (v0)

Secuencia con instrucciones en pantalla y duración configurable:

1. Reposo con la mirada al frente (sirve de calibración de la línea base).
2. Parpadeo espontáneo.
3. Cierre suave.
4. Cierre forzado.
5. Elevación de cejas.
6. Sonrisa amplia (provocación de sincinesia).

## Interfaz

- Vista en directo con superposición de las ROI y, opcionalmente, del campo de flujo.
- Dos curvas en tiempo real (izquierda y derecha) de la métrica seleccionada.
- Aviso de calidad de captura: fps bajos, cara pequeña en el encuadre, poca luz o cabeza girada.
- Resumen al acabar el protocolo, con las métricas por fase y lado y su asimetría.
- Diseño *mobile-first*, con funcionamiento correcto a 380 px de ancho.

## Privacidad (requisito duro)

- **Ningún dato del paciente sale del dispositivo**: sin llamadas de red salvo para cargar la propia app.
- El vídeo no se guarda por defecto. Solo se exportan métricas y series temporales numéricas.
- Sin analítica ni cookies de terceros.

## Exportación

- **JSON** con este esquema versionado:
  ```json
  {
    "app": "orbicula",
    "appVersion": "0.1.0",
    "schemaVersion": "1",
    "createdAt": "ISO-8601",
    "capture": { "source": "live|file", "camera": "rear|front", "fps": 0, "width": 0, "height": 0, "mirrored": false },
    "protocol": [{ "phase": "rest", "start": 0, "end": 0 }],
    "metrics": { "left": {}, "right": {}, "asymmetry": {} },
    "events": [],
    "timeseries": { "t": [], "left": {}, "right": {} }
  }
  ```
- **CSV** de las series temporales.
- Ni el JSON ni el CSV incluyen identificación del paciente. Opcionalmente se puede añadir un código anónimo que escriba el clínico.

## Integrabilidad con PhysiQ (requisitos)

- **Independencia**: funciona completa en su propia URL. Ningún módulo importa nada de PhysiQ; es el hub el que depende de orbicula, no al revés.
- **Modo alojado**: con `?host=physiq`, orbicula oculta su cabecera y su pie y adopta los tokens visuales del hub.
- **Tokens CSS**: todos los colores, tipografías, espaciados y radios están definidos como variables en `:root`, en un único archivo (`src/styles/tokens.css`). Incluye tema claro y oscuro. El hub puede sobrescribirlos.
- **API por `postMessage`** para cuando se carga dentro de un iframe:
  - emite `{ type: "orbicula:ready" }` al cargar;
  - emite `{ type: "orbicula:result", payload: <JSON de exportación> }` al terminar un protocolo;
  - acepta `{ type: "orbicula:config", payload: { theme, lang, protocol } }`;
  - valida `event.origin` frente a una lista de orígenes permitidos, configurable.
- **Formato de datos**: el JSON de exportación es la interfaz pública. Documenta su esquema en `docs/schema.md` y no rompas la compatibilidad sin subir `schemaVersion`.
- **Marca**: en modo autónomo, un pie discreto con el texto "Parte del ecosistema PhysiQ". Sin logotipos de PhysiQ en el código.

## Fuera de alcance en la v0

- Diagnóstico o clasificación automática de patologías.
- Action Units (FACS) y cualquier modelo que necesite servidor.
- Cuentas de usuario y almacenamiento en la nube.

## Criterios de aceptación

1. En Chrome para Android, el procesado en directo va a 24 fps o más. Si no llega, la app lo indica y propone usar el modo de vídeo grabado.
2. Un parpadeo voluntario de un solo ojo se detecta en el lado correcto, con ambas cámaras.
3. Con la cabeza quieta, la energía de flujo distingue con claridad el reposo de una contracción mínima voluntaria del orbicular, menor de la que mueve visiblemente el EAR.
4. Un cabeceo suave sin contracción periocular **no** genera eventos, gracias a la compensación.
5. El JSON exportado valida contra el esquema documentado.
6. Cargada en un iframe con `?host=physiq`, emite `ready` y `result` y aplica la configuración recibida.
7. El despliegue en GitHub Pages funciona por HTTPS desde el móvil.

## Forma de trabajar

Trabaja por fases y **detente al final de cada una** para que el autor la pruebe en el móvil:

1. **Base**: esqueleto Vite, despliegue en Pages, cámara con selector y visualización de fps y resolución reales.
2. **Landmarks**: Face Landmarker, ROI dibujadas por lado, corrección de espejo y su test.
3. **EAR y parpadeos**: métricas y curvas en tiempo real.
4. **Flujo óptico**: worker con OpenCV.js, compensación de la cabeza y energía residual por ROI.
5. **Protocolo**: fases guiadas, calibración en reposo, eventos y resumen.
6. **Vídeo grabado**: procesado offline frame a frame.
7. **Exportación e integración**: JSON y CSV, esquema documentado, modo alojado y API `postMessage`.

Mantén un `README.md` con instrucciones de uso clínico (encuadre, distancia, iluminación) y un `CHANGELOG.md`.
