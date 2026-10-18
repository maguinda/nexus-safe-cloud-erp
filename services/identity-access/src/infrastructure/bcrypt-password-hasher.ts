import { compare } from 'bcryptjs';
import { PasswordHasher } from '../domain/ports';

export class BcryptPasswordHasher implements PasswordHasher {
  verify(plain: string, hash: string): Promise<boolean> {
    return compare(plain, hash);
  }
}
