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
