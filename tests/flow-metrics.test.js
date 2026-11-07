import { describe, it, expect } from 'vitest';
import { makeFace } from './helpers/face.js';
import { buildRois } from '../src/roi/geometry.js';
import { rasterize, moments, residual, translationOf, affineMotion, roiMetrics, ZERO, ROI_KEYS, MOMENTS, toWork } from '../src/flow/metrics.js';
import { FlowProcessor, MAX_WAIT_MS } from '../src/flow/processor.js';

const FRAME = { width: 720, height: 1280 };

// Campo de flujo sintético: f(x, y) para cada píxel de una imagen w×h (centros en +0,5).
function field(w, h, fn) {
  const out = new Float32Array(2 * w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [u, v] = fn(x + 0.5, y + 0.5);
    out[2 * (y * w + x)] = u;
    out[2 * (y * w + x) + 1] = v;
  }
  return out;
}
const all = (w, h) => Int32Array.from({ length: w * h }, (_, i) => i);

describe('máscaras de las ROI', () => {
  it('un rectángulo cubre exactamente sus píxeles', () => {
    const idx = rasterize([{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 4 }, { x: 2, y: 4 }], 10, 10);
    expect(idx.length).toBe(4 * 3);
    expect([...idx].every((p) => p % 10 >= 2 && p % 10 < 6 && Math.floor(p / 10) >= 1 && Math.floor(p / 10) < 4)).toBe(true);
  });
  it('un triángulo tiene la mitad de área que su caja, y lo que se sale de la imagen se recorta', () => {
    expect(rasterize([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 }], 100, 100).length).toBeCloseTo(800, -2);
    const cut = rasterize([{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], 20, 20);
    expect(cut.length).toBe(25);
    expect(rasterize([{ x: 0, y: 0 }], 10, 10).length).toBe(0);
  });
  it('los polígonos pasan a coordenadas de la franja con su escala', () => {
    expect(toWork([{ x: 110, y: 220 }], { x: 100, y: 200, w: 400, h: 100 }, 0.5)).toEqual([{ x: 5, y: 10 }]);
  });
});

describe('momentos y residuo', () => {
  const W = 40, H = 30;
  it('sin compensar: flujo medio y energía = media de |f|²', () => {
    const f = field(W, H, (x) => [x / 10, 1]);
    const r = residual(moments(f, W, all(W, H)), ZERO);
    let e = 0, u = 0;
    for (let i = 0; i < W * H; i++) { e += f[2 * i] ** 2 + f[2 * i + 1] ** 2; u += f[2 * i]; }
    expect(r.energy).toBeCloseTo(e / (W * H), 6);
    expect(r.du).toBeCloseTo(u / (W * H), 6);
    expect(r.dv).toBeCloseTo(1, 6);
  });
  it('restar el movimiento afín exacto deja energía 0, para cualquier afín', () => {
    const g = { a: 0.01, b: -0.02, c: 0.7, d: 0.015, e: 0.005, f: -1.2 };
    const f = field(W, H, (x, y) => [g.a * x + g.b * y + g.c, g.d * x + g.e * y + g.f]);
    const r = residual(moments(f, W, all(W, H)), g);
    expect(r.energy).toBeCloseTo(0, 8);
    expect(r.du).toBeCloseTo(0, 8);
  });
  it('el residuo con momentos coincide con calcularlo píxel a píxel', () => {
    const g = { a: 0.02, b: 0.01, c: -0.3, d: -0.01, e: 0.03, f: 0.4 };
    const f = field(W, H, (x, y) => [Math.sin(x / 3), Math.cos(y / 4) + 0.2]);
    const idx = rasterize([{ x: 3, y: 2 }, { x: 35, y: 6 }, { x: 20, y: 27 }], W, H);
    const r = residual(moments(f, W, idx), g);
    let e = 0;
    for (const p of idx) {
      const x = (p % W) + 0.5, y = Math.floor(p / W) + 0.5;
      e += (f[2 * p] - (g.a * x + g.b * y + g.c)) ** 2 + (f[2 * p + 1] - (g.d * x + g.e * y + g.f)) ** 2;
    }
    expect(r.energy).toBeCloseTo(e / idx.length, 6);
  });
  it('la referencia es el flujo medio de su ROI; una ROI vacía no da nada', () => {
    const f = field(W, H, () => [2, -1]);
    expect(translationOf(moments(f, W, all(W, H)))).toMatchObject({ c: 2, f: -1, a: 0 });
    expect(translationOf(new Float64Array(MOMENTS))).toBeNull();
    expect(residual(new Float64Array(MOMENTS), ZERO)).toBeNull();
  });
});

