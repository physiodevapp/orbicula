# Integrar orbicula en un hub (PhysiQ)

Para quien programe el hub. orbicula funciona completa en su propia dirección; el hub la **incrusta en un iframe** y se comunica con ella por `postMessage`. **orbicula no importa nada del hub: es el hub el que depende de orbicula.**

> El formato de los resultados es otra interfaz pública, documentada aparte: [`schema.md`](schema.md) y [`orbicula-result.schema.json`](orbicula-result.schema.json).

## Lista de comprobación para el hub
1. Un iframe con `allow="camera; screen-wake-lock"` y la dirección **con `?host=physiq`**. Sin `camera` no se enciende la cámara; sin `screen-wake-lock` la pantalla puede apagarse a mitad de un protocolo.
2. Cargarlo **bajo demanda** (al abrir el satélite), como `wiki`: orbicula descarga el modelo de la cara y el WASM, y no conviene hacerlo al arrancar el hub.
3. Escuchar `orbicula:ready` y contestar con `orbicula:config`. Lo que el hub mande antes de que orbicula termine de cargar **se pierde**.
4. Guardar cada `orbicula:result` por su `sessionId` (el segundo resultado del mismo protocolo reemplaza al primero).
5. Avisar a orbicula cuando oculte o muestre el iframe (`PHYSIQ_SAT_HIDDEN` / `PHYSIQ_SAT_VISIBLE`), para que suelte la cámara.
6. Que el origen del hub esté en la lista de orígenes permitidos de orbicula (ver más abajo).
7. Un color propio para su tarjeta: el cyan de orbicula (`#5ec8d8`) se parece al de `balance` (`#22d3ee`).

## Cargar orbicula
```html
<iframe id="sat-orbicula" class="sat-frame" allow="camera; screen-wake-lock" hidden></iframe>
```
```js
SATS.orbicula = '/physiq/orbicula/?host=physiq';   // _showSat pone frame.src al abrirlo
```
- **Rutas relativas:** la build usa `base: './'`, así que la misma copia funciona en la raíz y en un subdirectorio como `/physiq/orbicula/`.
- **Mismo origen en GitHub Pages:** el hub y orbicula comparten origen (`https://physiodevapp.github.io`), así que los mensajes van a ese mismo origen.
- **Cabeceras:** GitHub Pages no sirve las de `public/_headers`. La privacidad no depende de ellas: la barrera del código (`src/privacy/`) bloquea cualquier llamada de red a otro origen.

### Qué cambia con `?host=physiq`
- **Sin cabecera ni pie:** el hub ya pone su marco. La versión y el commit siguen en «Detalle técnico de la captura» (con la cámara encendida).
- **Tema oscuro** (el hub es solo oscuro), salvo que el hub mande otra cosa con `orbicula:config`.
- **Tokens del hub:** el texto (`#e8edf2`, `#8aa4bc`) y el rojo de error (`#ef4444`). El fondo, las superficies, los bordes y las fuentes ya coincidían. **El acento sigue siendo el de orbicula**, porque cada satélite tiene el suyo.
- **No se guardan sesiones en el dispositivo** (en modo autónomo sí, ver el README): el hub recibe el resultado por mensaje y no debe quedar una copia en el almacenamiento del iframe.
- **Variables CSS:** todas están en `src/styles/tokens.css`. El hub puede sobrescribirlas con `iframe.contentDocument.documentElement.style.setProperty('--accent', '…')` (solo con el mismo origen).

## Mensajes
Todos son objetos con `type`. Las direcciones son desde el punto de vista del hub.

| Tipo | Dirección | Cuándo |
|---|---|---|
| `orbicula:ready` | orbicula → hub | Al cargar. |
| `orbicula:config` | hub → orbicula | Cuando el hub quiera (normalmente al recibir `ready`). |
| `orbicula:result` | orbicula → hub | Al terminar un protocolo. |
| `PHYSIQ_SAT_HIDDEN` | hub → orbicula | El hub oculta el iframe. |
| `PHYSIQ_SAT_VISIBLE` | hub → orbicula | El hub lo muestra. |

### `orbicula:ready`
```json
{ "type": "orbicula:ready", "payload": { "appVersion": "0.1.0", "schemaVersion": "1", "permissions": { "camera": true, "screenWakeLock": true } } }
```
- `schemaVersion` es la del JSON de resultados que llegará.
- `permissions` dice qué le ha concedido el hub al iframe. Si falta uno (`false`), el hub lo ve aquí en vez de descubrirlo con una cámara que no enciende.

