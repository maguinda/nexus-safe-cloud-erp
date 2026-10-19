import { Role } from './role';

export const normalizeEmail = (e: string): string => e.trim().toLowerCase();
export const normalizeName = (n: string): string => n.trim().replace(/\s+/g, ' ');

export type RoleChangeDecision = { ok: true; changed: boolean } | { ok: false; reason: 'self' | 'last_manager' };

/**
 * Reglas del cambio de rol (puras: el servicio las aplica DENTRO de una transacción con las filas de los gerentes bloqueadas).
 *  - cambiar a alguien al rol que ya tiene no es un error ni cambia nada;
 *  - nadie cambia su propio rol (un gerente no se quita ni se da permisos por su cuenta);
 *  - nunca puede quedar el sistema sin gerente.
 */
export function decideRoleChange(i: { actorId: string; targetId: string; targetRole: Role; newRole: Role; managerCount: number }): RoleChangeDecision {
  if (i.newRole === i.targetRole) return { ok: true, changed: false };
  if (i.actorId === i.targetId) return { ok: false, reason: 'self' };
  if (i.targetRole === 'manager' && i.managerCount <= 1) return { ok: false, reason: 'last_manager' };
  return { ok: true, changed: true };
}
