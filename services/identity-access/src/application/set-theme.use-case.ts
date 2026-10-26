import { InvalidThemeError, UserNotFoundError } from '../domain/errors';
import { UserPreferencesStore } from '../domain/ports';
import { isTheme, Theme } from '../domain/theme';

/** Cada persona cambia SU tema: el id sale del token firmado y nunca del cuerpo. */
export class SetThemeUseCase {
  constructor(private readonly store: UserPreferencesStore) {}

  async execute(userId: string, theme: unknown): Promise<Theme> {
    if (!isTheme(theme)) throw new InvalidThemeError();
    if (!(await this.store.setTheme(userId, theme))) throw new UserNotFoundError();
    return theme;
  }
}
