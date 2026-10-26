import { PrismaClient } from '@prisma/client';
import { UserRepository } from '../domain/ports';
import { DEFAULT_LANGUAGE, isLanguage } from '../domain/language';
import { User } from '../domain/user';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? { id: row.id, email: row.email, name: row.name, role: row.role, language: isLanguage(row.language) ? row.language : DEFAULT_LANGUAGE, passwordHash: row.passwordHash } : null;
  }
}
