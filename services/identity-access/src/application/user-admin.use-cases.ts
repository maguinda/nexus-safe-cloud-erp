import { CannotChangeOwnRoleError, LastManagerError, NotAManagerError, StaffRoleError, UserNotFoundError, WeakPasswordError } from '../domain/errors';
import { checkPassword } from '../domain/password-policy';
import { PasswordHasher, UserAdminStore, UserSummary } from '../domain/ports';
import { isStaffRole, Role } from '../domain/role';
import { decideRoleChange, normalizeEmail, normalizeName } from '../domain/user-admin';

/** El token puede tener hasta 15 minutos: antes de administrar usuarios se mira el rol ACTUAL en la base. */
async function ensureManager(store: UserAdminStore, actorId: string): Promise<void> {
  if (!(await store.isManager(actorId))) throw new NotAManagerError();
}

export class ListUsersUseCase {
  constructor(private readonly store: UserAdminStore) {}

  async execute(actorId: string): Promise<UserSummary[]> {
    await ensureManager(this.store, actorId);
    return this.store.list();
  }
}

export interface CreateUserInput { email: string; name: string; role: Role; password: string; staffId?: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateUserUseCase {
  constructor(private readonly store: UserAdminStore, private readonly hasher: PasswordHasher) {}

  async execute(actorId: string, input: CreateUserInput): Promise<UserSummary> {
    await ensureManager(this.store, actorId);
    // Un ingeniero o un técnico va ligado a UNA persona del personal; los demás roles no tienen persona.
    const staffId = input.staffId === undefined || input.staffId === null || input.staffId === '' ? null : input.staffId;
    if (isStaffRole(input.role) && (staffId === null || !UUID.test(staffId))) throw new StaffRoleError('An engineer or a technician account needs the staff member it belongs to (staffId)');
    if (!isStaffRole(input.role) && staffId !== null) throw new StaffRoleError('Only engineer and technician accounts belong to a staff member');
    const email = normalizeEmail(input.email);
    const problem = checkPassword(input.password, email);
    if (problem) throw new WeakPasswordError(problem); // antes de gastar tiempo en bcrypt o de escribir nada
    const passwordHash = await this.hasher.hash(input.password);
    return this.store.create({ email, name: normalizeName(input.name), role: input.role, staffId: staffId === null ? null : staffId.toLowerCase(), passwordHash });
  }
}

/** Un gerente cierra todas las sesiones de una persona (se fue, le robaron el equipo...). La persona puede volver a entrar con su contraseña. */
export class RevokeUserSessionsUseCase {
  constructor(private readonly store: UserAdminStore, private readonly users: { findById(id: string): Promise<unknown | null> }, private readonly sessions: { endAll(userId: string): Promise<number> }) {}

  async execute(actorId: string, targetId: string): Promise<number> {
    await ensureManager(this.store, actorId);
    if (!(await this.users.findById(targetId))) throw new UserNotFoundError();
    return this.sessions.endAll(targetId);
  }
}

export class ChangeRoleUseCase {
  constructor(private readonly store: UserAdminStore) {}

  /**
   * Todo se lee DENTRO de la transacción que ya bloqueó las filas de los gerentes: quien llama, el usuario y el número de gerentes.
   * Así dos gerentes que se quitan el rol a la vez no pueden dejar al sistema sin ninguno (el segundo ve que ya no es gerente).
   */
  execute(actorId: string, targetId: string, newRole: Role): Promise<UserSummary> {
    return this.store.runRoleChange(async (tx) => {
      const actor = await tx.findById(actorId);
      if (actor?.role !== 'manager') throw new NotAManagerError();
      const target = await tx.findById(targetId);
      if (!target) throw new UserNotFoundError();
      if (isStaffRole(newRole) || isStaffRole(target.role)) {
        if (newRole === target.role) return target; // repetir el mismo rol no cambia nada
        throw new StaffRoleError('Engineer and technician accounts are created for a staff member and do not change role: create a new account instead');
      }
      const decision = decideRoleChange({ actorId, targetId, targetRole: target.role, newRole, managerCount: await tx.countManagers() });
      if (!decision.ok) throw decision.reason === 'self' ? new CannotChangeOwnRoleError() : new LastManagerError();
      return decision.changed ? tx.setRole(targetId, newRole) : target;
    });
  }
}
