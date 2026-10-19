/** Mismos criterios que el servidor (services/projects: nombre de 1 a 120 caracteres sin caracteres de control; monto entero de 1 a 1.000.000.000). */
export const MAX_TEXT = 120;
export const MAX_AMOUNT_COP = 1_000_000_000;

/** Devuelve el mensaje de error o '' si el texto es válido. */
export function checkText(raw: string, label: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return `Enter the ${label}.`;
  if (t.length > MAX_TEXT) return `The ${label} is too long (${MAX_TEXT} characters at most).`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw.replace(/\s/g, ' '))) return `The ${label} has characters that are not allowed.`;
  return '';
}

/** Solo dígitos: un punto o una coma serían ambiguos (1.000 pesos o 1,000?). Devuelve el valor o un mensaje de error. */
export function parseAmount(raw: string): { value: number; error: '' } | { value: 0; error: string } {
  const t = raw.trim();
  if (!t) return { value: 0, error: 'Enter the amount in pesos.' };
  if (!/^\d+$/.test(t)) return { value: 0, error: 'Use digits only, like 12000000 (no dots, commas or spaces).' };
  const n = Number(t);
  if (n < 1) return { value: 0, error: 'The amount must be at least 1 peso.' };
  if (n > MAX_AMOUNT_COP) return { value: 0, error: 'The amount cannot be more than 1,000,000,000 pesos.' };
  return { value: n, error: '' };
}
