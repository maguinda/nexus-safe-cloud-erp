export const ROLES = ['project_lead', 'billing_analyst', 'sales', 'manager', 'finance', 'engineer', 'technician'] as const;
export type Role = (typeof ROLES)[number];
/** Las cuentas del personal técnico: ven solo su trabajo y van ligadas a una persona de Capacidad. */
export const STAFF_ROLES = ['engineer', 'technician'] as const;
export const isStaffRole = (r: string): boolean => (STAFF_ROLES as readonly string[]).includes(r);
