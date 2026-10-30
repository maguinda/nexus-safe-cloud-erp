import type { Lang } from '../i18n/core';
import type { Profitability, TeamMember, Contract, InvoicePayment, PurchaseOrder, RestockSuggestion, StockItem, Supplier, AllocationInput, CapacityResponse, NotificationsPage, Advice, ApproveResponse, Customer, CustomerInput, EInvoice, RangeKey, Invoice, LoginResponse, ManagedUser, Milestone, Project, Dashboard, Role, TelemetrySummary, Theme, Trends, ReadingsQuery, ReadingItem, Page, TelemetryFacets, NetworkSummary, DevicesQuery, NetworkDeviceItem, LinksQuery, NetworkLinkItem, NetworkFacets } from './types';

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

/** Cabecera propia que el servidor exige al renovar o cerrar sesión (defensa extra contra peticiones de otros sitios). */
const SESSION_HEADERS = { 'X-Requested-With': 'erp-web' };

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

  /** Igual que `request` pero la respuesta es texto (XML o HTML), no JSON. Los errores siguen llegando en JSON. */
  async function requestText(method: string, path: string): Promise<string> {
    const token = getToken();
    const res = await fetchImpl(baseUrl + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 && token) onUnauthorized();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* sin cuerpo JSON */ }
      throw new ApiError(res.status, typeof json?.message === 'string' ? json.message : `Request failed (${res.status})`, json?.correlationId);
    }
    return text;
  }

  return {
    login: (email: string, password: string) => request<LoginResponse>('POST', '/auth/login', { email, password }),
    /**
     * Renueva la sesión con la cookie HttpOnly (el navegador la manda sola; esta página nunca la lee). No usa el token de acceso ni llama a `onUnauthorized`:
     * quien la llama decide qué hacer con un 401 (la sesión ya no existe). Sin red lanza ApiError con status 0.
     */
    refresh: async (): Promise<LoginResponse> => {
      let res: Response;
      try { res = await fetchImpl(baseUrl + '/auth/refresh', { method: 'POST', headers: SESSION_HEADERS }); } catch { throw new ApiError(0, 'Network error'); }
      let json: any = null;
      try { json = await res.json(); } catch { /* sin cuerpo JSON */ }
      if (!res.ok) throw new ApiError(res.status, typeof json?.message === 'string' ? json.message : `Request failed (${res.status})`, json?.correlationId);
      return json as LoginResponse;
    },
    /** Cierra la sesión en el servidor (revoca la renovación y borra la cookie). Si no hay red no pasa nada: la cookie vence sola. */
    logout: async (): Promise<void> => { try { await fetchImpl(baseUrl + '/auth/logout', { method: 'POST', headers: SESSION_HEADERS }); } catch { /* sin red */ } },
    projects: () => request<Project[]>('GET', '/projects'),
    milestones: (projectId: string) => request<Milestone[]>('GET', `/projects/${encodeURIComponent(projectId)}/milestones`),
    createProject: (name: string, client: string) => request<Project>('POST', '/projects', { name, client }),
    createMilestone: (projectId: string, name: string, amountCop: number) => request<Milestone>('POST', `/projects/${encodeURIComponent(projectId)}/milestones`, { name, amountCop }),
    approve: (milestoneId: string) => request<ApproveResponse>('POST', `/milestones/${encodeURIComponent(milestoneId)}/approve`),
    suppliers: () => request<Supplier[]>('GET', '/suppliers'),
    createSupplier: (b: { name: string; kind: string; terms: string }) => request<Supplier>('POST', '/suppliers', b),
    inventory: () => request<StockItem[]>('GET', '/inventory'),
    suggestions: () => request<RestockSuggestion[]>('GET', '/inventory/suggestions'),
    createItem: (b: { name: string; kind: string; forKinds: string[] }) => request<StockItem>('POST', '/inventory/items', b),
    adjustStock: (id: string, b: { delta: number; reason: string }) => request<{ id: string; onHand: number }>('POST', `/inventory/items/${encodeURIComponent(id)}/adjust`, b),
    orders: () => request<PurchaseOrder[]>('GET', '/orders'),
    createOrder: (b: { supplierId: string; itemId: string; quantity: number; unitPriceCop: number }) => request<{ id: string; number: string }>('POST', '/orders', b),
    receiveOrder: (id: string) => request<{ id: string; onHand: number }>('POST', `/orders/${encodeURIComponent(id)}/receive`),
    cancelOrder: (id: string) => request<{ id: string }>('POST', `/orders/${encodeURIComponent(id)}/cancel`),
    capacity: () => request<CapacityResponse>('GET', '/engineers'),
    createEngineer: (b: { name: string; role: string; skills: string[]; certifications: string[] }) => request<{ id: string; name: string }>('POST', '/engineers', b),
    allocate: (engineerId: string, b: AllocationInput) => request<{ id: string; peak: number; overAllocated: boolean }>('POST', `/engineers/${encodeURIComponent(engineerId)}/allocations`, b),
    deleteAllocation: (id: string) => request<void>('DELETE', `/allocations/${encodeURIComponent(id)}`),
    notifications: (q: { unread?: boolean; limit?: number; offset?: number } = {}) => request<NotificationsPage>('GET', `/notifications${queryString(q)}`),
    notificationsUnread: () => request<{ unread: number }>('GET', '/notifications/unread-count'),
    notificationRead: (id: string) => request<void>('POST', `/notifications/${encodeURIComponent(id)}/read`),
    notificationsReadAll: () => request<{ marked: number }>('POST', '/notifications/read-all'),
    invoices: () => request<Invoice[]>('GET', '/invoices'),
    profitability: () => request<Profitability>('GET', '/profitability'),
    setDailyCost: (id: string, dailyCostCop: number | null) => request<void>('PATCH', `/engineers/${encodeURIComponent(id)}/cost`, { dailyCostCop }),
    projectTeam: (id: string) => request<TeamMember[]>('GET', `/projects/${encodeURIComponent(id)}/team`),
    contracts: () => request<Contract[]>('GET', '/contracts'),
    createContract: (b: { clientName: string; projectName: string; amountCop: number; startDate: string; endDate: string }) => request<Contract>('POST', '/contracts', b),
    setContractStatus: (id: string, status: 'closed' | 'cancelled') => request<{ id: string; status: string }>('PATCH', `/contracts/${encodeURIComponent(id)}/status`, { status }),
    payments: (n: string) => request<InvoicePayment[]>('GET', `/invoices/${encodeURIComponent(n)}/payments`),
    registerPayment: (n: string, b: { amountCop: number; method: string; reference?: string }) => request<InvoicePayment & { paidCop: number; balanceCop: number; paymentStatus: string }>('POST', `/invoices/${encodeURIComponent(n)}/payments`, b),
    /** Factura electrónica de PRUEBA (sandbox, sin validez legal). El XML y el HTML llegan como texto: llevan datos fiscales del cliente y solo los pide el analista de facturación. */
    customers: () => request<(Customer & { updatedAt: string })[]>('GET', '/customers'),
    putCustomer: (c: CustomerInput) => request<Customer>('PUT', '/customers', c),
    eInvoiceGenerate: (n: string) => request<EInvoice>('POST', `/invoices/${encodeURIComponent(n)}/electronic`),
    eInvoiceXml: (n: string) => requestText('GET', `/invoices/${encodeURIComponent(n)}/electronic/xml`),
    eInvoiceHtml: (n: string) => requestText('GET', `/invoices/${encodeURIComponent(n)}/electronic/html`),
    eInvoiceSubmit: (n: string) => request<EInvoice>('POST', `/invoices/${encodeURIComponent(n)}/electronic/submit`),
    eInvoiceDeliver: (n: string) => request<EInvoice>('POST', `/invoices/${encodeURIComponent(n)}/electronic/deliveries`),
    dashboard: () => request<Dashboard>('GET', '/dashboard'),
    telemetry: () => request<TelemetrySummary>('GET', '/telemetry/summary'),
    telemetryTrends: (range: RangeKey = '1d') => request<Trends>('GET', `/telemetry/trends?range=${range}`),
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
