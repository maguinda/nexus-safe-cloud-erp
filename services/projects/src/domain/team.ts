import { InvalidEventError } from './errors';

export const ENGINEER_ALLOCATED_ROUTING_KEY = 'capacity.engineer.allocated';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NAME = /^[^<>\u0000-\u001f]{1,120}$/u;

/** Lo único que se guarda del evento: quién, en qué proyecto, qué porcentaje y en qué fechas (nada de datos personales ni de costos). */
export interface TeamMember { allocationId: string; engineerName: string; projectName: string; percent: number; periodStart: string; periodEnd: string; occurredAt: Date }

const day = (v: unknown, f: string): string => {
  if (typeof v !== 'string' || !DAY.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new InvalidEventError(`${f} must be a real date`);
  return v;
};
const text = (v: unknown, f: string): string => {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!NAME.test(t)) throw new InvalidEventError(`${f} must be 1 to 120 characters without < > or control characters`);
  return t;
};

/** Todo lo que llega por el bus es entrada no confiable: se valida cada campo; los campos extra se ignoran (compatibilidad hacia adelante). */
export function parseEngineerAllocated(raw: unknown): TeamMember {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('event must be an object');
  const e = raw as Record<string, any>;
  if (e.type !== 'EngineerAllocated') throw new InvalidEventError('unexpected type');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  if (typeof d.allocationId !== 'string' || !UUID.test(d.allocationId)) throw new InvalidEventError('allocationId must be a UUID');
  if (typeof d.percent !== 'number' || !Number.isInteger(d.percent) || d.percent < 1 || d.percent > 100) throw new InvalidEventError('percent must be a whole number from 1 to 100');
  const periodStart = day(d.periodStart, 'periodStart'), periodEnd = day(d.periodEnd, 'periodEnd');
  if (periodEnd < periodStart) throw new InvalidEventError('periodEnd cannot be before periodStart');
  return { allocationId: d.allocationId.toLowerCase(), engineerName: text(d.engineerName, 'engineerName'), projectName: text(d.projectName, 'projectName'), percent: d.percent, periodStart, periodEnd, occurredAt: new Date(e.occurredAt) };
}