describe('ajuste afín de la postura', () => {
  const pts = [{ x: 10, y: 10 }, { x: 90, y: 12 }, { x: 50, y: 80 }, { x: 48, y: 40 }, { x: 52, y: 60 }];
  it('recupera una traslación y una rotación pequeña', () => {
    const th = 0.02;
    const to = pts.map(({ x, y }) => ({ x: Math.cos(th) * x - Math.sin(th) * y + 3, y: Math.sin(th) * x + Math.cos(th) * y - 2 }));
    const g = affineMotion(pts, to);
    for (let i = 0; i < pts.length; i++) {
      expect(g.a * pts[i].x + g.b * pts[i].y + g.c).toBeCloseTo(to[i].x - pts[i].x, 6);
      expect(g.d * pts[i].x + g.e * pts[i].y + g.f).toBeCloseTo(to[i].y - pts[i].y, 6);
    }
  });
  it('con puntos alineados o insuficientes no da movimiento', () => {
    expect(affineMotion(pts.slice(0, 2), pts.slice(0, 2))).toBeNull();
    const line = [0, 1, 2, 3].map((k) => ({ x: k, y: 2 * k }));
    expect(affineMotion(line, line)).toBeNull();
  });
});

describe('métricas normalizadas y signos por lado', () => {
  it('velocidad en distancias intercantales por segundo, independiente de la escala y de los fps', () => {
    const axes = { temple: { x: 1, y: 0 }, down: { x: 0, y: 1 } };
    // 2 px de trabajo hacia abajo en 33,3 ms con una distancia intercantal de 60 px = 1 DI/s.
    const a = roiMetrics({ n: 10, du: 0, dv: 2, energy: 4 }, axes, 60, 1000 / 30);
    expect(a.down).toBeCloseTo(1, 6);
    expect(a.energy).toBeCloseTo(1, 6);
    // El doble de resolución y el doble de fps: el mismo movimiento real da lo mismo.
    const b = roiMetrics({ n: 10, du: 0, dv: 2, energy: 4 }, axes, 120, 1000 / 60);
    expect(b.down).toBeCloseTo(1, 6);
  });

  for (const mirrored of [false, true]) {
    it(`«hacia la sien» es positivo hacia fuera en los dos lados ${mirrored ? 'con' : 'sin'} espejo`, () => {
      let lm = makeFace();
      if (mirrored) lm = lm.map((p) => ({ ...p, x: 1 - p.x }));
      const rois = buildRois(lm, FRAME, { frameMirrored: mirrored });
      const center = (s) => rois[s].upperLid.box.x + rois[s].upperLid.box.w / 2;
      for (const side of ['left', 'right']) {
        const other = side === 'left' ? 'right' : 'left';
        // La sien de un ojo está en la dirección contraria al otro ojo.
        const away = Math.sign(center(side) - center(other));
        expect(Math.sign(rois[side].axes.temple.x)).toBe(away);
        expect(rois[side].axes.down.y).toBeGreaterThan(0.9); // hacia abajo en la imagen
        const m = roiMetrics({ n: 1, du: away * 3, dv: 0, energy: 9 }, rois[side].axes, 60, 33);
        expect(m.temple).toBeGreaterThan(0);
      }
    });
  }
});

