import { InvalidThemeError, UserNotFoundError } from '../domain/errors';
import { UserPreferencesStore } from '../domain/ports';
import { Theme } from '../domain/theme';
import { SetThemeUseCase } from './set-theme.use-case';

const ID = '0b9c3a52-7c4e-4a39-9d33-6f0a5c1d2e11';
function store(known: string[] = [ID]) {
  const saved = new Map<string, Theme>();
  const s: UserPreferencesStore = {
    setLanguage: async () => { throw new Error('the theme never touches the language'); },
    setTheme: async (id, t) => { if (!known.includes(id)) return false; saved.set(id, t); return true; },
  };
  return { s, saved };
}

describe('SetThemeUseCase', () => {
  it.each(['system', 'light', 'dark'])('saves %s for the person who asks and answers it', async (t) => {
    const { s, saved } = store();
    expect(await new SetThemeUseCase(s).execute(ID, t)).toBe(t);
    expect(saved.get(ID)).toBe(t);
  });

  it.each([['auto'], ['SYSTEM'], ['Dark'], [''], [' dark'], ['dark '], ['oscuro'], ['__proto__'], ['es']])('refuses %j and saves nothing', async (t) => {
    const { s, saved } = store();
    await expect(new SetThemeUseCase(s).execute(ID, t)).rejects.toBeInstanceOf(InvalidThemeError);
    expect(saved.size).toBe(0);
  });

  it('refuses things that are not strings, even if the HTTP layer let them through', async () => {
    const { s } = store();
    for (const v of [undefined, null, 1, true, ['dark'], { theme: 'dark' }]) await expect(new SetThemeUseCase(s).execute(ID, v as any)).rejects.toBeInstanceOf(InvalidThemeError);
  });

  it('a token for a person who no longer exists is «user not found», not a silent success', async () => {
    const { s } = store([]);
    await expect(new SetThemeUseCase(s).execute(ID, 'dark')).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
