import { randomUUID } from 'crypto';
import { dayNumber } from './dates';
import { ValidationError } from './errors';

export const MAX_SPAN_DAYS = 1095;

/** Una asignación: un porcentaje de la jornada de un ingeniero, del día `start` al `end` (los dos incluidos). Los días son números (días desde 1970). */
export interface Allocation { id: string; engineerId: string; projectName: string; percent: number; start: number; end: number }

export function newAllocation(engineerId: string, projectName: unknown, percent: unknown, startDate: unknown, endDate: unknown): Allocation {
  if (typeof projectName !== 'string') throw new ValidationError('projectName must be text');
  const name = projectName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f<>]/.test(name)) throw new ValidationError('projectName must be 2 to 80 characters without < > or control characters');
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < 1 || percent > 100) throw new ValidationError('percent must be a whole number from 1 to 100');
  const start = dayNumber(startDate, 'startDate');
  const end = dayNumber(endDate, 'endDate');
  if (end < start) throw new ValidationError('endDate cannot be before startDate');
  if (end - start + 1 > MAX_SPAN_DAYS) throw new ValidationError(`an allocation can cover at most ${MAX_SPAN_DAYS} days`);
  return { id: randomUUID(), engineerId, projectName: name, percent, start, end };
}
