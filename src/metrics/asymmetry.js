// Índice de asimetría = (I − D) / (I + D), con I y D = izquierda y derecha del paciente.
// Va de −1 (todo a la derecha) a +1 (todo a la izquierda); 0 es simétrico.
export function asymmetry(left, right) {
  const sum = left + right;
  if (!Number.isFinite(sum) || sum === 0) return null;
  return (left - right) / sum;
}