### `orbicula:config`
```json
{ "type": "orbicula:config", "payload": { "theme": "dark", "lang": "es", "protocol": { "restSec": 30, "naturalSec": 60, "reps": 3 } } }
```
| Campo | Valores | Efecto |
|---|---|---|
| `theme` | `light`, `dark`, `auto` | `auto` sigue al sistema. |
| `lang` | `es` | De momento solo español; se guarda para cuando haya más. |
| `protocol.restSec` | 30, 45, 60 | Duración del reposo (calibración). |
| `protocol.naturalSec` | 30, 60, 90 | Duración del parpadeo espontáneo. |
| `protocol.reps` | 3, 4, 5 | Repeticiones de cada gesto. |

- **Lo válido se aplica y lo malo se ignora**, cada valor por separado. Los motivos salen en la consola de orbicula (`[orbicula] configuración del hub: no se ha aplicado …`). Un campo desconocido también se ignora.
- **Las duraciones del protocolo solo se cambian si no hay uno en marcha.** Si lo hay, se ignoran (vuelve a mandarlas después).
- Todos los campos son opcionales; se puede mandar solo `{ "theme": "dark" }`.

### `orbicula:result`
```json
{ "type": "orbicula:result", "sessionId": "2026-11-14T09:38:36.193Z", "payload": { "app": "orbicula", "schemaVersion": "1", "…": "…" } }
```
- **`payload`** es el JSON público completo, tal como lo documenta [`schema.md`](schema.md). Un protocolo de 4 minutos ocupa unos 350 KB; viaja sin problema.
- **`sessionId`** es el inicio del protocolo. Va **fuera** del JSON.
- **Cuándo se manda:**
  - al terminar el protocolo en directo (`capture.analysis: "live"`);
  - si se grabó el vídeo del protocolo, un **segundo** resultado con el mismo `sessionId` al acabar el análisis fotograma a fotograma, más sensible (`capture.analysis: "frame-by-frame"`). **El hub debe reemplazar el primero por el segundo.**
  - También cuando el clínico pulsa «Enviar al hub» (por ejemplo, tras corregir el código): mismo `sessionId`, mismos datos.
- **No se manda** el análisis de un vídeo suelto cargado desde un archivo: no es una sesión del hub.
- **El código del participante** va en `payload.participantCode`. Un código que no cumpla `^[A-Za-z0-9_-]{1,24}$` **no viaja** (sale `null`), para que no se cuele un nombre.

### Avisos del hub: `PHYSIQ_SAT_HIDDEN` y `PHYSIQ_SAT_VISIBLE`
Son los que el hub ya manda a sus satélites; orbicula los reconoce por su texto, y solo de un origen permitido.
- **Al ocultarse:** se apaga la cámara y se detiene el protocolo en marcha, **conservando lo hecho** (como el botón «Detener»): con al menos un paso completado queda «Sesión detenida» con «Retomar sesión»; sin ninguno, vuelve a «Empezar». Los indicadores dicen «cámara apagada». **Un análisis de vídeo ya cargado sigue**, porque no usa la cámara.
- **Al mostrarse:** si la cámara la había apagado el hub, **se reabre sola** con la misma configuración, como al volver a la pestaña. Una sesión detenida no se reanuda sola.
- **Importante:** el hub tiene que **ocultar el iframe de verdad** (atributo `hidden`) además de avisar. Un iframe de otro origen que queda fuera de la pantalla se frena y no procesa el vídeo.

