import { InvalidEventError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORR = /^[A-Za-z0-9._-]{8,64}$/;
const TYPE = /^[A-Za-z]{1,60}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,120}$/;
const NAME = /^[^<>\u0000-\u001f]{1,120}$/u;
const ACTOR_FIELDS = ['approvedBy', 'issuedBy', 'registeredBy'] as const;

export interface AuditEntry { eventId: string; type: string; occurredAt: Date; actor: string | null; summary: string; correlationId: string }

const cop = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? `${new Intl.NumberFormat('es-CO').format(n)} COP` : '?');
const str = (v: unknown) => (typeof v === 'string' && NAME.test(v) ? v.replace(/\s+/g, ' ').trim() : '?');

/** Resumen corto de lo que pasó, armado SOLO con campos conocidos de cada tipo (nunca se copia el mensaje completo). Un tipo desconocido se anota por su nombre. */
export function summarize(type: string, d: Record<string, unknown>): string {
  switch (type) {
    case 'MilestoneCreated': return `Milestone “${str(d.milestoneName)}” created in ${str(d.projectName)} (${cop(d.amountCop)})`;
    case 'MilestoneApproved': return `Milestone “${str(d.milestoneName)}” approved in ${str(d.projectName)} (${cop(d.amountCop)})`;
    case 'InvoiceDrafted': return `Draft invoice ${str(d.invoiceNumber)} for “${str(d.milestoneName)}” (${cop(d.totalCop)})`;
    case 'InvoiceIssued': return `Invoice ${str(d.invoiceNumber)} issued (${cop(d.totalCop)})`;
    case 'OverdueDetected': return `Invoice ${str(d.invoiceNumber)} detected overdue (${cop(d.totalCop)})`;
    case 'PaymentReceived': return `Payment of ${cop(d.paymentCop)} on invoice ${str(d.invoiceNumber)}${d.paidInFull === true ? ' (paid in full)' : ''}`;
    case 'EngineerAllocated': return `${str(d.engineerName)} allocated to ${str(d.projectName)} at ${typeof d.percent === 'number' ? d.percent : '?'}%`;
    case 'AllocationRemoved': return `Allocation removed from ${str(d.projectName)}`;
    case 'OverAllocationDetected': return `${str(d.engineerName)} over-allocated up to ${typeof d.allocationPercent === 'number' ? d.allocationPercent : '?'}%`;
    case 'ThresholdBreached': return `Threshold breached on ${str(d.deviceName ?? d.device)}`;
    case 'StockChanged': return `Stock of ${str(d.itemName)} changed by ${typeof d.delta === 'number' ? d.delta : '?'}`;
    case 'WorkOrderCreated': return `Work order ${str(d.orderNumber)} (${str(d.orderType)}) created on ${str(d.targetName)}`;
    case 'WorkOrderClosed': return `Work order ${str(d.orderNumber)} ${str(d.outcome)} on ${str(d.targetName)}`;
    case 'EquipmentRetired': return `Equipment ${str(d.installNumber)} ${d.destination === 'storage' ? 'returned to storage' : 'retired'} (${str(d.itemName)})`;
    case 'EquipmentInstalled': return `Equipment installed: ${str(d.itemName)} (${str(d.installNumber)})`;
    case 'PayrollPaid': return `Payroll of ${str(d.period)} paid (${cop(d.totalCop)})`;
    case 'SupplierPaid': return `Supplier payment ${str(d.payableNumber)} to ${str(d.supplierName)} (${cop(d.amountCop)})`;
    case 'QuoteApproved': return `Quote ${str(d.quoteNumber)} approved for ${str(d.projectName)} (${cop(d.amountCop)})`;
    case 'EquipmentPurchased': return `Equipment purchased: ${str(d.itemName)} (order ${str(d.orderNumber)})`;
    default: return `Event ${type}`;
  }
}

/** Todo lo que llega por el bus es entrada no confiable: solo se valida el sobre y se guarda un resumen corto con el actor (si el evento lo dice). */
export function parseAudit(raw: unknown): AuditEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvalidEventError('event must be an object');
  const e = raw as Record<string, any>;
  if (typeof e.eventId !== 'string' || !UUID.test(e.eventId)) throw new InvalidEventError('eventId must be a UUID');
  if (typeof e.type !== 'string' || !TYPE.test(e.type)) throw new InvalidEventError('type must be letters only (1 to 60)');
  if (typeof e.occurredAt !== 'string' || Number.isNaN(Date.parse(e.occurredAt))) throw new InvalidEventError('occurredAt must be an ISO date');
  if (typeof e.correlationId !== 'string' || !CORR.test(e.correlationId)) throw new InvalidEventError('correlationId has an invalid format');
  const d = e.data;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new InvalidEventError('data must be an object');
  let actor: string | null = null;
  for (const f of ACTOR_FIELDS) { const v = d[f]; if (typeof v === 'string' && EMAIL.test(v)) { actor = v.toLowerCase(); break; } }
  return { eventId: e.eventId.toLowerCase(), type: e.type, occurredAt: new Date(e.occurredAt), actor, summary: summarize(e.type, d).slice(0, 300), correlationId: e.correlationId };
}
