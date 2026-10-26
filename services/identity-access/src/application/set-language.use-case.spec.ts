import { InvalidLanguageError, UserNotFoundError } from '../domain/errors';
import { Language } from '../domain/language';
import { UserPreferencesStore } from '../domain/ports';
import { SetLanguageUseCase } from './set-language.use-case';

const ID = '0b9c3a52-7c4e-4a39-9d33-6f0a5c1d2e11';
function store(known: string[] = [ID]) {
  const saved = new Map<string, Language>();
  const s: UserPreferencesStore = { setLanguage: async (id, l) => { if (!known.includes(id)) return false; saved.set(id, l); return true; } };
  return { s, saved };
}

describe('SetLanguageUseCase', () => {
  it.each(['es', 'en'])('saves %s for the person who asks and answers it', async (l) => {
    const { s, saved } = store();
    expect(await new SetLanguageUseCase(s).execute(ID, l)).toBe(l);
    expect(saved.get(ID)).toBe(l);
  });

  it.each([['fr'], ['ES'], ['En'], [''], [' es'], ['es '], ['español'], ['__proto__']])('refuses %j and saves nothing', async (l) => {
    const { s, saved } = store();
    await expect(new SetLanguageUseCase(s).execute(ID, l)).rejects.toBeInstanceOf(InvalidLanguageError);
    expect(saved.size).toBe(0);
  });

  it('refuses things that are not strings, even if the HTTP layer let them through', async () => {
    const { s } = store();
    for (const v of [undefined, null, 1, true, ['es'], { language: 'es' }]) await expect(new SetLanguageUseCase(s).execute(ID, v as any)).rejects.toBeInstanceOf(InvalidLanguageError);
  });

  it('a token for a person who no longer exists is «user not found», not a silent success', async () => {
    const { s } = store([]);
    await expect(new SetLanguageUseCase(s).execute(ID, 'en')).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
