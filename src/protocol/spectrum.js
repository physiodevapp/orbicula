// Pico espectral (fase 5c): actividad rítmica fina de los párpados, como las mioquimias.
// Sin DOM. Método de Welch sobre una señal remuestreada a ritmo fijo.
//
// Señal: velocidad vertical del párpado (componente «hacia abajo» del flujo, compensado con el dorso
// nasal, DI/s). En los pares congelados (ojo tapado) y sin dato, vale 0: un parpadeo no puede parecer
// una oscilación. Se remuestrea a FS = 20 Hz (con el ajuste por calor el flujo baja a 20 pares/s), así
// que se ve hasta 10 Hz; se analiza la banda 0,5–8 Hz.
//
// Resultado: frecuencia del pico, su prominencia (dB sobre la mediana de la banda) y su constancia (qué
// fracción de las ventanas tiene el pico en ±0,5 Hz del global). «Actividad rítmica» si la prominencia
// pasa de RHYTHM.minProminenceDb y es constante. Umbrales PROVISIONALES: no hay pacientes con mioquimias
// para validarlos; se comprueban con señales sintéticas (tests/spectrum.test.js).

export const FS = 20;
export const SPECTRUM = { windowS: 4, overlap: 0.5, fMin: 0.5, fMax: 8 };
export const RHYTHM = { minProminenceDb: 10, minConstancy: 0.5, nearHz: 0.5 };

/**
 * Remuestrea una serie irregular a FS Hz (media de las muestras de cada intervalo; los huecos, 0).
 * @param {number[]} t ms
 * @param {number[]} v
 */
export function resample(t, v, fs = FS) {
  if (!t.length) return [];
  const step = 1000 / fs;
  const n = Math.floor((t.at(-1) - t[0]) / step) + 1;
  const sum = new Float64Array(n);
  const cnt = new Uint16Array(n);
  for (let i = 0; i < t.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    const k = Math.min(n - 1, Math.floor((t[i] - t[0]) / step));
    sum[k] += v[i];
    cnt[k]++;
  }
  return Array.from(sum, (s, k) => (cnt[k] ? s / cnt[k] : 0));
}

/** Densidad espectral por Welch (ventanas de Hann, media de periodogramas). */
export function welch(x, fs = FS, { windowS = SPECTRUM.windowS, overlap = SPECTRUM.overlap } = {}) {
  const n = Math.round(windowS * fs);
  if (x.length < n) return null;
  const hop = Math.max(1, Math.round(n * (1 - overlap)));
  const w = Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const freqs = Array.from({ length: Math.floor(n / 2) + 1 }, (_, k) => (k * fs) / n);
  const segments = [];
  for (let s = 0; s + n <= x.length; s += hop) {
    const seg = x.slice(s, s + n);
    const mean = seg.reduce((a, b) => a + b, 0) / n;
    const p = freqs.map((_, k) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const y = (seg[i] - mean) * w[i];
        const a = (2 * Math.PI * k * i) / n;
        re += y * Math.cos(a);
        im -= y * Math.sin(a);
      }
      return re * re + im * im;
    });
    segments.push(p);
  }
  const psd = freqs.map((_, k) => segments.reduce((a, p) => a + p[k], 0) / segments.length);
  return { freqs, psd, segments };
}

const median = (a) => {
  const v = [...a].sort((p, q) => p - q);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * Pico espectral de una serie irregular (t en ms).
 * @returns {null | {freq:number, prominenceDb:number, constancy:number, windows:number, rhythmic:boolean}}
 */
export function spectralPeak(t, v, { fs = FS, ...opt } = {}) {
  const o = { ...SPECTRUM, ...RHYTHM, ...opt };
  const w = welch(resample(t, v, fs), fs, o);
  if (!w) return null;
  const band = w.freqs.map((f, k) => k).filter((k) => w.freqs[k] >= o.fMin && w.freqs[k] <= o.fMax);
  const argmax = (p) => band.reduce((b, k) => (p[k] > p[b] ? k : b), band[0]);
  const k = argmax(w.psd);
  const floor = median(band.map((j) => w.psd[j]));
  const prominenceDb = floor > 0 ? 10 * Math.log10(w.psd[k] / floor) : 0;
  const freq = w.freqs[k];
  const constancy = w.segments.filter((p) => Math.abs(w.freqs[argmax(p)] - freq) <= o.nearHz).length / w.segments.length;
  return {
    freq: Number(freq.toFixed(2)),
    prominenceDb: Number(prominenceDb.toFixed(1)),
    constancy: Number(constancy.toFixed(2)),
    windows: w.segments.length,
    rhythmic: prominenceDb >= o.minProminenceDb && constancy >= o.minConstancy,
  };
}
