// Campos del código anónimo del participante: avisan al escribir (no solo al pulsar un botón, cuyo mensaje
// puede quedar fuera de la pantalla), y los mensajes de exportar se traen a la vista. Sin red.
import { isValidCode } from '../export/result.js';

export const CODE_HELP = 'Solo letras sin tilde, números, «-» y «_» (hasta 24). Un nombre con espacios o tildes no se admite: así no se cuela el nombre de un paciente.';

/**
 * Valida el campo mientras se escribe: borde rojo y un aviso justo debajo del campo.
 * @returns {() => boolean} comprueba el valor actual (y actualiza el aviso)
 */
export function bindCodeField(input) {
  if (!input) return () => true;
  const err = document.createElement('p');
  err.className = 'field-error';
  err.setAttribute('role', 'alert');
  err.hidden = true;
  (input.closest('label') ?? input).after(err);
  const check = () => {
    const ok = isValidCode(input.value);
    input.setAttribute('aria-invalid', String(!ok));
    err.hidden = ok;
    err.textContent = ok ? '' : `Código no válido. ${CODE_HELP}`;
    return ok;
  };
  input.addEventListener('input', check);
  return check;
}

/** Escribe un mensaje y lo trae a la vista (en el móvil queda debajo de los botones, fuera de la pantalla). */
export function showMessage(el, text) {
  if (!el) return;
  el.textContent = text;
  el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}
