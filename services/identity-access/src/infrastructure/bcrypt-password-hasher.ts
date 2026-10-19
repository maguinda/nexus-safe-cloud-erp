import { compare, hash as bcryptHash } from 'bcryptjs';
import { PasswordHasher } from '../domain/ports';

/** Mismo costo (10) que usa el seed de demostración. */
const COST = 10;

export class BcryptPasswordHasher implements PasswordHasher {
  verify(plain: string, hash: string): Promise<boolean> {
    return compare(plain, hash);
  }

  hash(plain: string): Promise<string> {
    return bcryptHash(plain, COST);
  }
}
