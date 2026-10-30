import { InfrastructureRow, NetworkInput } from './network';
import { BucketRow, EventRow, LocationStat, RangeSpec } from './trends';
import { AttentionReading, DeviceCounters, DeviceRow, LatestReading, LocationAverage, StatusCount } from './telemetry';

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

/** Agregados de las tendencias de sensores por oficina, siempre de un rango (nunca de toda la tabla). */
export interface TrendsQueries {
  buckets(r: RangeSpec): Promise<BucketRow[]>;
  perLocation(r: RangeSpec): Promise<LocationStat[]>;
  /** Solo ALERT y WARNING: los `limit` más recientes del rango y cuántos hay en total. */
  events(r: RangeSpec, limit: number): Promise<{ rows: EventRow[]; total: number }>;
  statusCounts(r: RangeSpec): Promise<StatusCount[]>;
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

/** Quien redacta la recomendación (hoy, el modelo de Claude por su API). Si falla, quien lo usa se queda con la recomendación por reglas. */
export interface AdviceWriter {
  write(prompt: { system: string; user: string }, signal: AbortSignal): Promise<string>;
}

/** Escritura de lecturas nuevas de los sensores (API de ingesta). */
export interface ReadingIngest {
  /** Catálogo de dispositivos: id → unidad. */
  deviceUnits(): Promise<Map<string, string>>;
  /**
   * Guarda las lecturas nuevas y devuelve cuántas entraron: las que ya existían (mismo dispositivo e instante) se ignoran.
   * En la misma transacción decide si algún dispositivo EMPEORÓ y deja el aviso `ThresholdBreached` en el outbox.
   */
  insertReadings(rows: import('./ingest').NewReading[], ctx: IngestContext): Promise<number>;
}
/** Borrado de lecturas viejas (retención). */
export interface ReadingRetention {
  /** Borra hasta `limit` lecturas anteriores a `cutoff` que no sean la última de su dispositivo y devuelve cuántas. */
  deleteOlderThan(cutoff: Date, limit: number): Promise<number>;
}
/** Con qué se escribe el lote: el reloj de esta petición y su id de correlación (viaja en el evento). */
export interface IngestContext { correlationId: string; now: Date }
