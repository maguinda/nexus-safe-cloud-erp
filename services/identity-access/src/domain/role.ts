export const ROLES = ['project_lead', 'billing_analyst', 'sales', 'manager', 'finance'] as const;
export type Role = (typeof ROLES)[number];
