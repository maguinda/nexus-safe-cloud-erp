import type { Lang } from '../i18n/core';
import type { Advice, ApproveResponse, Invoice, LoginResponse, ManagedUser, Milestone, Project, Dashboard, Role, TelemetrySummary, Theme, Trends, ReadingsQuery, ReadingItem, Page, TelemetryFacets, NetworkSummary, DevicesQuery, NetworkDeviceItem, LinksQuery, NetworkLinkItem, NetworkFacets } from './types';

/** Error con la forma de docs/openapi.yaml (schema Error). */
export class ApiError extends Error {
  constructor(public status: number, message: string, public correlationId?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  getToken: () => string | null;
  /** Se llama cuando el servidor responde 401 a una petición autenticada (token vencido o inválido). */
  onUnauthorized: () => void;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** ?a=1&b=2 con lo que tenga valor; vacío y undefined se omiten, y todo va codificado (nunca se arma a mano con texto del usuario). */
export function queryString(q: object): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function createApi({ getToken, onUnauthorized, baseUrl = '', fetchImpl = (...a) => fetch(...a) }: ApiClientOptions) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = getToken();
    const res = await fetchImpl(baseUrl + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* sin cuerpo JSON */ }
    if (!res.ok) {
      if (res.status === 401 && token) onUnauthorized();
      const message = typeof json?.message === 'string' ? json.message : `Request failed (${res.status})`;
      throw new ApiError(res.status, message, json?.correlationId);
    }
    return json as T;
  }

  return {
    login: (email: string, password: string) => request<LoginResponse>('POST', '/auth/login', { email, password }),
    projects: () => request<Project[]>('GET', '/projects'),
    milestones: (projectId: string) => request<Milestone[]>('GET', `/projects/${encodeURIComponent(projectId)}/milestones`),
    createProject: (name: string, client: string) => request<Project>('POST', '/projects', { name, client }),
    createMilestone: (projectId: string, name: string, amountCop: number) => request<Milestone>('POST', `/projects/${encodeURIComponent(projectId)}/milestones`, { name, amountCop }),
    approve: (milestoneId: string) => request<ApproveResponse>('POST', `/milestones/${encodeURIComponent(milestoneId)}/approve`),
    invoices: () => request<Invoice[]>('GET', '/invoices'),
    dashboard: () => request<Dashboard>('GET', '/dashboard'),
    telemetry: () => request<TelemetrySummary>('GET', '/telemetry/summary'),
    telemetryTrends: () => request<Trends>('GET', '/telemetry/trends'),
    telemetryReadings: (q: ReadingsQuery = {}) => request<Page<ReadingItem>>('GET', `/telemetry/readings${queryString(q)}`),
    telemetryFacets: () => request<TelemetryFacets>('GET', '/telemetry/facets'),
    networkSummary: () => request<NetworkSummary>('GET', '/network/summary'),
    networkDevices: (q: DevicesQuery = {}) => request<Page<NetworkDeviceItem>>('GET', `/network/devices${queryString(q)}`),
    networkLinks: (q: LinksQuery = {}) => request<Page<NetworkLinkItem>>('GET', `/network/links${queryString(q)}`),
    networkFacets: () => request<NetworkFacets>('GET', '/network/facets'),
    advisorBrief: (language: Lang, ai: boolean) => request<Advice>('POST', '/advisor/brief', { language, ai }),
    setLanguage: (language: Lang) => request<{ language: Lang }>('PATCH', '/me/language', { language }),
    setTheme: (theme: Theme) => request<{ theme: Theme }>('PATCH', '/me/theme', { theme }),
    users: () => request<ManagedUser[]>('GET', '/users'),
    createUser: (u: { email: string; name: string; role: Role; password: string }) => request<ManagedUser>('POST', '/users', u),
    changeRole: (id: string, role: Role) => request<ManagedUser>('PATCH', `/users/${encodeURIComponent(id)}/role`, { role }),
    issue: (invoiceNumber: string) => request<Invoice>('PATCH', `/invoices/${encodeURIComponent(invoiceNumber)}/issue`),
  };
}
export type Api = ReturnType<typeof createApi>;
