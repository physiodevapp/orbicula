import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeFace } from './helpers/face.js';
import { buildRois } from '../src/roi/geometry.js';
import { roiCore, stripFromRois, needsNewStrip, workingSize, STRIP_MARGIN } from '../src/flow/strip.js';
import { denseStats, sparseStats, gridPoints, normalizeCoeffs } from '../src/flow/stats.js';
import { FLOW_CONFIGS, DEFAULT_FLOW } from '../src/flow/config.js';
import { patchOpenCv } from '../scripts/opencv-patch.mjs';

const FRAME = { width: 720, height: 1280 };
const roisOf = (lm, frame = FRAME) => buildRois(lm, frame);
const shift = (lm, dx, dy) => lm.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
const scaleAbout = (lm, k) => lm.map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * k, y: 0.45 + (p.y - 0.45) * k }));
const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

describe('franja periocular', () => {
  const rois = roisOf(makeFace());

  it('abarca todas las ROI de los dos lados y la referencia, con margen', () => {
    const s = stripFromRois(rois, FRAME);
    const core = roiCore(rois);
    expect(contains(s, core)).toBe(true);
    for (const side of ['left', 'right']) for (const n of ['upperLid', 'lowerLid', 'brow', 'canthus']) expect(contains(s, rois[side][n].box)).toBe(true);
    expect(contains(s, rois.reference.box)).toBe(true);
    const m = STRIP_MARGIN * rois.meta.intercanthal;
    expect(core.x - s.x).toBeGreaterThanOrEqual(m - 1);
    expect(s.x + s.w - (core.x + core.w)).toBeGreaterThanOrEqual(m - 2);
  });

  it('tiene coordenadas enteras, lados pares y no se sale del frame', () => {
    const s = stripFromRois(roisOf(shift(makeFace(), -0.3, -0.35)), FRAME);
    for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true);
    expect(s.w % 2 + (s.h % 2)).toBe(0);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
    expect(s.x + s.w).toBeLessThanOrEqual(FRAME.width);
  });

  it('no se recoloca con un movimiento pequeño de la cara, sí cuando se sale', () => {
    const s = stripFromRois(rois, FRAME);
    expect(needsNewStrip(null, rois)).toBe(true);
    expect(needsNewStrip(s, rois)).toBe(false);
    expect(needsNewStrip(s, roisOf(shift(makeFace(), 0.005, 0.004)))).toBe(false); // ~3–5 px
    expect(needsNewStrip(s, roisOf(shift(makeFace(), 0.08, 0)))).toBe(true); // ~58 px
  });

  it('se recoloca si la cara se aleja mucho (las ROI ocupan poco de la franja)', () => {
    const s = stripFromRois(rois, FRAME);
    expect(needsNewStrip(s, roisOf(scaleAbout(makeFace(), 0.95)))).toBe(false);
    expect(needsNewStrip(s, roisOf(scaleAbout(makeFace(), 0.5)))).toBe(true);
  });

  it('una cara fuera del frame no da franja', () => {
    expect(stripFromRois(roisOf(shift(makeFace(), 2, 0)), FRAME)).toBeNull();
  });
});

describe('tamaño de trabajo', () => {
  const strip = { x: 0, y: 0, w: 1300, h: 420 };
  it('limita el ancho y conserva la proporción, con lados pares', () => {
    const w = workingSize(strip, 320);
    expect(w.width).toBe(320);
    expect(w.height % 2).toBe(0);
    expect(w.height).toBeCloseTo((420 * 320) / 1300, -1);
    expect(w.scale).toBeCloseTo(320 / 1300, 5);
  });
  it('no amplía una franja pequeña y «sin reducir» tiene un tope', () => {
    expect(workingSize({ x: 0, y: 0, w: 300, h: 100 }, 640)).toEqual({ width: 300, height: 100, scale: 1 });
    expect(workingSize(strip, 0).width).toBe(1280);
    expect(workingSize({ x: 0, y: 0, w: 460, h: 150 }, 0)).toEqual({ width: 460, height: 150, scale: 1 });
  });
});

describe('resumen del flujo', () => {
  it('flujo denso: medias y energía (media de |v|²)', () => {
    const f = new Float32Array([1, 0, 3, 0, 0, -2, 0, 2]);
    const s = denseStats(f);
    expect(s.n).toBe(4);
    expect(s.dx).toBeCloseTo(1, 6);
    expect(s.dy).toBeCloseTo(0, 6);
    expect(s.energy).toBeCloseTo((1 + 9 + 4 + 4) / 4, 6);
    expect(denseStats(new Float32Array(0)).energy).toBe(0);
  });
  it('rejilla de Lucas-Kanade: ignora los puntos perdidos', () => {
    const p0 = new Float32Array([10, 10, 20, 10, 30, 10]);
    const p1 = new Float32Array([11, 10, 99, 99, 31, 12]);
    const s = sparseStats(p0, p1, new Uint8Array([1, 0, 1]));
    expect(s.n).toBe(2);
    expect(s.dx).toBeCloseTo(1, 6);
    expect(s.dy).toBeCloseTo(1, 6);
    expect(s.energy).toBeCloseTo((1 + 5) / 2, 6);
  });
  it('rejilla: puntos dentro de la imagen, cada `step` px', () => {
    const g = gridPoints(32, 16, 8);
    expect(g.length / 2).toBe(4 * 2);
    expect(Array.from(g.slice(0, 4))).toEqual([4, 4, 12, 4]);
    for (let i = 0; i < g.length; i += 2) expect(g[i] < 32 && g[i + 1] < 16).toBe(true);
  });
  it('normalización del brillo: media 128 y desviación 40; imagen plana sin dividir por cero', () => {
    const { alpha, beta } = normalizeCoeffs(100, 20);
    expect(alpha * 100 + beta).toBeCloseTo(128, 6);
    expect(alpha * 120 + beta - (alpha * 100 + beta)).toBeCloseTo(40, 6);
    expect(normalizeCoeffs(90, 0)).toEqual({ alpha: 1, beta: 38 });
  });
});

describe('configuraciones del flujo', () => {
  it('la configuración por defecto existe y todas tienen método y clave coherentes', () => {
    expect(FLOW_CONFIGS[DEFAULT_FLOW].method).toBe('farneback');
    for (const [k, c] of Object.entries(FLOW_CONFIGS)) {
      expect(c.key).toBe(k);
      expect(['none', 'farneback', 'lk']).toContain(c.method);
    }
  });
});

describe('parche de OpenCV.js (sin eval, para la CSP)', () => {
  const src = readFileSync('node_modules/@techstark/opencv-js/dist/opencv.js', 'latin1');
  it('quita las llamadas a new Function del código de embind', () => {
    const out = patchOpenCv(src);
    // Comparaciones booleanas: un toContain sobre 13 MB vuelca el archivo entero si falla.
    expect(out.includes('let invokerFactory=createJsInvoker(')).toBe(false);
    expect(out.includes('new Function(Object.keys(captures)')).toBe(false);
    expect(out.split('new Function').length - 1).toBe(1); // solo la definición, que ya no se llama
  });
  it('falla si no reconoce el código (otra versión)', () => {
    expect(() => patchOpenCv('var x=1;')).toThrow(/no se reconoce/);
  });
});
