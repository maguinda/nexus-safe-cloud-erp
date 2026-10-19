import type { ApproveResponse, Invoice, LoginResponse, ManagedUser, Milestone, Project, Dashboard, Role } from './types';

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
    users: () => request<ManagedUser[]>('GET', '/users'),
    createUser: (u: { email: string; name: string; role: Role; password: string }) => request<ManagedUser>('POST', '/users', u),
    changeRole: (id: string, role: Role) => request<ManagedUser>('PATCH', `/users/${encodeURIComponent(id)}/role`, { role }),
    issue: (invoiceNumber: string) => request<Invoice>('PATCH', `/invoices/${encodeURIComponent(invoiceNumber)}/issue`),
  };
}
export type Api = ReturnType<typeof createApi>;
