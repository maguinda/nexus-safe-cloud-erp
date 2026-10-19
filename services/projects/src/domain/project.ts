import { randomUUID } from 'crypto';
import { InvalidInputError } from './errors';

/** Tope del monto de un hito: billing rechaza más de 1.000 millones (con IVA el total debe caber en un entero de 32 bits). */
export const MAX_MILESTONE_AMOUNT_COP = 1_000_000_000;
export const MAX_NAME_LENGTH = 120;

export interface Project {
  id: string;
  name: string;
  client: string;
}

/** Nombre limpio: sin espacios sobrantes, sin caracteres de control y de 1 a 120 caracteres. */
export function cleanText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new InvalidInputError(`${field} must be text`);
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length === 0) throw new InvalidInputError(`${field} must not be empty`);
  if (t.length > MAX_NAME_LENGTH) throw new InvalidInputError(`${field} must have at most ${MAX_NAME_LENGTH} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) throw new InvalidInputError(`${field} has invalid characters`);
  return t;
}

/** El id lo genera el servidor (el cliente no lo elige): p-xxxxxxxx. */
export function newProject(name: unknown, client: unknown): Project {
  return { id: `p-${randomUUID().slice(0, 8)}`, name: cleanText(name, 'name'), client: cleanText(client, 'client') };
}
