import type { TFn } from '../i18n';

/**
 * Mismos criterios y mismos mensajes que el servidor (services/identity-access/src/domain/password-policy.ts):
 * la web avisa antes de enviar, el servidor vuelve a validar, y nada se recorta en silencio.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;
export const MAX_EMAIL = 254;
const MIN_DISTINCT = 4;
const MIN_NAME_PART = 4;

/** Devuelve el mensaje de error o '' si el email es aceptable. */
export function checkEmail(t: TFn, raw: string): string {
  const e = raw.trim();
  if (!e) return t('validate.email.required');
  if (e.length > MAX_EMAIL) return t('validate.email.tooLong', { max: MAX_EMAIL });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return t('validate.email.invalid');
  return '';
}

/** Devuelve el primer problema de la contraseña inicial (en un orden fijo) o '' si es aceptable. */
export function checkPassword(t: TFn, password: string, email: string): string {
  const chars = Array.from(password);
  if (chars.length < PASSWORD_MIN) return t('validate.password.short', { n: PASSWORD_MIN });
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return t('validate.password.long', { n: PASSWORD_MAX_BYTES });
  if (/^\s|\s$/.test(password)) return t('validate.password.spaces');
  const lower = password.toLowerCase();
  const mail = email.trim().toLowerCase();
  const namePart = mail.split('@')[0];
  if ((mail && lower.includes(mail)) || (namePart.length >= MIN_NAME_PART && lower.includes(namePart))) return t('validate.password.email');
  if (new Set(chars).size < MIN_DISTINCT) return t('validate.password.simple', { n: MIN_DISTINCT });
  return '';
}
