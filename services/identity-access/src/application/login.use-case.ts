import { InvalidCredentialsError } from '../domain/errors';
import { PasswordHasher, TokenIssuer, UserRepository } from '../domain/ports';
import { Role } from '../domain/role';

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  user: { email: string; name: string; role: Role };
}

/** Hash válido de una contraseña al azar: se compara aunque el usuario no exista, para que el tiempo de respuesta no delate qué cuentas existen. */
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.wH7dN2iJ6Ek5o3C2u7hZ9v2qB1uK';

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
  ) {}

  async execute(email: string, password: string): Promise<LoginResult> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    const ok = await this.hasher.verify(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) throw new InvalidCredentialsError();
    const { token, expiresIn } = this.tokens.issue(user);
    return {
      accessToken: token,
      expiresIn,
      user: { email: user.email, name: user.name, role: user.role },
    };
  }
}
