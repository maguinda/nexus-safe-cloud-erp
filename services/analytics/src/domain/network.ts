/** Orden fijo de la criticidad en todas las listas: de más a menos grave. */
export const CRITICALITY_ORDER = ['Crítica', 'Alta', 'Media'];
const rank = (c: string) => { const i = CRITICALITY_ORDER.indexOf(c); return i === -1 ? CRITICALITY_ORDER.length : i; };

export interface CountBy { count: number }
export interface InfrastructureRow {
  name: string; model: string; role: string; criticality: string; ips: string | null;
  syslog: boolean; snmp: boolean; ntp: boolean; netflow: boolean;
  /** Las señales que ese equipo PUEDE monitorear (CPU, memoria, interfaces…). */
  signals: string[];
}

/** Lo que el repositorio entrega ya agregado: nunca se cargan los 76 dispositivos ni los 74 enlaces para armar el resumen. */
export interface NetworkInput {
  byCategory: ({ category: string } & CountBy)[];
  byCriticality: ({ criticality: string } & CountBy)[];
  links: {
    total: number; functional: number; notFunctional: number;
    /** Los enlaces de IoT no informan si son funcionales. */
    noData: number;
    byType: ({ type: string } & CountBy)[];
    byCriticality: ({ criticality: string } & CountBy)[];
  };
  infrastructure: InfrastructureRow[];
}

export interface NetworkSummary {
  asOf: string;
  totals: { devices: number; links: number; criticalDevices: number; infrastructure: number };
  byCategory: { category: string; count: number }[];
  byCriticality: { criticality: string; count: number }[];
  links: { total: number; functional: number; notFunctional: number; noData: number; byType: { type: string; count: number }[]; byCriticality: { criticality: string; count: number }[] };
  monitoring: { equipment: number; syslog: number; snmp: number; ntp: number; netflow: number; withoutAnyConfig: number; signalsPossible: number };
  infrastructure: { name: string; model: string; role: string; criticality: string; ips: string | null; syslog: boolean; snmp: boolean; ntp: boolean; netflow: boolean; signals: number }[];
}

/** Criticidad en su orden fijo, con 0 para la que no tiene nada; una criticidad desconocida se muestra al final y no se pierde. */
function ordered(rows: { criticality: string; count: number }[]) {
  const seen = new Map(rows.map((r) => [r.criticality, r.count]));
  const known = CRITICALITY_ORDER.map((c) => ({ criticality: c, count: seen.get(c) ?? 0 }));
  const extra = rows.filter((r) => !CRITICALITY_ORDER.includes(r.criticality)).sort((a, b) => a.criticality.localeCompare(b.criticality)).map((r) => ({ criticality: r.criticality, count: r.count }));
  return [...known, ...extra];
}
const biggestFirst = <T extends { count: number }>(rows: T[], name: (r: T) => string) => [...rows].sort((a, b) => b.count - a.count || name(a).localeCompare(name(b)));

/** Función pura: de los agregados del repositorio al resumen del inventario de red. */
export function buildNetworkSummary(input: NetworkInput, now: Date): NetworkSummary {
  const byCriticality = ordered(input.byCriticality);
  const infra = [...input.infrastructure].sort((a, b) => rank(a.criticality) - rank(b.criticality) || a.name.localeCompare(b.name));
  const count = (f: (r: InfrastructureRow) => boolean) => infra.filter(f).length;
  return {
    asOf: now.toISOString(),
    totals: {
      devices: input.byCategory.reduce((n, c) => n + c.count, 0),
      links: input.links.total,
      criticalDevices: byCriticality.find((c) => c.criticality === 'Crítica')?.count ?? 0,
      infrastructure: infra.length,
    },
    byCategory: biggestFirst(input.byCategory, (c) => c.category).map((c) => ({ category: c.category, count: c.count })),
    byCriticality,
    links: {
      total: input.links.total, functional: input.links.functional, notFunctional: input.links.notFunctional, noData: input.links.noData,
      byType: biggestFirst(input.links.byType, (t) => t.type).map((t) => ({ type: t.type, count: t.count })),
      byCriticality: ordered(input.links.byCriticality),
    },
    monitoring: {
      equipment: infra.length, syslog: count((r) => r.syslog), snmp: count((r) => r.snmp), ntp: count((r) => r.ntp), netflow: count((r) => r.netflow),
      withoutAnyConfig: count((r) => !r.syslog && !r.snmp && !r.ntp && !r.netflow),
      signalsPossible: infra.reduce((n, r) => Math.max(n, r.signals.length), 0),
    },
    infrastructure: infra.map((r) => ({ name: r.name, model: r.model, role: r.role, criticality: r.criticality, ips: r.ips, syslog: r.syslog, snmp: r.snmp, ntp: r.ntp, netflow: r.netflow, signals: r.signals.length })),
  };
}
