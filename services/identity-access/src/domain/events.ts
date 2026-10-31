import { randomUUID } from 'crypto';
import { Role } from './role';

/** Contrato en docs/events.md. Datos personales: solo el NOMBRE de la persona afectada (nunca su correo ni su contraseña); el actor viaja como correo, igual que `approvedBy` en Projects. */
interface Envelope { eventId: string; occurredAt: string; correlationId: string }
export interface UserCreatedEvent extends Envelope {
  type: 'UserCreated';
  data: { userId: string; userName: string; role: Role; staffId: string | null; createdBy?: string };
}
export interface RoleChangedEvent extends Envelope {
  type: 'RoleChanged';
  data: { userId: string; userName: string; previousRole: Role; role: Role; changedBy?: string };
}
export type IdentityEvent = UserCreatedEvent | RoleChangedEvent;

export const USER_CREATED_ROUTING_KEY = 'identity.user.created';
export const ROLE_CHANGED_ROUTING_KEY = 'identity.user.role-changed';
export const routingKeyOf = (e: IdentityEvent): string => (e.type === 'UserCreated' ? USER_CREATED_ROUTING_KEY : ROLE_CHANGED_ROUTING_KEY);

/** Quién lo hizo y con qué traza: sale del token y de la petición, nunca del cuerpo. */
export interface EventContext { actorEmail?: string; correlationId?: string }
const corr = (c: EventContext) => c.correlationId ?? 'no-correlation';

export function userCreated(u: { id: string; name: string; role: Role; staffId: string | null }, ctx: EventContext, now: Date): UserCreatedEvent {
  return { eventId: randomUUID(), type: 'UserCreated', occurredAt: now.toISOString(), correlationId: corr(ctx),
    data: { userId: u.id, userName: u.name, role: u.role, staffId: u.staffId, ...(ctx.actorEmail ? { createdBy: ctx.actorEmail } : {}) } };
}

export function roleChanged(u: { id: string; name: string }, previousRole: Role, role: Role, ctx: EventContext, now: Date): RoleChangedEvent {
  return { eventId: randomUUID(), type: 'RoleChanged', occurredAt: now.toISOString(), correlationId: corr(ctx),
    data: { userId: u.id, userName: u.name, previousRole, role, ...(ctx.actorEmail ? { changedBy: ctx.actorEmail } : {}) } };
}
