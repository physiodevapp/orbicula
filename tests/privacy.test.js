import { describe, it, expect, vi } from 'vitest';
import { installNetworkGuard } from '../src/privacy/guard.js';

function fakeScope() {
  const opened = [];
  class XHR {
    open(method, url) {
      opened.push(url);
    }
  }
  class WS {
    constructor(url) {
      this.url = url;
    }
  }
  return {
    scope: {
      location: { origin: 'https://app.test', href: 'https://app.test/orbicula/index.html' },
      fetch: vi.fn(async (input) => `ok:${typeof input === 'string' ? input : input.url}`),
      XMLHttpRequest: XHR,
      WebSocket: WS,
      EventSource: class ES {},
      navigator: { sendBeacon: vi.fn(() => true) },
    },
    opened,
  };
}

describe('barrera de red', () => {
  it('deja pasar el mismo origen (rutas relativas y absolutas) y data:/blob:', async () => {
    const { scope } = fakeScope();
    const real = scope.fetch;
    installNetworkGuard(scope);
    await expect(scope.fetch('./modelos/m.task')).resolves.toBe('ok:./modelos/m.task');
    await expect(scope.fetch('https://app.test/assets/x.js')).resolves.toContain('ok:');
    await expect(scope.fetch('blob:https://app.test/abc')).resolves.toContain('ok:');
    await expect(scope.fetch('data:text/plain,hola')).resolves.toContain('ok:');
    expect(real).toHaveBeenCalledTimes(4);
  });

  it('bloquea fetch a otro origen, también con un objeto Request, sin llamar al fetch real', async () => {
    const { scope } = fakeScope();
    const real = scope.fetch;
    const { blockedHosts } = installNetworkGuard(scope);
    await expect(scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' })).rejects.toThrow(/Bloqueado/);
    await expect(scope.fetch({ url: 'https://evil.test/x' })).rejects.toThrow(/Bloqueado/);
    expect(real).not.toHaveBeenCalled();
    expect([...blockedHosts].sort()).toEqual(['evil.test', 'odml.pa.googleapis.com']);
  });

  it('un puerto o un protocolo distintos también son otro origen', async () => {
    const { scope } = fakeScope();
    installNetworkGuard(scope);
    await expect(scope.fetch('https://app.test:8443/x')).rejects.toThrow();
    await expect(scope.fetch('http://app.test/x')).rejects.toThrow();
  });

  it('bloquea XMLHttpRequest, WebSocket, EventSource y sendBeacon a otro origen', () => {
    const { scope, opened } = fakeScope();
    installNetworkGuard(scope);
    const xhr = new scope.XMLHttpRequest();
    expect(() => xhr.open('POST', 'https://odml.pa.googleapis.com/v1/log')).toThrow(/Bloqueado/);
    expect(() => xhr.open('GET', '/model.task')).not.toThrow();
    expect(opened).toEqual(['/model.task']);
    expect(() => new scope.WebSocket('wss://evil.test/s')).toThrow(/Bloqueado/);
    expect(() => new scope.WebSocket('wss://app.test/s')).toThrow(/Bloqueado/); // otro protocolo = otro origen
    expect(() => new scope.EventSource('https://evil.test/e')).toThrow(/Bloqueado/);
  });

  it('sendBeacon a otro origen devuelve false y no envía', () => {
    const { scope } = fakeScope();
    const realBeacon = scope.navigator.sendBeacon;
    installNetworkGuard(scope);
    expect(scope.navigator.sendBeacon('https://evil.test/b', 'x')).toBe(false);
    expect(realBeacon).not.toHaveBeenCalled();
    expect(scope.navigator.sendBeacon('/b', 'x')).toBe(true);
  });

  it('avisa de cada bloqueo y trata una URL no válida como bloqueada', async () => {
    const { scope } = fakeScope();
    const onBlock = vi.fn();
    installNetworkGuard(scope, { onBlock });
    await expect(scope.fetch('https://a.test/x')).rejects.toThrow();
    expect(onBlock).toHaveBeenCalledWith({ via: 'fetch', host: 'a.test' });
    await expect(scope.fetch('http://')).rejects.toThrow();
    expect(onBlock).toHaveBeenCalledTimes(2);
  });
});
