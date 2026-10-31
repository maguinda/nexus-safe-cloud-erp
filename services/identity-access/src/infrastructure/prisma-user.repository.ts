import { PrismaClient } from '@prisma/client';
import { UserRepository } from '../domain/ports';
import { DEFAULT_LANGUAGE, isLanguage } from '../domain/language';
import { DEFAULT_THEME, isTheme } from '../domain/theme';
import { User } from '../domain/user';

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? { id: row.id, email: row.email, name: row.name, role: row.role, staffId: row.staffId, language: isLanguage(row.language) ? row.language : DEFAULT_LANGUAGE, theme: isTheme(row.theme) ? row.theme : DEFAULT_THEME, passwordHash: row.passwordHash } : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? { id: row.id, email: row.email, name: row.name, role: row.role, staffId: row.staffId, language: isLanguage(row.language) ? row.language : DEFAULT_LANGUAGE, theme: isTheme(row.theme) ? row.theme : DEFAULT_THEME, passwordHash: row.passwordHash } : null;
  }
}
