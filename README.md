# orbicula

Cuantificación de movimientos finos de la musculatura periocular (orbicular de los párpados y cejas) con la cámara del móvil, para valorar discinesias: sincinesias, mioquimias, blefaroespasmo y cierre palpebral incompleto.

> Herramienta de apoyo clínico y de seguimiento. **No es un dispositivo de diagnóstico.**
> Parte del ecosistema PhysiQ.

## Estado

v0, prueba de concepto. Hecho: **fase 1** (base: cámara, selector, fps y resolución reales) **fase 2** (Face Landmarker, ROI por lado y lateralidad) y **fase 3** (EAR, parpadeos y curvas en tiempo real). **Fase 4** (flujo óptico): hecha; en el móvil del autor, el cierre por flujo detecta contracciones mínimas del orbicular que el EAR no distingue del reposo (ver `docs/plan-fase-4.md`). **Fase 6** (vídeo grabado): hecha; análisis fotograma a fotograma de un vídeo de la app de cámara y del propio protocolo grabado, con los guiños en su lado con las dos cámaras (ver [`docs/plan-fase-6.md`](docs/plan-fase-6.md)). **Fase 5** (protocolo guiado): hecha; seis fases con voz y pitidos, calibración sobre el reposo del propio paciente, eventos en directo y un resumen por fase y lado con su asimetría (ver [`docs/plan-fase-5.md`](docs/plan-fase-5.md)). **Fase 7** (exportación e integración): hecha; JSON y CSV de los resultados con un esquema documentado y validado ([`docs/schema.md`](docs/schema.md)), sesiones guardadas en el dispositivo para recuperar el trabajo tras recargar, modo alojado dentro del hub PhysiQ y API por `postMessage` ([`docs/integracion.md`](docs/integracion.md); ver [`docs/plan-fase-7.md`](docs/plan-fase-7.md)). Ver [`CHANGELOG.md`](CHANGELOG.md).

## Uso clínico

> Los umbrales son provisionales y salen de pruebas con un solo sujeto sano (el autor): no hay todavía pacientes ni un patrón de referencia (EMG).

- **Navegador:** Chrome para Android, abriendo la app por su dirección `https://`.
- **Cámara:** la trasera da más resolución y suele dar más fps; úsala con el móvil en un soporte o trípode. La frontal sirve para que el paciente se vea, pero la imagen se muestra en espejo (las mediciones siempre se refieren a la izquierda y la derecha **del paciente**).
- **Tamaño de la cara:** mira el indicador **«ojo ≈ N px»**: el ojo debe medir **más de 60 px** (el umbral es provisional). Con el ojo pequeño, el ruido de la cámara se confunde con movimiento de la cabeza y el reposo falla una y otra vez («te has movido») aunque estés quieto. Por debajo de 60 px, orbicula lo avisa en pantalla y, durante el reposo, **también por voz** («Cara pequeña. Acércate un poco»). En un ordenador, con la webcam, hay que sentarse más cerca de lo que parece (unos 30–40 cm) y con luz de frente.
- **Encuadre:** la cara de frente, centrada, ocupando al menos la mitad del ancho de la imagen. La mirada al frente y la cabeza apoyada si es posible (respaldo o reposacabezas).
- **Distancia:** unos 30–50 cm entre el objetivo y la cara. Más cerca, la cara se sale del encuadre al moverse; más lejos, la región periocular tiene pocos píxeles.
- **Iluminación:** luz frontal, difusa y uniforme (por ejemplo, frente a una ventana sin sol directo). Evita contraluces, sombras sobre un solo lado de la cara y fluorescentes que parpadeen.
- **fps:** la app muestra los fps reales. Por debajo de 24 fps lo avisa: prueba la prioridad «fps» (menos resolución, más fotogramas).
- **fps medidos** (Chrome para Android, móvil del autor, luz de interior):

  | Cámara | Prioridad «Resolución» | Prioridad «fps» (exige ≥ 55 fps) |
  |---|---|---|
  | Trasera | 29.9 fps · 2160×4032 | **49.2 fps** · 720×1280 |
  | Frontal | 29.9 fps · 2160×3440 | 29.0 fps · 720×1280 |

  Ambas anuncian 60 fps, pero si solo se piden como «ideal» Chrome se queda en 30: por eso la prioridad «fps» exige un mínimo. **La prioridad por defecto es «fps» (720p)**: el análisis de la cara tarda lo mismo con cualquier resolución (el modelo reduce la imagen) y con la trasera a 4K, copiar cada frame al worker cuesta ~7 ms y el análisis cae a 16–21 por segundo, por debajo de los 24 mínimos. «Resolución» queda como opción. La frontal acepta el mínimo pero sigue dando unos 30. Con poca luz la cámara alarga la exposición y baja los fps (la frontal llegó a 24). **Para medir en directo, usa la trasera con prioridad «fps» y buena luz.**
