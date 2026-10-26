import { ActivityItem } from './dashboard';
import { AnalyticsEvent } from './events';
import { Fact } from './fact';
import { InfrastructureRow, NetworkInput } from './network';
import { BucketRow, EventRow, LocationStat } from './trends';
import { AttentionReading, DeviceCounters, DeviceRow, LatestReading, LocationAverage, StatusCount } from './telemetry';

/** Lo que el consumidor hace dentro de UNA transacción: marcar el evento, fusionarlo en el hecho y anotar la actividad. */
export interface EventScope {
  /** true si el evento era nuevo; false si ya se había procesado (duplicado). */
  markEventProcessed(eventId: string): Promise<boolean>;
  /** Bloquea la fila del hito (la crea si no existe), aplica `merge` y la guarda. */
  mergeFact(event: AnalyticsEvent, merge: (prev: Fact | null) => Fact): Promise<void>;
  addActivity(eventId: string, kind: string, message: string, occurredAt: Date): Promise<void>;
}
export interface EventUnitOfWork {
  run<T>(work: (tx: EventScope) => Promise<T>): Promise<T>;
}

/** Lecturas del tablero: no necesitan transacción. */
export interface DashboardQueries {
  facts(): Promise<Fact[]>;
  /** Más reciente primero. */
  recentActivity(limit: number): Promise<ActivityItem[]>;
  eventsProcessed(): Promise<number>;
}

/** Lecturas de telemetría: cada una devuelve un agregado, nunca las 4.200 filas. */
export interface TelemetryQueries {
  devices(): Promise<DeviceRow[]>;
  latestPerDevice(): Promise<LatestReading[]>;
  statusCounts(): Promise<StatusCount[]>;
  countersPerDevice(): Promise<DeviceCounters[]>;
  averagesByLocation(): Promise<LocationAverage[]>;
  /** ALERT primero y luego WARNING (hasta `limit` en total); dentro de cada grupo, la más reciente primero. */
  attention(limit: number): Promise<AttentionReading[]>;
  window(): Promise<{ from: Date; to: Date } | null>;
}

/** Lecturas del inventario de red: cada una devuelve un agregado, nunca los 76 dispositivos ni los 74 enlaces. */
export interface NetworkQueries {
  devicesByCategory(): Promise<NetworkInput['byCategory']>;
  devicesByCriticality(): Promise<NetworkInput['byCriticality']>;
  links(): Promise<NetworkInput['links']>;
  infrastructure(): Promise<InfrastructureRow[]>;
}

/** Agregados de las tendencias de sensores (tramos de 10 minutos por oficina). */
export interface TrendsQueries {
  buckets(): Promise<BucketRow[]>;
  perLocation(): Promise<LocationStat[]>;
  /** Solo ALERT y WARNING. */
  events(): Promise<EventRow[]>;
  tempWarningC(): Promise<number | null>;
  window(): Promise<{ from: Date; to: Date } | null>;
}

/** Filtros del explorador de lecturas (ya validados). */
export interface ReadingsFilter {
  location?: string; deviceKind?: string; deviceId?: string; severity?: 'normal' | 'warning' | 'alert'; status?: string;
  from?: Date; to?: Date; sort: 'at' | 'value' | 'status' | 'device'; order: 'asc' | 'desc'; limit: number; offset: number;
}
export interface ReadingItem {
  id: number; at: string; deviceId: string; deviceName: string; location: string; deviceKind: string; readingKind: string;
  status: string; severity: 'normal' | 'warning' | 'alert'; value: number; unit: string; note: string | null;
}
export interface TelemetryExplorer {
  readings(filter: ReadingsFilter): Promise<{ total: number; items: ReadingItem[] }>;
  facets(): Promise<{ locations: string[]; deviceKinds: string[]; statuses: { status: string; severity: 'normal' | 'warning' | 'alert'; count: number }[]; window: { from: string; to: string } | null }>;
}

export interface DevicesFilter { category?: string; criticality?: string; monitored?: boolean; q?: string; sort: 'id' | 'name' | 'category' | 'criticality' | 'model'; order: 'asc' | 'desc'; limit: number; offset: number }
export interface LinksFilter { linkType?: string; criticality?: string; functional?: 'yes' | 'no' | 'unknown'; device?: string; q?: string; sort: 'id' | 'origin' | 'destination' | 'criticality' | 'length'; order: 'asc' | 'desc'; limit: number; offset: number }
export interface NetworkDeviceItem {
  id: number; name: string; model: string; category: string; role: string; criticality: string; ips: string | null; gateways: string | null;
  monitored: boolean; syslog: boolean | null; snmp: boolean | null; ntp: boolean | null; netflow: boolean | null; links: number;
}
export interface NetworkLinkItem { id: number; origin: string; originPort: string; destination: string; destinationPort: string; linkType: string; cableType: string | null; functional: boolean | null; length: number | null; criticality: string }
export interface NetworkExplorer {
  devices(filter: DevicesFilter): Promise<{ total: number; items: NetworkDeviceItem[] }>;
  links(filter: LinksFilter): Promise<{ total: number; items: NetworkLinkItem[] }>;
  facets(): Promise<{ categories: string[]; criticalities: string[]; linkTypes: string[] }>;
}
