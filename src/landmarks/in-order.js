// Entrega en orden resultados que llegan desordenados (fase 6, análisis de la cara en paralelo).
// Cada envío lleva un número (1, 2, 3…); el resultado de un número se retiene hasta que han llegado todos los
// anteriores. Lo que no se pudo analizar (fotograma descartado o error) llega como `null`: no se entrega, pero
// deja pasar a los siguientes. El resto de la app (series, detectores, flujo, sesión) espera los resultados en
// orden de tiempo: el procesador del flujo, por ejemplo, descarta el que llega con un tiempo anterior.
export class InOrder {
  /**
   * @param {(value: any) => void} emit
   * @param {{maxWaiting?: number}} [o] si se retienen más de `maxWaiting` (un análisis que no contesta), se dan
   *   por perdidos los que faltan antes del primero retenido, para no atascar el análisis entero.
   */
  constructor(emit, { maxWaiting = 32 } = {}) {
    this.emit = emit;
    this.maxWaiting = maxWaiting;
    this.next = 1;
    this.waiting = new Map();
    this.skipped = 0; // números dados por perdidos sin respuesta (diagnóstico)
  }

  /** Ha llegado el número `tag`: su resultado, o `null` si se perdió. */
  done(tag, value) {
    if (!Number.isInteger(tag) || tag < this.next || this.waiting.has(tag)) return;
    this.waiting.set(tag, value ?? null);
    if (this.waiting.size > this.maxWaiting) {
      const first = Math.min(...this.waiting.keys());
      this.skipped += first - this.next;
      this.next = first;
    }
    this.#flush();
  }

  #flush() {
    while (this.waiting.has(this.next)) {
      const v = this.waiting.get(this.next);
      this.waiting.delete(this.next);
      this.next++;
      if (v !== null) this.emit(v);
    }
  }

  /** Resultados retenidos esperando a uno anterior. */
  get pending() {
    return this.waiting.size;
  }
}