- **Privacidad:** la imagen se procesa en el propio móvil. No se envía nada a ningún servidor y el vídeo no se guarda. La librería de MediaPipe intenta enviar un registro de uso a `odml.pa.googleapis.com`: lo bloquean dos barreras independientes, la CSP de `public/_headers` y una barrera en el código (`src/privacy/`), que funciona aunque el hosting no sirva cabeceras. La sección «Verificación de lado» muestra qué dominios se han bloqueado.

## Protocolo clínico

La tarjeta **«Protocolo clínico»** (debajo del vídeo) guía una exploración de unos 4 minutos con voz y pitidos, pensada para hacerse con la cámara trasera sin mirar la pantalla. Es una herramienta de apoyo y seguimiento, **no de diagnóstico**.

**Preparación** (de ella depende que las mediciones valgan):
- **Móvil firme**, en un soporte o apoyado, a 30–40 cm y con la cara de frente y centrada. Si el móvil se mueve, se mide ese movimiento y no el del párpado.
- **Cabeza apoyada** en un respaldo o en una pared, mirando al frente, **quieta**.
- **Luz frontal, estable y sin parpadeo** (luz natural o una lámpara que no parpadee).
- **Cámara trasera con prioridad «fps»** (la de por defecto). Si el aviso de fps sale en rojo, el análisis irá lento.

**Fases** (la voz explica cada una; en los gestos, pitido agudo = ahora y grave = relaja):
1. **Reposo (calibración), 30 s.** Mirada al frente, sin hacer nada, parpadeando con naturalidad. De aquí salen los umbrales de la persona. Si la cabeza se mueve, se parpadea mucho o se pierde la cara, **se repite solo**, y la voz y la pantalla dicen por qué.
2. **Parpadeo espontáneo, 60 s.**
3. **Cierre suave:** cerrar los ojos suavemente, como para dormir.
4. **Cierre forzado:** apretar los ojos con fuerza.
5. **Elevación de cejas.**
6. **Sonrisa amplia:** enseñando los dientes.

Se pueden cambiar la duración del reposo y del parpadeo, y las repeticiones de cada gesto (3, 4 o 5). Con el **modo seguido** (por defecto) no hace falta tocar nada entre fases.

**El resumen** (al acabar) da, por fase, el valor de cada lado (I y D, siempre del paciente) y su **asimetría** (I − D) / (I + D); las de 0,20 o más se destacan, de forma orientativa. Incluye:
- **Parpadeos:** frecuencia, duración y cierre respecto al **cierre máximo del propio ojo**.
- **Cierres:** cuánto cierra cada ojo y cuánto se mueven la ceja y el canto externo.
- **Cejas:** cuánto se abre el ojo y cuánto sube la ceja.
- **Sonrisa:** la sonrisa de cada lado, cuánto se cierra el ojo con ella y la **co-activación ojo–boca**. Una sonrisa amplia sana también cierra algo el ojo: lo que informa es la **diferencia entre lados** y su evolución entre sesiones, no el valor solo.
- **Actividad rítmica** de los párpados (pico espectral, para mioquimias), en el reposo y el parpadeo.
- **Contracciones finas:** subidas del cierre por flujo por encima del umbral del reposo, de más de 0,5 s, sin parpadeo ni movimiento de la cabeza.
- **Avisos:** fases «poco fiables» (cabeza movida, cara perdida o análisis lento, por debajo de 24 por segundo) y umbral alto en el reposo.

