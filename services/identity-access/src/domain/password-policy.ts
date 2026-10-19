/** Contraseña inicial que fija un gerente al crear un usuario. Pura: sin base de datos ni framework. */
export const PASSWORD_MIN = 12;
/** bcrypt solo usa los primeros 72 bytes: más allá se ignorarían en silencio, y eso sería una falsa sensación de seguridad. */
export const PASSWORD_MAX_BYTES = 72;
const MIN_DISTINCT = 4;
const MIN_NAME_PART = 4;

export type PasswordProblem = 'too_short' | 'too_long' | 'edge_spaces' | 'contains_email' | 'too_simple';

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `The password must have at least ${PASSWORD_MIN} characters.`,
  too_long: `The password must not be longer than ${PASSWORD_MAX_BYTES} bytes.`,
  edge_spaces: 'The password must not start or end with spaces.',
  contains_email: 'The password must not contain the email address or the name part of it.',
  too_simple: `The password must use at least ${MIN_DISTINCT} different characters.`,
};

/** Devuelve el primer problema (en un orden fijo, para que el mensaje sea predecible) o null si es aceptable. */
export function checkPassword(password: string, email: string): PasswordProblem | null {
  const chars = Array.from(password);
  if (chars.length < PASSWORD_MIN) return 'too_short';
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'too_long';
  if (/^\s|\s$/.test(password)) return 'edge_spaces';
  const lower = password.toLowerCase();
  const mail = email.trim().toLowerCase();
  const namePart = mail.split('@')[0];
  if (lower.includes(mail) || (namePart.length >= MIN_NAME_PART && lower.includes(namePart))) return 'contains_email';
  if (new Set(chars).size < MIN_DISTINCT) return 'too_simple';
  return null;
}