## Orígenes y privacidad
El resultado es un dato clínico. Las reglas, todas comprobadas por tests:
- **Lo que sale va solo al origen del padre**, y solo si está en la lista de permitidos. **Nunca con `"*"`** (un test falla si algún `postMessage` lo usa).
- **Lo que entra se acepta solo si viene del marco padre** (`event.source`) **y de un origen permitido**. Una vez conocido el origen del padre, otro origen permitido ya no vale.
- **Si el padre no está en la lista, orbicula no manda ni acepta nada.**
- **Fuera de un iframe** no manda ni escucha nada.
- **El origen del padre** se averigua, por este orden, con `location.ancestorOrigins` (Chrome), `document.referrer` (si el navegador no tiene lo anterior) y, si tampoco hay, con el origen del primer mensaje válido; lo que haya que enviar espera hasta entonces.
- **La lista** (`src/integration/origins.js`) tiene, de partida, el propio origen de orbicula y `https://physiodevapp.github.io`. **Se amplía al construir**, con la variable `VITE_ORBICULA_ORIGINS` (orígenes separados por comas), **nunca por la dirección** (`?allow=…`): quien incrusta la página elige su dirección, así que se saltaría la lista.
- **El resto de la privacidad** no cambia: ningún dato del paciente sale del dispositivo; la CSP (`connect-src 'self'`) y la barrera de `src/privacy/` bloquean cualquier llamada a otro origen, incluida la de registro de uso de MediaPipe.

## Ejemplo del lado del hub
```js
const SRC = '/physiq/orbicula/?host=physiq';
const ORIGIN = location.origin;                       // mismo origen en GitHub Pages
const frame = document.getElementById('sat-orbicula');
const results = new Map();                            // sessionId → JSON público

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== ORIGIN) return;
  const m = e.data;
  if (m?.type === 'orbicula:ready') {
    const p = m.payload.permissions ?? {};
    if (!p.camera || !p.screenWakeLock) console.warn('Falta un permiso en el iframe de orbicula', p);
    frame.contentWindow.postMessage(
      { type: 'orbicula:config', payload: { theme: 'dark', lang: 'es', protocol: { restSec: 30, naturalSec: 60, reps: 3 } } },
      ORIGIN,
    );
  } else if (m?.type === 'orbicula:result') {
    results.set(m.sessionId, m.payload);              // el segundo resultado reemplaza al primero
  }
});

function openOrbicula() {
  if (!frame.src) frame.src = SRC;                    // bajo demanda
  frame.hidden = false;
  frame.contentWindow?.postMessage({ type: 'PHYSIQ_SAT_VISIBLE' }, ORIGIN);
}
function closeOrbicula() {
  frame.contentWindow?.postMessage({ type: 'PHYSIQ_SAT_HIDDEN' }, ORIGIN);
  frame.hidden = true;
}
```

## Cómo probarlo
- **A mano:** `/hub-prueba/` hace de hub. Carga orbicula con `?host=physiq`, enseña los mensajes que se cruzan, deja mandar la configuración y simular ocultar y mostrar, y enseña el último resultado (con un botón para descargarlo). Acepta `?orbicula=<dirección>` para cargar otra orbicula.
- **Automática:** `node scripts/dev/check-hub.cjs` levanta un «hub» en otro origen y comprueba, con y sin ese origen permitido: que el origen no permitido no recibe nada y su configuración se ignora; `ready`, `config`, el hub que oculta orbicula a mitad de un protocolo, el resultado (válido contra el esquema), el reenvío y que un código que parece un nombre no viaja. Ver [`desarrollo.md`](desarrollo.md).
- **Sin navegador:** `tests/integration.test.js` (orígenes, configuración, mensajes y puente con ventanas simuladas).

## Compatibilidad
- **Mensajes:** añadir un campo a un mensaje o un mensaje nuevo no rompe a nadie; quien recibe debe **ignorar lo que no conozca**. Quitar o renombrar un campo, o cambiar su significado, es un cambio incompatible y se anotará en el CHANGELOG.
- **Resultados:** `payload.schemaVersion` sube si algo del JSON rompe la compatibilidad (ver [`schema.md`](schema.md)).
- **El hub depende de orbicula, no al revés:** orbicula no conoce al hub más allá del texto de los dos avisos de arriba y de su origen en la lista.

## Limitaciones conocidas
- **Un iframe de otro origen fuera de la pantalla se frena** y no procesa el vídeo; ocúltalo con `hidden`.
- **Sin `location.ancestorOrigins` ni `document.referrer`** (algunos navegadores, o un hub con `referrerpolicy="no-referrer"`), orbicula no manda `ready` hasta recibir un primer mensaje válido del hub.
- **El resultado se manda una vez** al terminar. Si el hub no estaba escuchando, no se reenvía solo: el clínico puede pulsar «Enviar al hub».
- **Un hub con otro origen** distinto del de orbicula tiene que estar en `VITE_ORBICULA_ORIGINS` al construir.