describe('iris', () => {
  it('posición del iris normalizada: centro ≈ 0,5; hacia abajo positivo; asignado al ojo más cercano', () => {
    const lm = makeFace();
    // Ojo derecho del mallado: comisuras en x 0,3 (externa) y 0,43 (interna), y = 0,4.
    lm[468] = { x: 0.365, y: 0.4, z: 0 };
    lm[473] = { x: 0.62, y: 0.41, z: 0 }; // ojo izquierdo del mallado, desplazado hacia dentro y abajo
    const r = buildRois(lm, FRAME);
    expect(r.right.iris.h).toBeCloseTo(0.5, 2);
    expect(r.right.iris.v).toBeCloseTo(0, 2);
    expect(r.left.iris.h).toBeLessThan(0.5); // más cerca de la comisura interna (0,57)
    expect(r.left.iris.v).toBeGreaterThan(0);
  });
  it('sin landmarks del iris no hay posición', () => {
    const r = buildRois(makeFace().slice(0, 468), FRAME);
    expect(r.left.iris).toBeNull();
  });
});

// ── Procesador: flujo sintético por ROI con una cabeza que se mueve ────────────────────────────
describe('compensación del movimiento de la cabeza', () => {
  const STRIP = { x: 100, y: 400, w: 520, h: 240 };
  const SCALE = 0.5;
  const W = STRIP.w * SCALE, H = STRIP.h * SCALE;

  // Resultado de análisis con la cara desplazada (dx, dy) píxeles del frame.
  const faceAt = (dx, dy) => {
    const lm = makeFace().map((p) => ({ ...p, x: p.x + dx / FRAME.width, y: p.y + dy / FRAME.height }));
    return { face: true, frame: FRAME, rois: buildRois(lm, FRAME) };
  };
  // Momentos de cada ROI para un campo de flujo de trabajo `fn`, con las máscaras de la cara r.
  const momentsFor = (r, fn) => {
    const f = field(W, H, fn);
    const out = new Float64Array(ROI_KEYS.length * MOMENTS);
    ROI_KEYS.forEach((key, k) => {
      const [side, name] = key.split('.');
      const poly = key === 'reference' ? r.rois.reference.polygon : r.rois[side][name].polygon;
      out.set(moments(f, W, rasterize(toWork(poly, STRIP, SCALE), W, H)), k * MOMENTS);
    });
    return out;
  };

  it('un cabeceo (traslación de toda la cara) se anula con la referencia y con la postura', () => {
    const out = [];
    const p = new FlowProcessor((s) => out.push(s));
    // La cabeza baja 6 px del frame cada 33 ms (3 px de trabajo).
    p.pushFace(0, faceAt(0, 0));
    p.pushFace(33, faceAt(0, 6));
    p.pushFlow({ t: 33, dt: 33, moments: momentsFor(faceAt(0, 6), () => [0, 3]), strip: STRIP, scale: SCALE });
    expect(out).toHaveLength(1);
    const lid = out[0].left.upperLid;
    expect(lid.none.energy).toBeGreaterThan(1);
    expect(lid.reference.energy).toBeCloseTo(0, 6);
    expect(lid.pose.energy).toBeCloseTo(0, 4);
    expect(lid.none.down).toBeGreaterThan(0); // sin compensar, parece que el párpado baja
    expect(out[0].head.pose.v).toBeCloseTo(out[0].head.reference.v, 4);
  });

  it('un párpado que baja con la cabeza quieta se ve en su ROI y no en las demás', () => {
    const out = [];
    const p = new FlowProcessor((s) => out.push(s));
    const r = faceAt(0, 0);
    p.pushFace(0, r);
    p.pushFace(33, r);
    const lidPoly = toWork(r.rois.right.upperLid.polygon, STRIP, SCALE);
    const lidIdx = new Set(rasterize(lidPoly, W, H));
    const fn = (x, y) => (lidIdx.has(Math.floor(y) * W + Math.floor(x)) ? [0, 1] : [0, 0]);
    p.pushFlow({ t: 33, dt: 33, moments: momentsFor(r, fn), strip: STRIP, scale: SCALE });
    const s = out[0];
    for (const v of ['none', 'reference', 'pose']) {
      expect(s.right.upperLid[v].energy).toBeGreaterThan(0.1);
      expect(s.right.upperLid[v].down).toBeGreaterThan(0);
      expect(s.left.upperLid[v].energy).toBeCloseTo(0, 6);
      expect(s.right.brow[v].energy).toBeLessThan(s.right.upperLid[v].energy / 3);
    }
  });

  it('el par espera a la postura del frame siguiente; si no llega, sale sin «postura»', () => {
    const out = [];
    const p = new FlowProcessor((s) => out.push(s));
    const r = faceAt(0, 0);
    p.pushFace(0, r);
    p.pushFlow({ t: 33, dt: 33, moments: momentsFor(r, () => [0, 0]), strip: STRIP, scale: SCALE });
    expect(out).toHaveLength(0); // aún no hay análisis posterior a t = 33
    p.pushFace(40, r);
    expect(out).toHaveLength(1);
    expect(out[0].left.upperLid.pose).not.toBeNull();
    // Otro par sin análisis posterior: sale cuando llega un par mucho más nuevo.
    p.pushFlow({ t: 80, dt: 40, moments: momentsFor(r, () => [0, 0]), strip: STRIP, scale: SCALE });
    p.pushFlow({ t: 80 + MAX_WAIT_MS + 10, dt: 40, moments: momentsFor(r, () => [0, 0]), strip: STRIP, scale: SCALE });
    expect(out).toHaveLength(2);
    expect(out[1].left.upperLid.pose).toBeNull();
    expect(out[1].left.upperLid.reference).not.toBeNull();
    p.flush();
    expect(out).toHaveLength(3);
  });
});

