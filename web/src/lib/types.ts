/** Tipos según docs/openapi.yaml. */
export type Role = 'project_lead' | 'billing_analyst' | 'sales' | 'manager';

export interface User { email: string; name: string; role: Role }
export interface LoginResponse { accessToken: string; expiresIn: number; user: User }

export interface Project { id: string; name: string; client: string; milestonesApproved: number; milestonesTotal: number }
export interface Milestone { id: string; projectId: string; name: string; amountCop: number; status: 'pending' | 'approved' }
export interface ApproveResponse { milestone: Milestone; eventId: string }
export interface Invoice { number: string; projectName: string; milestoneName: string; amountCop: number; taxCop: number; totalCop: number; status: 'draft' | 'issued'; createdAt: string }

export const ROLE_LABEL: Record<Role, string> = { project_lead: 'Project lead', billing_analyst: 'Billing analyst', sales: 'Sales', manager: 'Manager' };
