import { InvalidCustomerError } from '../errors';

/** Pesos del dígito de verificación del NIT (módulo 11, de derecha a izquierda), según la DIAN. */
const WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Dígito de verificación de un NIT escrito solo con dígitos (sin puntos ni guion). */
export function nitCheckDigit(nit: string): number {
  if (!/^[0-9]{1,15}$/.test(nit)) throw new InvalidCustomerError('nit must be 1 to 15 digits');
  let sum = 0;
  for (let i = 0; i < nit.length; i++) sum += Number(nit[nit.length - 1 - i]) * WEIGHTS[i];
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}
