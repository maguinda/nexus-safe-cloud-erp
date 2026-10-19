import { describe, expect, it } from 'vitest';
import { checkEmail, checkPassword } from './user-validate';

const EMAIL = 'carlos.perez@nexus.example';

// Mismos casos que services/identity-access/src/domain/password-policy.spec.ts: el aviso del navegador y el rechazo del servidor deben coincidir.
describe('checkPassword (same rules as the server)', () => {
  it.each(['correct horse battery staple', 'Pa55word-with-12', 'mañana-será-otro-día', 'a1b2c3d4e5f6', '😀😁😂🤣😃😄😅😆😉😊😋😎'])('accepts %j', (p) => { expect(checkPassword(p, EMAIL)).toBe(''); });

  it.each([
    ['', /at least 12/], ['short', /at least 12/], ['a1b2c3d4e5f', /at least 12/], ['ñandú-ñandú', /at least 12/], ['😀'.repeat(6), /at least 12/],
    ['abcd'.repeat(18) + 'e', /72 bytes/], ['ñ'.repeat(37) + 'abc', /72 bytes/],
    [' correct horse battery', /start or end with spaces/], ['correct horse battery ', /start or end with spaces/], ['correct\thorse battery\n', /start or end with spaces/],
    ['carlos.perez@nexus.example', /email/], ['My-CARLOS.PEREZ-secret', /email/],
    ['aaaaaaaaaaaa', /4 different/], ['abababababab', /4 different/], ['abcabcabcabc', /4 different/],
  ] as [string, RegExp][])('refuses %j', (p, message) => { expect(checkPassword(p, EMAIL)).toMatch(message); });

  it('accepts exactly 72 bytes and refuses 73', () => {
    expect(checkPassword('abcd'.repeat(18), EMAIL)).toBe('');
    expect(checkPassword('abcd'.repeat(18) + 'e', EMAIL)).toMatch(/72 bytes/);
  });
  it('ignores a name part shorter than 4 characters', () => {
    expect(checkPassword('mario-kart-1234567', 'ana@x.co')).toBe('');
    expect(checkPassword('banana-bread-recipe', 'ana@x.co')).toBe('');
  });
  it('reports one problem in a fixed order', () => {
    expect(checkPassword('  ', EMAIL)).toMatch(/at least 12/);
    expect(checkPassword(' aaaaaaaaaaaa', EMAIL)).toMatch(/start or end with spaces/);
  });
});

describe('checkEmail', () => {
  it.each(['carlos.perez@nexus.example', '  CARLOS@Nexus.Example ', 'a@b.co', 'first+tag@sub.domain.example'])('accepts %j', (e) => { expect(checkEmail(e)).toBe(''); });
  it.each([['', /Enter the email/], ['   ', /Enter the email/], ['no-at-sign', /valid email/], ['two@@signs.co', /valid email/], ['sp ace@x.co', /valid email/], ['a@b', /valid email/], ['@x.co', /valid email/], ['x@.co', /valid email/]] as [string, RegExp][])('refuses %j', (e, m) => { expect(checkEmail(e)).toMatch(m); });
  it('refuses more than 254 characters', () => { expect(checkEmail('a'.repeat(250) + '@x.co')).toMatch(/too long/); });
});
