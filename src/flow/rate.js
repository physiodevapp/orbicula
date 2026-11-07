// Límite de pares de flujo por segundo, repartido entre los frames que llegan.
//
// Saltar un frame si llega antes de 1000/ritmo ms desde el anterior no funciona cuando la cámara
// no va a un múltiplo del ritmo: con 40 fps (frames cada 25 ms) y un límite de 30/s, se mandaba
// un frame de cada dos (20/s). Aquí cada frame suma «crédito» en proporción al tiempo transcurrido y
// se manda cuando hay un frame entero de crédito: con 40 fps salen 30/s (3 de cada 4).

export class RateLimiter {
  /** @param {number} rate frames por segundo como máximo (0 = sin límite) */
  constructor(rate = 0) {
    this.rate = rate;
    this.reset();
  }

  reset() {
    this.credit = 1;
    this.lastT = null;
  }

  /** ¿Se manda el frame con marca de tiempo `t` (ms)? */
  allow(t) {
    if (!this.rate) return true;
    // Cada frame aporta como mucho un frame de crédito (tras un hueco no hay ráfaga) y el sobrante se
    // conserva (si se recortara a 1, con 40 fps volverían a salir 20/s).
    if (this.lastT != null) this.credit = Math.min(2, this.credit + Math.min(1, ((t - this.lastT) * this.rate) / 1000));
    this.lastT = t;
    if (this.credit < 1 - 1e-6) return false;
    this.credit -= 1;
    return true;
  }
}
