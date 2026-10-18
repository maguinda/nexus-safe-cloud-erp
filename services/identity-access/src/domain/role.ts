export const ROLES = ['project_lead', 'billing_analyst', 'sales'] as const;
export type Role = (typeof ROLES)[number];
