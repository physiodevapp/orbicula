// Face Landmarker de MediaPipe: modelo y WASM servidos desde el propio sitio.
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// Cambiar de modelo = cambiar el nombre del archivo (la caché es «immutable», ver _headers).
export const MODEL_URL = './modelos/face_landmarker_float16_1.task';
const WASM_DIR = `./mediapipe/${__MEDIAPIPE_VERSION__}`;

const OPTIONS = {
  runningMode: 'VIDEO',
  numFaces: 1,
  outputFaceBlendshapes: true,
  // La matriz de transformación facial se activará en la fase 4 si compensa mejor la cabeza.
  outputFacialTransformationMatrixes: false,
};

/** Crea el Face Landmarker. Intenta la GPU y, si falla, la CPU. */
export async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  let lastError;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        ...OPTIONS,
      });
      return { landmarker, delegate };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
