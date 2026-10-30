import { randomUUID } from 'crypto';
import { Allocation } from './allocation';
import { dayString } from './dates';
import { Engineer } from './engineer';

/** Contrato en docs/events.md. Sin datos personales: solo el nombre del ingeniero (nombre de negocio), el proyecto y las fechas. */
interface Envelope { eventId: string; occurredAt: string; correlationId: string }
export interface EngineerAllocatedEvent extends Envelope {
  type: 'EngineerAllocated';
  /** `dailyCostCop` es el costo diario VIGENTE al asignar (null si gerencia aún no lo escribió); solo lo consume Analytics para la rentabilidad. */
  data: { allocationId: string; engineerName: string; projectName: string; percent: number; periodStart: string; periodEnd: string; dailyCostCop: number | null };
}
/** Se quitó una asignación: quien armó algo con ella (equipo del proyecto, costos) debe olvidarla. */
export interface AllocationRemovedEvent extends Envelope {
  type: 'AllocationRemoved';
  data: { allocationId: string; projectName: string };
}
export interface OverAllocationDetectedEvent extends Envelope {
  type: 'OverAllocationDetected';
  data: { allocationId: string; engineerName: string; allocationPercent: number; periodStart: string; periodEnd: string };
}
export type CapacityEvent = EngineerAllocatedEvent | OverAllocationDetectedEvent | AllocationRemovedEvent;

export const ENGINEER_ALLOCATED_ROUTING_KEY = 'capacity.engineer.allocated';
export const OVER_ALLOCATION_ROUTING_KEY = 'capacity.overallocation.detected';
export const ALLOCATION_REMOVED_ROUTING_KEY = 'capacity.allocation.removed';
export const routingKeyOf = (e: CapacityEvent): string => (e.type === 'EngineerAllocated' ? ENGINEER_ALLOCATED_ROUTING_KEY : e.type === 'AllocationRemoved' ? ALLOCATION_REMOVED_ROUTING_KEY : OVER_ALLOCATION_ROUTING_KEY);

export function engineerAllocated(e: Engineer, a: Allocation, correlationId: string, now: Date): EngineerAllocatedEvent {
  return { eventId: randomUUID(), type: 'EngineerAllocated', occurredAt: now.toISOString(), correlationId,
    data: { allocationId: a.id, engineerName: e.name, projectName: a.projectName, percent: a.percent, periodStart: dayString(a.start), periodEnd: dayString(a.end), dailyCostCop: e.dailyCostCop } };
}

export function allocationRemoved(allocationId: string, projectName: string, correlationId: string, now: Date): AllocationRemovedEvent {
  return { eventId: randomUUID(), type: 'AllocationRemoved', occurredAt: now.toISOString(), correlationId, data: { allocationId, projectName } };
}

/** `peak` es la carga más alta que quedó (siempre mayor que 100). */
export function overAllocationDetected(e: Engineer, a: Allocation, peak: number, correlationId: string, now: Date): OverAllocationDetectedEvent {
  return { eventId: randomUUID(), type: 'OverAllocationDetected', occurredAt: now.toISOString(), correlationId,
    data: { allocationId: a.id, engineerName: e.name, allocationPercent: peak, periodStart: dayString(a.start), periodEnd: dayString(a.end) } };
}
