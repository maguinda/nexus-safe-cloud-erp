import { Prisma, PrismaClient } from '@prisma/client';
import { CRITICALITY_ORDER } from '../domain/network';
import { DevicesFilter, LinksFilter, NetworkDeviceItem, NetworkExplorer, NetworkLinkItem } from '../domain/ports';

export class PrismaNetworkExplorer implements NetworkExplorer {
  constructor(private readonly prisma: PrismaClient) {}

  async devices(f: DevicesFilter): Promise<{ total: number; items: NetworkDeviceItem[] }> {
    const and: Prisma.NetworkDeviceWhereInput[] = [];
    if (f.category) and.push({ category: f.category });
    if (f.criticality) and.push({ criticality: f.criticality });
    if (f.monitored === true) and.push({ monitoring: { isNot: null } });
    if (f.monitored === false) and.push({ monitoring: { is: null } });
    if (f.q) and.push({ OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { model: { contains: f.q, mode: 'insensitive' } }, { ips: { contains: f.q, mode: 'insensitive' } }, { role: { contains: f.q, mode: 'insensitive' } }] });
    const where: Prisma.NetworkDeviceWhereInput = { AND: and };
    const d = f.order;
    const orderBy: Prisma.NetworkDeviceOrderByWithRelationInput[] = f.sort === 'name' ? [{ name: d }] : f.sort === 'category' ? [{ category: d }, { name: 'asc' }] : f.sort === 'model' ? [{ model: d }, { name: 'asc' }]
      : f.sort === 'criticality' ? [{ criticality: d === 'asc' ? 'asc' : 'desc' }, { name: 'asc' }] : [{ id: d }];
    const [total, rows] = await Promise.all([
      this.prisma.networkDevice.count({ where }),
      this.prisma.networkDevice.findMany({ where, orderBy, skip: f.offset, take: f.limit, include: { monitoring: true, _count: { select: { linksFrom: true, linksTo: true } } } }),
    ]);
    const items = rows.map((r) => ({
      id: r.id, name: r.name, model: r.model, category: r.category, role: r.role, criticality: r.criticality, ips: r.ips, gateways: r.gateways,
      monitored: r.monitoring !== null, syslog: r.monitoring?.syslog ?? null, snmp: r.monitoring?.snmp ?? null, ntp: r.monitoring?.ntp ?? null, netflow: r.monitoring?.netflow ?? null,
      links: r._count.linksFrom + r._count.linksTo,
    }));
    // «Crítica, Alta, Media» no es orden alfabético: ordenar por criticidad se hace por su rango y no por el texto.
    if (f.sort === 'criticality') items.sort((a, b) => (CRITICALITY_ORDER.indexOf(a.criticality) - CRITICALITY_ORDER.indexOf(b.criticality)) * (f.order === 'asc' ? 1 : -1) || a.name.localeCompare(b.name));
    return { total, items };
  }

  async links(f: LinksFilter): Promise<{ total: number; items: NetworkLinkItem[] }> {
    const and: Prisma.NetworkLinkWhereInput[] = [];
    if (f.linkType) and.push({ linkType: f.linkType });
    if (f.criticality) and.push({ criticality: f.criticality });
    if (f.functional === 'yes') and.push({ functional: true });
    if (f.functional === 'no') and.push({ functional: false });
    if (f.functional === 'unknown') and.push({ functional: null });
    if (f.device) and.push({ OR: [{ originName: f.device }, { destinationName: f.device }] });
    if (f.q) and.push({ OR: [{ originName: { contains: f.q, mode: 'insensitive' } }, { destinationName: { contains: f.q, mode: 'insensitive' } }, { originPort: { contains: f.q, mode: 'insensitive' } }, { destinationPort: { contains: f.q, mode: 'insensitive' } }] });
    const where: Prisma.NetworkLinkWhereInput = { AND: and };
    const d = f.order;
    const orderBy: Prisma.NetworkLinkOrderByWithRelationInput[] = f.sort === 'origin' ? [{ originName: d }, { id: 'asc' }] : f.sort === 'destination' ? [{ destinationName: d }, { id: 'asc' }]
      : f.sort === 'criticality' ? [{ criticality: d }, { id: 'asc' }] : f.sort === 'length' ? [{ length: d }, { id: 'asc' }] : [{ id: d }];
    const [total, rows] = await Promise.all([this.prisma.networkLink.count({ where }), this.prisma.networkLink.findMany({ where, orderBy, skip: f.offset, take: f.limit })]);
    return {
      total,
      items: rows.map((r) => ({ id: r.id, origin: r.originName, originPort: r.originPort, destination: r.destinationName, destinationPort: r.destinationPort, linkType: r.linkType, cableType: r.cableType, functional: r.functional, length: r.length, criticality: r.criticality })),
    };
  }

  async facets() {
    const [cats, crits, types] = await Promise.all([
      this.prisma.networkDevice.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
      this.prisma.networkDevice.findMany({ distinct: ['criticality'], select: { criticality: true } }),
      this.prisma.networkLink.findMany({ distinct: ['linkType'], select: { linkType: true }, orderBy: { linkType: 'asc' } }),
    ]);
    const crit = crits.map((c) => c.criticality).sort((a, b) => CRITICALITY_ORDER.indexOf(a) - CRITICALITY_ORDER.indexOf(b));
    return { categories: cats.map((c) => c.category), criticalities: crit, linkTypes: types.map((t) => t.linkType) };
  }
}
