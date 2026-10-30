import { randomUUID } from 'crypto';
import { InsertedReading } from './threshold';

/** Contrato en docs/events.md. Sin datos personales: nombre del dispositivo, oficina y la medida. */
export interface ThresholdBreachedEvent {
  eventId: string;
  type: 'ThresholdBreached';
  occurredAt: string;
  correlationId: string;
  data: { deviceId: string; deviceName: string; location: string; readingKind: string; status: string; value: number; unit: string; recordedAt: string };
}
export const THRESHOLD_BREACHED_ROUTING_KEY = 'ops.threshold.breached';

export function thresholdBreached(device: { id: string; name: string; location: string; readingKind: string }, r: InsertedReading, correlationId: string, now: Date): ThresholdBreachedEvent {
  return {
    eventId: randomUUID(), type: 'ThresholdBreached', occurredAt: now.toISOString(), correlationId,
    data: { deviceId: device.id, deviceName: device.name, location: device.location, readingKind: device.readingKind, status: r.status, value: r.value, unit: r.unit, recordedAt: r.recordedAt.toISOString() },
  };
}

/** Una orden de trabajo nueva sobre un equipo (contrato en docs/events.md). Sin datos personales: número, tipo, prioridad y el nombre del equipo. */
export interface WorkOrderCreatedEvent {
  eventId: string; type: 'WorkOrderCreated'; occurredAt: string; correlationId: string;
  data: { orderNumber: string; orderType: string; priority: string; targetKind: string; targetName: string; dueDate: string | null };
}
/** La orden terminó (hecha o cancelada). */
export interface WorkOrderClosedEvent {
  eventId: string; type: 'WorkOrderClosed'; occurredAt: string; correlationId: string;
  data: { orderId: string; orderNumber: string; orderType: string; outcome: 'done' | 'cancelled'; targetName: string };
}
export const WORK_ORDER_CREATED_ROUTING_KEY = 'ops.workorder.created';
export const WORK_ORDER_CLOSED_ROUTING_KEY = 'ops.workorder.closed';
export function workOrderCreated(o: { orderNumber: string; orderType: string; priority: string; targetKind: string; targetName: string; dueDate: string | null }, correlationId: string, now: Date): WorkOrderCreatedEvent {
  return { eventId: randomUUID(), type: 'WorkOrderCreated', occurredAt: now.toISOString(), correlationId, data: o };
}
export function workOrderClosed(o: { orderId: string; orderNumber: string; orderType: string; outcome: 'done' | 'cancelled'; targetName: string }, correlationId: string, now: Date): WorkOrderClosedEvent {
  return { eventId: randomUUID(), type: 'WorkOrderClosed', occurredAt: now.toISOString(), correlationId, data: o };
}
