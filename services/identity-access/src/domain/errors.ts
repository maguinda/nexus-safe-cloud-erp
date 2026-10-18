/** Un solo mensaje para usuario inexistente y contraseña incorrecta: no revela cuál cuentas existen. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}
