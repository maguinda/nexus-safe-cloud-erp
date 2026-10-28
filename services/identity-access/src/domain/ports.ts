import { Language } from './language';
import { Role } from './role';
import { Theme } from './theme';
import { User } from './user';

/** Puertos que el dominio necesita; los adaptadores viven en infrastructure/. */
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
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

/** Preferencias de la propia persona (el idioma y el tema de la interfaz). Una sola sentencia, sin bloqueos: la última escritura gana. */
export interface UserPreferencesStore {
  /** false si la persona ya no existe. */
  setLanguage(userId: string, language: Language): Promise<boolean>;
  setTheme(userId: string, theme: Theme): Promise<boolean>;
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

/** Tokens de renovación de sesión (ver prisma/schema.prisma, modelo RefreshToken). De cada token solo se guarda su hash. */
export interface RefreshTokenStore {
  /** Guarda el primer token de una sesión nueva (familia nueva). */
  create(t: { userId: string; familyId: string; tokenHash: string; expiresAt: Date; familyExpiresAt: Date }): Promise<void>;
  /**
   * En UNA transacción: marca el token como usado SOLO si sigue vigente, sin usar y sin revocar, y guarda el siguiente de la misma familia (que vence
   * por inactividad a los `idleMs`, pero nunca después de la familia). Con dos llamadas a la vez con el mismo token gana exactamente una; la otra
   * recibe null. Si guardar el siguiente falla, el token anterior NO queda gastado.
   */
  rotate(oldHash: string, next: { tokenHash: string; idleMs: number }, now: Date): Promise<{ userId: string; familyId: string } | null>;
  /** Lo que hay guardado de un token (para saber por qué no se pudo rotar). */
  find(tokenHash: string): Promise<import('./refresh-token').RefreshRecord & { familyId: string } | null>;
  /** Revoca todos los tokens de la familia (cierre de sesión, o sospecha de robo). */
  revokeFamily(familyId: string, now: Date): Promise<void>;
  /** Borra las sesiones cuyo tope venció antes de `before` (limpieza; no cambia ninguna regla). */
  purge(before: Date): Promise<number>;
}
