import type { MsgKey, TFn } from '../i18n';

/** Los nombres que se validan: la etiqueta sale del diccionario para que la frase salga bien en cada idioma. */
export type TextLabel = 'project name' | 'client name' | 'milestone name' | 'name';
const FIELD: Record<TextLabel, MsgKey> = { 'project name': 'validate.field.projectName', 'client name': 'validate.field.clientName', 'milestone name': 'validate.field.milestoneName', name: 'validate.field.name' };

/** Mismos criterios que el servidor (services/projects: nombre de 1 a 120 caracteres sin caracteres de control; monto entero de 1 a 1.000.000.000). */
export const MAX_TEXT = 120;
export const MAX_AMOUNT_COP = 1_000_000_000;

/** Devuelve el mensaje de error o '' si el texto es válido. */
export function checkText(t: TFn, raw: string, label: TextLabel): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  const field = t(FIELD[label]);
  if (!text) return t('validate.text.required', { field });
  if (text.length > MAX_TEXT) return t('validate.text.tooLong', { field, max: MAX_TEXT });
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw.replace(/\s/g, ' '))) return t('validate.text.badChars', { field });
  return '';
}

/** Solo dígitos: un punto o una coma serían ambiguos (1.000 pesos o 1,000?). Devuelve el valor o un mensaje de error. */
export function parseAmount(t: TFn, raw: string): { value: number; error: '' } | { value: 0; error: string } {
  const digits = raw.trim();
  if (!digits) return { value: 0, error: t('validate.amount.required') };
  if (!/^\d+$/.test(digits)) return { value: 0, error: t('validate.amount.digits') };
  const n = Number(digits);
  if (n < 1) return { value: 0, error: t('validate.amount.min') };
  if (n > MAX_AMOUNT_COP) return { value: 0, error: t('validate.amount.max') };
  return { value: n, error: '' };
}
