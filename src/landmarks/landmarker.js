// Face Landmarker de MediaPipe: modelo y WASM servidos desde el propio sitio.
// Lo usan el worker y el respaldo en el hilo principal, así que no toca `document`
// (las rutas llegan ya absolutas: dentro de un worker las relativas se resolverían contra
// el script del worker, no contra la página).
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const MODEL_FILE = 'modelos/face_landmarker_float16_1.task'; // la versión va en el nombre (caché «immutable»)

/** Rutas absolutas de los archivos de MediaPipe. Solo en el hilo principal. */
export function assetUrls() {
  return {
    wasmDir: new URL(`mediapipe/${__MEDIAPIPE_VERSION__}`, document.baseURI).href,
    modelUrl: new URL(MODEL_FILE, document.baseURI).href,
  };
}

/**
 * Crea el Face Landmarker. Intenta la GPU y, si falla, la CPU (o el orden de `delegates`: un segundo análisis
 * en paralelo puede ir a la CPU para no competir con el primero por la GPU).
 * @param {{wasmDir: string, modelUrl: string, blendshapes?: boolean, delegates?: ('GPU'|'CPU')[]}} opts
 */
export async function createLandmarker({ wasmDir, modelUrl, blendshapes = true, delegates = ['GPU', 'CPU'] }) {
  const fileset = await FilesetResolver.forVisionTasks(wasmDir);
  let lastError;
  for (const delegate of delegates) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: blendshapes,
        // La matriz de transformación facial se activará en la fase 4 si compensa mejor la cabeza.
        outputFacialTransformationMatrixes: false,
      });
      return { landmarker, delegate };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
