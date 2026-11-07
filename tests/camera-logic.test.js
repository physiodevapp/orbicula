import { describe, it, expect } from 'vitest';
import {
  buildConstraints,
  resolveFacing,
  describeError,
  fpsLevel,
  FpsMeter,
  REQUESTED_FPS,
} from '../src/capture/camera-logic.js';

describe('buildConstraints', () => {
  it('pide la trasera, 60 fps y máxima resolución por defecto', () => {
    const { video, audio } = buildConstraints();
    expect(audio).toBe(false);
    expect(video.facingMode).toEqual({ ideal: 'environment' });
    expect(video.frameRate).toEqual({ ideal: REQUESTED_FPS });
    expect(video.width.ideal).toBe(4096);
  });

  it('la frontal es facingMode user', () => {
    expect(buildConstraints({ facing: 'front' }).video.facingMode).toEqual({ ideal: 'user' });
  });

  it('con deviceId fija el dispositivo y no usa facingMode', () => {
    const { video } = buildConstraints({ deviceId: 'abc' });
    expect(video.deviceId).toEqual({ exact: 'abc' });
    expect(video.facingMode).toBeUndefined();
  });

  it('el intento estricto exige un mínimo de fps', () => {
    expect(buildConstraints({ priority: 'fps', strict: true }).video.frameRate).toEqual({ min: 55, ideal: 60 });
    expect(buildConstraints({ priority: 'fps' }).video.frameRate).toEqual({ ideal: 60 });
  });

  it('la prioridad fps baja la resolución pedida', () => {
    expect(buildConstraints({ priority: 'fps' }).video.width.ideal).toBe(1280);
  });
});

describe('resolveFacing', () => {
  it('se fía de facingMode de la pista', () => {
    expect(resolveFacing({ facingMode: 'user' }, 'camera 0, facing back', 'rear')).toBe('front');
    expect(resolveFacing({ facingMode: 'environment' }, '', 'front')).toBe('rear');
  });
  it('si no hay facingMode, usa el nombre', () => {
    expect(resolveFacing({}, 'camera2 1, facing front', 'rear')).toBe('front');
    expect(resolveFacing({}, 'camera2 0, facing back', 'front')).toBe('rear');
  });
  it('si no hay pistas, devuelve lo pedido', () => {
    expect(resolveFacing({}, 'USB Camera', 'front')).toBe('front');
  });
});

describe('describeError', () => {
  it('da un mensaje en español para el permiso denegado', () => {
    expect(describeError({ name: 'NotAllowedError' })).toMatch(/Permiso de cámara denegado/);
  });
  it('no falla con errores desconocidos', () => {
    expect(describeError(new Error('x'))).toMatch(/No se pudo abrir la cámara/);
  });
});

describe('fpsLevel', () => {
  it('clasifica respecto al mínimo de 24 fps', () => {
    expect(fpsLevel(0)).toBe('none');
    expect(fpsLevel(30)).toBe('ok');
    expect(fpsLevel(24)).toBe('ok');
    expect(fpsLevel(20)).toBe('warn');
    expect(fpsLevel(10)).toBe('bad');
  });
});

describe('FpsMeter', () => {
  const feed = (meter, fps, seconds, t0 = 0) => {
    const dt = 1000 / fps;
    let t = t0;
    for (let i = 0; i <= fps * seconds; i++) {
      meter.push(t);
      t += dt;
    }
    return t - dt;
  };

  it('mide 30 fps', () => {
    const m = new FpsMeter(1000);
    feed(m, 30, 2);
    expect(m.fps).toBeCloseTo(30, 0);
  });

  it('mide 60 fps', () => {
    const m = new FpsMeter(1000);
    feed(m, 60, 2);
    expect(m.fps).toBeCloseTo(60, 0);
  });

  it('se adapta cuando la cámara baja de 60 a 15 fps', () => {
    const m = new FpsMeter(1000);
    const t = feed(m, 60, 2);
    feed(m, 15, 2, t + 1000 / 15);
    expect(m.fps).toBeCloseTo(15, 0);
  });

  it('ignora frames repetidos (misma marca de tiempo)', () => {
    const m = new FpsMeter(1000);
    [0, 0, 33.3, 33.3, 66.6, 100].forEach((t) => m.push(t));
    expect(m.fps).toBeCloseTo(30, 0);
  });

  it('con el contador de frames presentados no pierde los frames que el análisis se salta', () => {
    const m = new FpsMeter(1000);
    // Cámara a 50 fps, pero solo se atiende un frame de cada dos: el contador sigue de 2 en 2.
    for (let i = 0; i <= 100; i += 2) m.push(i * 20, i);
    expect(m.fps).toBeCloseTo(50, 0);
    // Sin el contador, saldrían 25.
    const sinContador = new FpsMeter(1000);
    for (let i = 0; i <= 100; i += 2) sinContador.push(i * 20);
    expect(sinContador.fps).toBeCloseTo(25, 0);
  });

  it('toma el mayor de los dos recuentos: si presentedFrames se queda corto, valen los callbacks', () => {
    const m = new FpsMeter(1000);
    // 30 callbacks por segundo, pero el contador solo avanza a ~26 por segundo (caso de la frontal).
    for (let i = 0; i <= 60; i++) m.push(i * (1000 / 30), Math.floor(i * 0.87));
    expect(m.fps).toBeCloseTo(30, 0);
  });

  it('da 0 con menos de dos frames', () => {
    const m = new FpsMeter();
    expect(m.fps).toBe(0);
    m.push(10);
    expect(m.fps).toBe(0);
  });
});
