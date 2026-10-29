import { Prisma, PrismaClient } from '@prisma/client';
import { ReadingItem, ReadingsFilter, TelemetryExplorer } from '../domain/ports';
import { ATTENTION_STATUSES, severityOf } from '../domain/telemetry';

export class PrismaTelemetryExplorer implements TelemetryExplorer {
  constructor(private readonly prisma: PrismaClient) {}

  /** Todos los filtros se combinan con Y; ninguno se arma con texto: van por el cliente de Prisma. */
  private where(f: ReadingsFilter): Prisma.IotReadingWhereInput {
    const and: Prisma.IotReadingWhereInput[] = [];
    if (f.location) and.push({ device: { location: f.location } });
    if (f.deviceKind) and.push({ device: { kind: f.deviceKind } });
    if (f.deviceId) and.push({ deviceId: f.deviceId });
    if (f.status) and.push({ status: f.status });
    if (f.severity === 'alert') and.push({ status: 'ALERT' });
    else if (f.severity === 'warning') and.push({ status: 'WARNING' });
    else if (f.severity === 'normal') and.push({ status: { notIn: ATTENTION_STATUSES } });
    if (f.from || f.to) and.push({ recordedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
    return { AND: and };
  }

  async readings(f: ReadingsFilter): Promise<{ total: number; items: ReadingItem[] }> {
    const where = this.where(f);
    const dir = f.order;
    const orderBy: Prisma.IotReadingOrderByWithRelationInput[] =
      f.sort === 'value' ? [{ value: dir }, { id: 'asc' }] : f.sort === 'status' ? [{ status: dir }, { recordedAt: 'desc' }, { id: 'asc' }]
      : f.sort === 'device' ? [{ device: { name: dir } }, { recordedAt: 'desc' }, { id: 'asc' }] : [{ recordedAt: dir }, { id: dir }];
    const [total, rows] = await Promise.all([
      this.prisma.iotReading.count({ where }),
      this.prisma.iotReading.findMany({ where, orderBy, skip: f.offset, take: f.limit, include: { device: { select: { name: true, location: true, kind: true, readingKind: true } } } }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id, at: r.recordedAt.toISOString(), deviceId: r.deviceId, deviceName: r.device.name, location: r.device.location, deviceKind: r.device.kind, readingKind: r.device.readingKind,
        status: r.status, severity: severityOf(r.status), value: r.value, unit: r.unit, note: r.note,
      })),
    };
  }

  async facets() {
    const [locations, kinds, statuses, window] = await Promise.all([
      this.prisma.iotDevice.findMany({ distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } }),
      this.prisma.iotDevice.findMany({ distinct: ['kind'], select: { kind: true }, orderBy: { kind: 'asc' } }),
      this.prisma.iotReading.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.iotReading.aggregate({ _min: { recordedAt: true }, _max: { recordedAt: true } }),
    ]);
    return {
      locations: locations.map((l) => l.location), deviceKinds: kinds.map((k) => k.kind),
      statuses: statuses.map((s) => ({ status: s.status, severity: severityOf(s.status), count: s._count._all })).sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
      window: window._min.recordedAt && window._max.recordedAt ? { from: window._min.recordedAt.toISOString(), to: window._max.recordedAt.toISOString() } : null,
    };
  }
}
