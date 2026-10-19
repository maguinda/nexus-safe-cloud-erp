import { CannotChangeOwnRoleError, LastManagerError, NotAManagerError, UserNotFoundError, WeakPasswordError } from '../domain/errors';
import { checkPassword } from '../domain/password-policy';
import { PasswordHasher, UserAdminStore, UserSummary } from '../domain/ports';
import { Role } from '../domain/role';
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

export interface CreateUserInput { email: string; name: string; role: Role; password: string }

export class CreateUserUseCase {
  constructor(private readonly store: UserAdminStore, private readonly hasher: PasswordHasher) {}

  async execute(actorId: string, input: CreateUserInput): Promise<UserSummary> {
    await ensureManager(this.store, actorId);
    const email = normalizeEmail(input.email);
    const problem = checkPassword(input.password, email);
    if (problem) throw new WeakPasswordError(problem); // antes de gastar tiempo en bcrypt o de escribir nada
    const passwordHash = await this.hasher.hash(input.password);
    return this.store.create({ email, name: normalizeName(input.name), role: input.role, passwordHash });
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
      const decision = decideRoleChange({ actorId, targetId, targetRole: target.role, newRole, managerCount: await tx.countManagers() });
      if (!decision.ok) throw decision.reason === 'self' ? new CannotChangeOwnRoleError() : new LastManagerError();
      return decision.changed ? tx.setRole(targetId, newRole) : target;
    });
  }
}
