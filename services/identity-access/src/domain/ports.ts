import { User } from './user';

/** Puertos que el dominio necesita; los adaptadores viven en infrastructure/. */
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
}

export interface PasswordHasher {
  verify(plain: string, hash: string): Promise<boolean>;
}

export interface AccessToken {
  token: string;
  expiresIn: number;
}

export interface TokenIssuer {
  issue(user: User): AccessToken;
}
