import { PrismaClient } from '@prisma/client';
import { Language } from '../domain/language';
import { UserPreferencesStore } from '../domain/ports';

export class PrismaUserPreferencesStore implements UserPreferencesStore {
  constructor(private readonly prisma: PrismaClient) {}

  async setLanguage(userId: string, language: Language): Promise<boolean> {
    const r = await this.prisma.user.updateMany({ where: { id: userId }, data: { language } });
    return r.count === 1;
  }
}
