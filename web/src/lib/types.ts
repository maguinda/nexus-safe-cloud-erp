/** Tipos según docs/openapi.yaml. */
export type Role = 'project_lead' | 'billing_analyst' | 'sales' | 'manager';

import type { Lang } from '../i18n/core';

/** Tema de la interfaz: «system» sigue el modo claro u oscuro del equipo. */
export type Theme = 'system' | 'light' | 'dark';

export interface User { email: string; name: string; role: Role; /** Idioma de la interfaz de esta persona (viene del servidor). */ language?: Lang; /** Tema de la interfaz de esta persona (viene del servidor). */ theme?: Theme }
/** Usuario tal como lo devuelve la administración de usuarios (identity-access): nunca trae contraseña ni hash. */
export interface ManagedUser { id: string; email: string; name: string; role: Role; createdAt: string }
export interface LoginResponse { accessToken: string; expiresIn: number; user: User }

export interface Project { id: string; name: string; client: string; milestonesApproved: number; milestonesTotal: number }
export interface Milestone { id: string; projectId: string; name: string; amountCop: number; status: 'pending' | 'approved' }
export interface ApproveResponse { milestone: Milestone; eventId: string }
export interface Invoice { number: string; projectName: string; milestoneName: string; amountCop: number; taxCop: number; totalCop: number; status: 'draft' | 'issued'; createdAt: string; dueDate: string | null }

export interface DashboardProject { projectName: string; milestonesApproved: number; approvedCop: number; waitingForInvoice: number; draftTotalCop: number; issuedTotalCop: number }
export interface Dashboard {
  asOf: string;
  freshness: { lastEventAt: string | null; lastEventLagMs: number | null; eventsProcessed: number };
  totals: {
    milestonesApproved: number; approvedCop: number;
    waitingForInvoice: { count: number; cop: number }; draft: { count: number; totalCop: number };
    issued: { count: number; subtotalCop: number; taxCop: number; totalCop: number };
  };
  projects: DashboardProject[];
  recentActivity: { at: string; kind: 'MilestoneApproved' | 'InvoiceDrafted' | 'InvoiceIssued'; message: string }[];
}

export type DeviceState = 'normal' | 'warning' | 'alert' | 'no_data';
export interface TelemetryDevice {
  id: string; name: string; kind: string; location: string; readingKind: string; unit: string; connection: 'ONLINE' | 'OFFLINE';
  state: DeviceState; lastValue: number | null; lastStatus: string | null; lastAt: string | null; warnings: number; alerts: number;
}
/** Resumen de telemetría de Analytics (GET /telemetry/summary): los datos de Nexus cargados, solo para el gerente. */
export interface TelemetrySummary {
  asOf: string;
  window: { from: string; to: string } | null;
  totals: { devices: number; online: number; readings: number; normal: number; warnings: number; alerts: number };
  devices: TelemetryDevice[];
  byLocation: { location: string; devices: number; warnings: number; alerts: number; avgTempC: number | null; avgHumidityPct: number | null }[];
  attention: { at: string; deviceId: string; deviceName: string; location: string; status: 'WARNING' | 'ALERT'; value: number; unit: string; note: string | null }[];
}

/** Rol -> clave del diccionario (`t(roleKey(role))`): el nombre del rol se traduce, el id del rol no. */
export const roleKey = (r: Role) => `role.${r}` as const;

/** Un hallazgo: la regla que lo detectó y los números para decirlo. La pantalla arma la frase en el idioma de la persona a partir del código. */
export interface Insight<C extends string = string> { code: C; severity: 'high' | 'medium' | 'info'; params: Record<string, string | number> }
export type TrendsInsightCode = 'simultaneous_alerts' | 'periodic_warnings' | 'warnings_everywhere' | 'office_hotter' | 'all_normal';
export type NetworkInsightCode = 'monitoring_basics_missing' | 'critical_unmonitored' | 'netflow_partial' | 'links_without_status' | 'all_covered';

export interface TrendPoint {
  at: string; avgTempC: number | null; maxTempC: number | null; avgHumidityPct: number | null; maxSmokePpm: number | null; heaterOnPct: number | null;
  motionDetections: number; doorUnlocks: number; warnings: number; alerts: number;
}
/** GET /telemetry/trends: tramos de 10 minutos por oficina, eventos y hallazgos. */
export interface Trends {
  asOf: string; bucketMinutes: number; window: { from: string; to: string } | null; thresholds: { tempWarningC: number | null };
  locations: string[];
  series: { location: string; points: TrendPoint[] }[];
  byLocation: { location: string; tempReadings: number; warningReadings: number; warningSharePct: number; peakTempC: number | null; heaterReadings: number; heaterOnPct: number | null }[];
  events: { at: string; location: string; deviceName: string; status: string; value: number; unit: string; note: string | null }[];
  insights: Insight<TrendsInsightCode>[];
}

export type Severity = 'normal' | 'warning' | 'alert';
export interface ReadingItem {
  id: number; at: string; deviceId: string; deviceName: string; location: string; deviceKind: string; readingKind: string;
  status: string; severity: Severity; value: number; unit: string; note: string | null;
}
export interface Page<T> { total: number; limit: number; offset: number; items: T[] }
export interface ReadingsQuery {
  location?: string; deviceKind?: string; deviceId?: string; severity?: Severity; status?: string; from?: string; to?: string;
  sort?: 'at' | 'value' | 'status' | 'device'; order?: 'asc' | 'desc'; limit?: number; offset?: number;
}
export interface TelemetryFacets { locations: string[]; deviceKinds: string[]; statuses: { status: string; severity: Severity; count: number }[]; window: { from: string; to: string } | null }

export interface NetworkSummary {
  asOf: string;
  totals: { devices: number; links: number; criticalDevices: number; infrastructure: number };
  byCategory: { category: string; count: number }[];
  byCriticality: { criticality: string; count: number }[];
  links: { total: number; functional: number; notFunctional: number; noData: number; byType: { type: string; count: number }[]; byCriticality: { criticality: string; count: number }[] };
  monitoring: { equipment: number; syslog: number; snmp: number; ntp: number; netflow: number; withoutAnyConfig: number; signalsPossible: number };
  infrastructure: { name: string; model: string; role: string; criticality: string; ips: string | null; syslog: boolean; snmp: boolean; ntp: boolean; netflow: boolean; signals: number }[];
  insights: Insight<NetworkInsightCode>[];
}
export interface NetworkDeviceItem {
  id: number; name: string; model: string; category: string; role: string; criticality: string; ips: string | null; gateways: string | null;
  monitored: boolean; syslog: boolean | null; snmp: boolean | null; ntp: boolean | null; netflow: boolean | null; links: number;
}
export interface NetworkLinkItem { id: number; origin: string; originPort: string; destination: string; destinationPort: string; linkType: string; cableType: string | null; functional: boolean | null; length: number | null; criticality: string }
export interface DevicesQuery { category?: string; criticality?: string; monitored?: 'yes' | 'no'; q?: string; sort?: 'id' | 'name' | 'category' | 'criticality' | 'model'; order?: 'asc' | 'desc'; limit?: number; offset?: number }
export interface LinksQuery { linkType?: string; criticality?: string; functional?: 'yes' | 'no' | 'unknown'; device?: string; q?: string; sort?: 'id' | 'origin' | 'destination' | 'criticality' | 'length'; order?: 'asc' | 'desc'; limit?: number; offset?: number }
export interface NetworkFacets { categories: string[]; criticalities: string[]; linkTypes: string[] }
