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
export function checkEmail(raw: string): string {
  const e = raw.trim();
  if (!e) return 'Enter the email.';
  if (e.length > MAX_EMAIL) return `The email is too long (${MAX_EMAIL} characters at most).`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Enter a valid email address.';
  return '';
}

/** Devuelve el primer problema de la contraseña inicial (en un orden fijo) o '' si es aceptable. */
export function checkPassword(password: string, email: string): string {
  const chars = Array.from(password);
  if (chars.length < PASSWORD_MIN) return `The password must have at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return `The password must not be longer than ${PASSWORD_MAX_BYTES} bytes.`;
  if (/^\s|\s$/.test(password)) return 'The password must not start or end with spaces.';
  const lower = password.toLowerCase();
  const mail = email.trim().toLowerCase();
  const namePart = mail.split('@')[0];
  if ((mail && lower.includes(mail)) || (namePart.length >= MIN_NAME_PART && lower.includes(namePart))) return 'The password must not contain the email address or the name part of it.';
  if (new Set(chars).size < MIN_DISTINCT) return `The password must use at least ${MIN_DISTINCT} different characters.`;
  return '';
}
