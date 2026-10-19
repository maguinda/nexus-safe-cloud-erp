/** Tipos según docs/openapi.yaml. */
export type Role = 'project_lead' | 'billing_analyst' | 'sales' | 'manager';

export interface User { email: string; name: string; role: Role }
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

export const ROLE_LABEL: Record<Role, string> = { project_lead: 'Project lead', billing_analyst: 'Billing analyst', sales: 'Sales', manager: 'Manager' };
