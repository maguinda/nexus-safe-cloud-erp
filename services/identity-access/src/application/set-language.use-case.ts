import { InvalidLanguageError, UserNotFoundError } from '../domain/errors';
import { isLanguage, Language } from '../domain/language';
import { UserPreferencesStore } from '../domain/ports';

/** Cada persona cambia SU idioma: el id sale del token firmado y nunca del cuerpo. */
export class SetLanguageUseCase {
  constructor(private readonly store: UserPreferencesStore) {}

  async execute(userId: string, language: unknown): Promise<Language> {
    if (!isLanguage(language)) throw new InvalidLanguageError();
    if (!(await this.store.setLanguage(userId, language))) throw new UserNotFoundError();
    return language;
  }
}