**Límites conocidos:**
- A unos 27 fotogramas por segundo, el cierre de un parpadeo breve se subestima: el «% de parpadeos incompletos» es orientativo, para comparar lados y sesiones. El vídeo grabado (fase 6) lo mejorará.
- En los cierres completos, el flujo no sigue al párpado: ahí manda el EAR.
- Con el móvil caliente, el análisis puede bajar de 24 por segundo en sesiones largas.
- Los eventos de ceja y canto son experimentales y no se resumen.

El JSON de resultados lleva las series, la calibración, los eventos y este resumen (formato de diagnóstico `orbicula-test-session/3`, en [`docs/pruebas.md`](docs/pruebas.md)).

## Vídeo grabado

La tarjeta **«Vídeo grabado»** (arriba de todo, sin necesidad de activar la cámara) analiza un vídeo hecho con la **app de cámara del móvil**, fotograma a fotograma. Es el modo de **máxima sensibilidad**: se analizan todos los fotogramas, la cara sin el suavizado del directo y el flujo en todos los pares.

**Cómo grabar el vídeo:**
- Con la app de cámara normal, la trasera si puedes, con el móvil **firme** y la cara de frente, la cabeza apoyada y buena luz.
- Los **primeros 30 s, quieto y mirando al frente**: son el reposo de calibración (se puede cambiar a 20 o 45 s). Después, lo que quieras medir.
- Si grabas con la frontal, comprueba si el vídeo sale **en espejo** (las letras se leen al revés) y marca la casilla; con la trasera casi nunca lo está.
- Formato MP4 (H.264 o HEVC). Si Chrome no puede decodificar el códec, la tarjeta lo dice: graba en H.264 («Más compatible» en la app de cámara).

**Cómo analizarlo:** elige el archivo, comprueba que la ficha dice «El navegador lo puede decodificar» y pulsa **«Analizar el vídeo»**. Un vídeo de 1 minuto tarda unos 2–3 minutos; uno de 4 minutos, unos 10. Mantén la pantalla encendida. Al acabar salen el resumen (reposo y resto del vídeo, con asimetrías) y el JSON.

**El protocolo, grabado:** en la tarjeta «Protocolo clínico», la casilla **«Grabar el vídeo para analizarlo después»** graba el vídeo del propio protocolo y, al acabar, lo analiza fotograma a fotograma con las fases exactas. Ofrece el mismo resumen por fases con más sensibilidad: por ejemplo, detecta más parpadeos y los mide con su duración real.

**Privacidad:** el vídeo se lee en el móvil y no sale de él. El que graba el protocolo **solo existe en la memoria**: no se guarda como archivo ni se puede exportar, y se borra al terminar el análisis, al descartarlo o al empezar otra sesión.

**Si el directo va lento:** cuando el análisis en directo baja de 24 por segundo, la app lo avisa y propone este modo.

## Sesiones guardadas
Al terminar un protocolo (en directo o grabado) o el análisis de un vídeo, orbicula **guarda sus medidas en el propio móvil** (IndexedDB), para que recargar la página no las pierda. Aparecen en la tarjeta «Sesiones guardadas en este dispositivo», donde se pueden abrir para ver el resumen y descargar el JSON y los CSV.
- **Qué se guarda:** solo medidas numéricas, la ficha de la captura y el código anónimo. **Nunca el vídeo, imágenes ni el nombre del archivo.**
- **Cuánto:** las últimas 5 sesiones, y se borran solas a los 30 días. «Borrar» y «Borrar todo lo guardado» las quitan en el acto.
- **Recuperar un análisis de vídeo:** al elegir de nuevo el mismo vídeo, la tarjeta «Vídeo grabado» ofrece «Recuperar el análisis», que ahorra volver a hacerlo (unos 2 minutos por cada minuto de vídeo). Se reconoce por tamaño, número de fotogramas y duración, **no por el nombre**: Android le da otro nombre al mismo vídeo según se elija desde Fotos o desde Archivos.
- **Qué no se recupera:** un análisis o un protocolo a medias. Si recargas durante el análisis, hay que repetirlo.
- **Modo alojado (`?host=physiq`):** no se guarda nada; el hub recibe el resultado por `postMessage`.
- **Móvil compartido:** las sesiones solo llevan el código anónimo, pero si el móvil lo usa más gente, pulsa «Borrar todo lo guardado» al terminar.

