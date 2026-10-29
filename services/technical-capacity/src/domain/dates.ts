import { ValidationError } from './errors';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MS_DAY = 86_400_000;

/** «2026-11-30» → días desde 1970-01-01 (calendario UTC). Rechaza fechas que no existen (31 de febrero) y años raros. */
export function dayNumber(s: unknown, field: string): number {
  const m = typeof s === 'string' ? DAY.exec(s) : null;
  if (!m) throw new ValidationError(`${field} must be a date like 2026-11-30`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (y < 2000 || y > 2100 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new ValidationError(`${field} is not a real date`);
  return Math.round(t / MS_DAY);
}

export const dayString = (n: number): string => new Date(n * MS_DAY).toISOString().slice(0, 10);
export const todayNumber = (now: Date): number => Math.floor(now.getTime() / MS_DAY);
