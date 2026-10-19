import { Role } from './role';
import { User } from './user';

/** Puertos que el dominio necesita; los adaptadores viven en infrastructure/. */
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
}

export interface PasswordHasher {
  verify(plain: string, hash: string): Promise<boolean>;
  hash(plain: string): Promise<string>;
}

export interface AccessToken {
  token: string;
  expiresIn: number;
}

export interface TokenIssuer {
  issue(user: User): AccessToken;
}

/** Lo que se muestra de un usuario: NUNCA incluye la contraseña ni su hash. */
export interface UserSummary { id: string; email: string; name: string; role: Role; createdAt: Date }
export interface NewUser { email: string; name: string; role: Role; passwordHash: string }

/** Operaciones dentro de la transacción que ya tiene bloqueadas las filas de los gerentes (ver prisma-user-admin.store.ts). */
export interface RoleChangeTx {
  findById(id: string): Promise<UserSummary | null>;
  countManagers(): Promise<number>;
  setRole(id: string, role: Role): Promise<UserSummary>;
}

export interface UserAdminStore {
  /** Rol ACTUAL en la base (el del token puede ser de hace 15 minutos). */
  isManager(id: string): Promise<boolean>;
  list(): Promise<UserSummary[]>;
  /** Lanza EmailTakenError si el email ya existe. */
  create(user: NewUser): Promise<UserSummary>;
  runRoleChange<T>(work: (tx: RoleChangeTx) => Promise<T>): Promise<T>;
}
