// Avisos sonoros y vibración (WebAudio, sin archivos) para cuando no se mira la pantalla,
// p. ej. con la cámara trasera. `enabled` decide en cada aviso si suena.

export function createCues(enabled) {
  let audio = null;

  /** Hay que llamarlo dentro de un gesto del usuario (un clic): el navegador no deja iniciar el audio antes. */
  function unlock() {
    try {
      audio ??= new AudioContext();
      audio.resume?.();
    } catch { /* sin audio */ }
  }

  function beep(freq, ms = 130, at = 0) {
    if (!enabled()) return;
    try {
      audio ??= new AudioContext();
      const t = audio.currentTime + at;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + ms / 1000);
    } catch { /* sin audio */ }
  }

  const buzz = (pattern) => enabled() && navigator.vibrate?.(pattern);

  return {
    unlock,
    beep,
    buzz,
    /** Cuenta atrás: un pitido corto por segundo. */
    tick() { beep(660, 80); },
    /** Empieza la medida. */
    go() { beep(880, 260); buzz(200); },
    /** Ha terminado: tres pitidos ascendentes y una vibración larga. Ya puedes coger el móvil. */
    end() { beep(660); beep(880, 130, 0.2); beep(1100, 300, 0.4); buzz([100, 60, 100, 60, 400]); },
    /** Se ha perdido la cara: un tono grave. */
    warn() { beep(260, 280); buzz(90); },
  };
}
