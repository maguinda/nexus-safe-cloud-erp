import { PrismaClient } from '@prisma/client';
import { InfrastructureRow, NetworkInput } from '../domain/network';
import { NetworkQueries } from '../domain/ports';

export class PrismaNetworkQueries implements NetworkQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async devicesByCategory(): Promise<NetworkInput['byCategory']> {
    const rows = await this.prisma.networkDevice.groupBy({ by: ['category'], _count: { _all: true } });
    return rows.map((r) => ({ category: r.category, count: r._count._all }));
  }

  async devicesByCriticality(): Promise<NetworkInput['byCriticality']> {
    const rows = await this.prisma.networkDevice.groupBy({ by: ['criticality'], _count: { _all: true } });
    return rows.map((r) => ({ criticality: r.criticality, count: r._count._all }));
  }

  async links(): Promise<NetworkInput['links']> {
    const [byFunctional, byType, byCriticality] = await Promise.all([
      this.prisma.networkLink.groupBy({ by: ['functional'], _count: { _all: true } }),
      this.prisma.networkLink.groupBy({ by: ['linkType'], _count: { _all: true } }),
      this.prisma.networkLink.groupBy({ by: ['criticality'], _count: { _all: true } }),
    ]);
    const n = (f: boolean | null) => byFunctional.find((r) => r.functional === f)?._count._all ?? 0;
    return {
      total: byFunctional.reduce((sum, r) => sum + r._count._all, 0), functional: n(true), notFunctional: n(false), noData: n(null),
      byType: byType.map((r) => ({ type: r.linkType, count: r._count._all })),
      byCriticality: byCriticality.map((r) => ({ criticality: r.criticality, count: r._count._all })),
    };
  }

  /** Los equipos de infraestructura son los que tienen fila de monitoreo; el resto del inventario (PC, laptops, IoT) no la tiene. */
  async infrastructure(): Promise<InfrastructureRow[]> {
    const rows = await this.prisma.networkMonitoring.findMany({ include: { device: { select: { model: true, role: true, criticality: true, ips: true } } } });
    return rows.map((r) => ({
      name: r.deviceName, model: r.device.model, role: r.device.role, criticality: r.device.criticality, ips: r.device.ips,
      syslog: r.syslog, snmp: r.snmp, ntp: r.ntp, netflow: r.netflow, signals: r.signals,
    }));
  }
}