## Modo alojado (dentro de PhysiQ)
Con `?host=physiq` en la dirección, orbicula se ve como parte del hub: **sin cabecera ni pie**, con el **tema oscuro** del hub (el hub es solo oscuro, aunque el móvil esté en claro) y con sus colores de texto y de error. El acento sigue siendo el de orbicula: cada satélite del hub tiene el suyo. En este modo no se guardan sesiones en el dispositivo.
- **Cómo cargarla en el hub:** `<iframe src="…/orbicula/?host=physiq" allow="camera; screen-wake-lock">`. Sin `camera` el navegador no deja encender la cámara dentro del iframe; sin `screen-wake-lock` la pantalla puede apagarse a mitad de un protocolo (orbicula lo dice en `orbicula:ready`).
- **Mensajes con el hub (`postMessage`):** `orbicula:ready` al cargar, `orbicula:result` con el JSON al terminar un protocolo y `orbicula:config` para elegir tema y duraciones. Solo se habla con los orígenes permitidos (`src/integration/origins.js`) y nunca con `"*"`. `/hub-prueba/` hace de hub para probarlo a mano. La guía completa para quien programe el hub está en [`docs/integracion.md`](docs/integracion.md).
- **Versión:** al no haber pie, la versión y el commit están en «Detalle técnico de la captura» (con la cámara encendida).
- **Cambiar los colores:** todos son variables de `src/styles/tokens.css`; el hub puede sobrescribirlas con `style.setProperty` sobre el `<html>` del iframe (misma origen en GitHub Pages).

## Parpadeos y curvas

- **EAR** (eye aspect ratio): apertura vertical media del ojo dividida por su ancho. Ronda 0,25–0,35 con el ojo abierto. Es la señal del detector de parpadeos.
- **Reposo**: la apertura habitual del ojo, estimada con los últimos 5 s (la línea discontinua de la curva). Hacen falta unos 1,5 s de señal antes de detectar.
- **Parpadeo**: cierre que baja del 75 % del reposo y vuelve a subir del 85 %. La **duración** se mide a media altura del cierre; la **completitud** es el cierre respecto al reposo. El EAR no llega a 0 con el ojo cerrado (el contorno del párpado tiene grosor): un cierre completo marca en torno al 70–80 %. Un cierre de más de 0,8 s se anota como «cierre», no como parpadeo.
- **Asimetría** = (I − D) / (I + D) sobre los últimos 10 s de la métrica elegida; I y D son siempre las del paciente.
- Todos los umbrales son provisionales y se ajustan con las pruebas en el móvil.

## Asistente de pruebas

Debajo del protocolo hay un asistente que guía por cada prueba y guarda las medidas en un JSON que se puede descargar y compartir. Ver [`docs/pruebas.md`](docs/pruebas.md). El plan por defecto es el de la **fase 4 (flujo óptico)**: las repeticiones van con pitidos (agudo = ahora, grave = suelta), así que se puede hacer con la cámara trasera sin mirar la pantalla. Más abajo, una **prueba de rendimiento** mide el coste del flujo óptico ([`docs/rendimiento.md`](docs/rendimiento.md)).

## Flujo óptico (en pruebas)
Mide el movimiento de la piel en cada región (párpado superior e inferior, ceja y canto externo) después de restar el de la cabeza, en distancias intercantales por segundo (DI/s): no depende de lo cerca que esté la cámara. Se ve en la curva **«Flujo»** (con selector de región y de compensación) y, con la casilla **«Campo de flujo»**, como flechas sobre el vídeo. Es lo que debería detectar contracciones más finas de las que mueven el EAR.
- Usa la **cámara trasera con prioridad «fps»**, con el móvil apoyado y a 30–40 cm, y la cara centrada.
- Luz estable y sin parpadeo: luz natural o una lámpara que no parpadee (los fluorescentes y algunos LED a 50 Hz dan flujo falso).
- La cabeza, lo más quieta posible: la compensación resta los movimientos suaves, no los bruscos.

## Desarrollo en la nube

Cómo probar la app de punta a punta sin móvil (cámara simulada con una cara, CSP real, repetición del detector con datos reales): [`docs/desarrollo.md`](docs/desarrollo.md). Planes de la fase 4 y de la 5: [`docs/plan-fase-4.md`](docs/plan-fase-4.md), [`docs/plan-fase-5.md`](docs/plan-fase-5.md).

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
