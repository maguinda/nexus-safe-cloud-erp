import { PASSWORD_MESSAGES, PasswordProblem } from './password-policy';

/** Un solo mensaje para usuario inexistente y contraseña incorrecta: no revela cuál cuentas existen. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

/** El idioma no es uno de los dos admitidos (el DTO ya lo filtra; esta es la segunda defensa, en el dominio). */
export class InvalidLanguageError extends Error {
  constructor() { super('Language must be es or en'); this.name = 'InvalidLanguageError'; }
}

/** El tema no es uno de los tres admitidos (el DTO ya lo filtra; esta es la segunda defensa, en el dominio). */
export class InvalidThemeError extends Error {
  constructor() { super('Theme must be system, light or dark'); this.name = 'InvalidThemeError'; }
}

/** Un cambio de rol que toca los roles del personal técnico (400): esas cuentas se crean ligadas a una persona y no cambian de rol. */
export class StaffRoleError extends Error {
  constructor(message: string) { super(message); this.name = 'StaffRoleError'; }
}
/** Esa persona del personal ya tiene una cuenta (409). */
export class StaffTakenError extends Error {
  constructor() { super('That staff member already has an account'); this.name = 'StaffTakenError'; }
}
export class EmailTakenError extends Error {
  constructor() { super('That email is already registered'); this.name = 'EmailTakenError'; }
}
export class UserNotFoundError extends Error {
  constructor() { super('User not found'); this.name = 'UserNotFoundError'; }
}
export class WeakPasswordError extends Error {
  constructor(public readonly problem: PasswordProblem) { super(PASSWORD_MESSAGES[problem]); this.name = 'WeakPasswordError'; }
}
/** El token todavía es válido, pero en la base la persona ya no es gerente (le cambiaron el rol hace poco). */
export class NotAManagerError extends Error {
  constructor() { super('Your role is no longer manager. Sign in again.'); this.name = 'NotAManagerError'; }
}
export class CannotChangeOwnRoleError extends Error {
  constructor() { super('You cannot change your own role'); this.name = 'CannotChangeOwnRoleError'; }
}
export class LastManagerError extends Error {
  constructor() { super('The last manager cannot lose the manager role'); this.name = 'LastManagerError'; }
}

/** La sesión no se puede renovar (falta la cookie, el token no existe, venció, lo revocaron o la persona ya no existe): hay que iniciar sesión de nuevo. */
export class InvalidSessionError extends Error {
  constructor() { super('Invalid or expired session'); this.name = 'InvalidSessionError'; }
}
/** Dos renovaciones con el mismo token casi a la vez: la otra ganó. No se revoca nada; el reintento usa la cookie nueva. */
export class SessionRetryError extends Error {
  constructor() { super('Session renewal in progress, retry'); this.name = 'SessionRetryError'; }
}