describe('cierre por flujo', () => {
  const W = 260, H = 120, STRIP = { x: 100, y: 400, w: 520, h: 240 }, SCALE = 0.5;
  const faceRes = () => ({ face: true, frame: FRAME, rois: buildRois(makeFace(), FRAME) });
  const momentsFor = (r, fn) => {
    const f = field(W, H, fn);
    const out = new Float64Array(ROI_KEYS.length * MOMENTS);
    ROI_KEYS.forEach((key, k) => {
      const [side, name] = key.split('.');
      const poly = key === 'reference' ? r.rois.reference.polygon : r.rois[side][name].polygon;
      out.set(moments(f, W, rasterize(toWork(poly, STRIP, SCALE), W, H)), k * MOMENTS);
    });
    return out;
  };
  it('sube si el párpado superior baja, vuelve a 0 con la fuga y no cambia con la cabeza', async () => {
    const { CLOSURE_TAU_MS } = await import('../src/flow/processor.js');
    const out = [];
    const p = new FlowProcessor((s) => out.push(s));
    const r = faceRes();
    const lid = new Set(rasterize(toWork(r.rois.right.upperLid.polygon, STRIP, SCALE), W, H));
    let t = 0;
    p.pushFace(t, r);
    // 10 pares: el párpado superior derecho baja 0,3 px de trabajo por par.
    for (let k = 0; k < 10; k++) {
      t += 33;
      p.pushFace(t, r);
      p.pushFlow({ t, dt: 33, moments: momentsFor(r, (x, y) => (lid.has(Math.floor(y) * W + Math.floor(x)) ? [0, 0.3] : [0, 0])), strip: STRIP, scale: SCALE });
    }
    const peak = out.at(-1).closure.right;
    expect(peak).toBeGreaterThan(0);
    expect(out.at(-1).closure.left).toBeCloseTo(0, 6);
    // Cabeza que baja entera: con el dorso nasal no suma cierre; tras 5 s el cierre ha caído a ~1/e.
    for (let k = 0; k < 150; k++) {
      t += 33;
      p.pushFace(t, r);
      p.pushFlow({ t, dt: 33, moments: momentsFor(r, () => [0, 0.5]), strip: STRIP, scale: SCALE });
    }
    expect(out.at(-1).closure.right).toBeCloseTo(peak * Math.exp(-(150 * 33) / CLOSURE_TAU_MS), 3);
    expect(out.at(-1).closure.left).toBeCloseTo(0, 6);
  });
});
