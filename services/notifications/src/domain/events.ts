import { InvalidEventError } from './errors';

/**
 * Eventos que Notifications consume (contrato en docs/events.md). Todo lo que llega por el bus es entrada no confiable:
 * se valida cada campo y se GUARDA solo lo que se muestra (nunca el mensaje completo ni datos personales).
 * Los campos extra se ignoran (compatibilidad hacia adelante); los que faltan o son raros, no.
 */
export const KINDS = ['OverdueDetected', 'ThresholdBreached', 'OverAllocationDetected'] as const;
export type Kind = (typeof KINDS)[number];
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ROLES = ['project_lead', 'billing_analyst', 'sales', 'manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROUTING_KEYS = ['billing.invoice.overdue', 'ops.threshold.breached', 'capacity.overallocation.detected'] as const;

/** Lo que se guarda: qué pasó, qué tan grave es, quién lo ve y los datos para escribirlo en pantalla. */
export interface NotificationDraft {
  eventId: string;
  correlationId: string;
  kind: Kind;
  severity: Severity;
  audienceRoles: Role[];
  params: Record<string, string | number>;
  occurredAt: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;
const INVOICE = /^INV-\d{4,9}$/;

function text(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) throw new InvalidEventError(`${field} must be a non-empty string up to ${max} chars`);
  return v;
}
function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new InvalidEventError(`${field} must be an integer between ${min} and ${max}`);
  return v;
}
function num(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new InvalidEventError(`${field} must be a number between ${min} and ${max}`);
  return v;
}

/** Quién ve cada tipo de aviso: cobro → quien factura y gerencia; sensores → gerencia; capacidad → gerencia y ventas (promete lo que se puede entregar). */
export const AUDIENCE: Record<Kind, Role[]> = {
  OverdueDetected: ['billing_analyst', 'manager'],
  ThresholdBreached: ['manager'],
  OverAllocationDetected: ['manager', 'sales'],
};

export function parseEvent(raw: unknown): NotificationDraft {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('body must be an object');
  const e = raw as Record<string, any>;
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  const base = { eventId: e.eventId.toLowerCase(), correlationId: e.correlationId, occurredAt: new Date(e.occurredAt) };
  switch (e.type) {
    case 'OverdueDetected': {
      if (typeof d.invoiceNumber !== 'string' || !INVOICE.test(d.invoiceNumber)) throw new InvalidEventError('invoiceNumber has an invalid format');
      const amountCop = int(d.amountCop, 'amountCop', 1, 1_000_000_000);
      const taxCop = int(d.taxCop, 'taxCop', 0, 2_147_483_647);
      const totalCop = int(d.totalCop, 'totalCop', 1, 2_147_483_647);
      if (totalCop !== amountCop + taxCop) throw new InvalidEventError('totalCop must equal amountCop + taxCop');
      return { ...base, kind: 'OverdueDetected', severity: 'warning', audienceRoles: AUDIENCE.OverdueDetected, params: {
        invoiceNumber: d.invoiceNumber, projectName: text(d.projectName, 'projectName'), milestoneName: text(d.milestoneName, 'milestoneName'),
        totalCop, daysOverdue: int(d.daysOverdue, 'daysOverdue', 1, 36500) } };
    }
    case 'ThresholdBreached': {
      const status = text(d.status, 'status', 40);
      return { ...base, kind: 'ThresholdBreached', severity: /alert/i.test(status) ? 'critical' : 'warning', audienceRoles: AUDIENCE.ThresholdBreached, params: {
        deviceName: text(d.deviceName, 'deviceName', 120), location: text(d.location, 'location', 120), readingKind: text(d.readingKind, 'readingKind', 60),
        status, value: num(d.value, 'value', -1e9, 1e9), unit: text(d.unit, 'unit', 20) } };
    }
    case 'OverAllocationDetected':
      return { ...base, kind: 'OverAllocationDetected', severity: 'warning', audienceRoles: AUDIENCE.OverAllocationDetected, params: {
        engineerName: text(d.engineerName, 'engineerName', 120), allocationPercent: int(d.allocationPercent, 'allocationPercent', 101, 1000),
        periodStart: text(d.periodStart, 'periodStart', 10), periodEnd: text(d.periodEnd, 'periodEnd', 10) } };
    default:
      throw new InvalidEventError(`unknown event type`);
  }
}
