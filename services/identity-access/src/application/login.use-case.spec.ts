import { LoginUseCase } from './login.use-case';
import { InvalidCredentialsError } from '../domain/errors';
import { PasswordHasher, TokenIssuer, UserRepository } from '../domain/ports';
import { User } from '../domain/user';

const lead: User = { id: 'u1', email: 'laura.rios@nexus.example', name: 'Laura Ríos', role: 'project_lead', language: 'es', theme: 'system', passwordHash: 'HASH-OK' };

function build(users: User[] = [lead]) {
  const verifyCalls: string[] = [];
  const repo: UserRepository = { findByEmail: async (e) => users.find((u) => u.email === e) ?? null };
  const hasher: PasswordHasher = {
    hash: async () => { throw new Error('login never hashes'); },
    verify: async (plain, hash) => {
      verifyCalls.push(hash);
      return plain === 'right-password' && hash === 'HASH-OK';
    },
  };
  const tokens: TokenIssuer = { issue: (u) => ({ token: `token-for-${u.id}`, expiresIn: 900 }) };
  return { useCase: new LoginUseCase(repo, hasher, tokens), verifyCalls };
}

describe('LoginUseCase', () => {
  it('returns a token and the public user data on valid credentials', async () => {
    const { useCase } = build();
    const r = await useCase.execute('laura.rios@nexus.example', 'right-password');
    expect(r).toEqual({
      accessToken: 'token-for-u1',
      expiresIn: 900,
      user: { email: 'laura.rios@nexus.example', name: 'Laura Ríos', role: 'project_lead', language: 'es', theme: 'system' },
    });
    expect(JSON.stringify(r)).not.toContain('HASH');
  });

  it('returns the language the person chose, so the screen opens in it', async () => {
    const { useCase } = build([{ ...lead, language: 'en' }]);
    expect((await useCase.execute('laura.rios@nexus.example', 'right-password')).user.language).toBe('en');
  });

  it('returns the theme the person chose, so the screen opens in it', async () => {
    const { useCase } = build([{ ...lead, theme: 'dark' }]);
    expect((await useCase.execute('laura.rios@nexus.example', 'right-password')).user.theme).toBe('dark');
  });

  it('normalizes the email (case and spaces)', async () => {
    const { useCase } = build();
    await expect(useCase.execute('  LAURA.RIOS@Nexus.Example ', 'right-password')).resolves.toBeDefined();
  });

  it('rejects a wrong password', async () => {
    const { useCase } = build();
    await expect(useCase.execute(lead.email, 'nope')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects an unknown user with the same error and still runs a hash comparison', async () => {
    const { useCase, verifyCalls } = build();
    await expect(useCase.execute('ghost@nexus.example', 'right-password')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(verifyCalls).toHaveLength(1); // misma cantidad de trabajo que con un usuario real
    expect(verifyCalls[0]).not.toBe('HASH-OK');
  });

  it('never accepts a valid password for another account', async () => {
    const other: User = { ...lead, id: 'u2', email: 'x@nexus.example', passwordHash: 'HASH-OTHER' };
    const { useCase } = build([lead, other]);
    await expect(useCase.execute('x@nexus.example', 'right-password')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
