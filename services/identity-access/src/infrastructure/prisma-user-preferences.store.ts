import { PrismaClient } from '@prisma/client';
import { Language } from '../domain/language';
import { UserPreferencesStore } from '../domain/ports';
import { Theme } from '../domain/theme';

export class PrismaUserPreferencesStore implements UserPreferencesStore {
  constructor(private readonly prisma: PrismaClient) {}

  async setLanguage(userId: string, language: Language): Promise<boolean> {
    const r = await this.prisma.user.updateMany({ where: { id: userId }, data: { language } });
    return r.count === 1;
  }

  async setTheme(userId: string, theme: Theme): Promise<boolean> {
    const r = await this.prisma.user.updateMany({ where: { id: userId }, data: { theme } });
    return r.count === 1;
  }
}
