import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkEmail, checkPassword } from './user-validate';

const EMAIL = 'carlos.perez@nexus.example';
const en = makeT('en');
const es = makeT('es');

// Mismos casos que services/identity-access/src/domain/password-policy.spec.ts: el aviso del navegador y el rechazo del servidor deben coincidir.
describe('checkPassword (same rules as the server)', () => {
  it.each(['correct horse battery staple', 'Pa55word-with-12', 'mañana-será-otro-día', 'a1b2c3d4e5f6', '😀😁😂🤣😃😄😅😆😉😊😋😎'])('accepts %j', (p) => { expect(checkPassword(en, p, EMAIL)).toBe(''); });

  it.each([
    ['', /at least 12/], ['short', /at least 12/], ['a1b2c3d4e5f', /at least 12/], ['ñandú-ñandú', /at least 12/], ['😀'.repeat(6), /at least 12/],
    ['abcd'.repeat(18) + 'e', /72 bytes/], ['ñ'.repeat(37) + 'abc', /72 bytes/],
    [' correct horse battery', /start or end with spaces/], ['correct horse battery ', /start or end with spaces/], ['correct\thorse battery\n', /start or end with spaces/],
    ['carlos.perez@nexus.example', /email/], ['My-CARLOS.PEREZ-secret', /email/],
    ['aaaaaaaaaaaa', /4 different/], ['abababababab', /4 different/], ['abcabcabcabc', /4 different/],
  ] as [string, RegExp][])('refuses %j', (p, message) => { expect(checkPassword(en, p, EMAIL)).toMatch(message); });

  it('accepts exactly 72 bytes and refuses 73', () => {
    expect(checkPassword(en, 'abcd'.repeat(18), EMAIL)).toBe('');
    expect(checkPassword(en, 'abcd'.repeat(18) + 'e', EMAIL)).toMatch(/72 bytes/);
  });
  it('ignores a name part shorter than 4 characters', () => {
    expect(checkPassword(en, 'mario-kart-1234567', 'ana@x.co')).toBe('');
    expect(checkPassword(en, 'banana-bread-recipe', 'ana@x.co')).toBe('');
  });
  it('reports one problem in a fixed order', () => {
    expect(checkPassword(en, '  ', EMAIL)).toMatch(/at least 12/);
    expect(checkPassword(en, ' aaaaaaaaaaaa', EMAIL)).toMatch(/start or end with spaces/);
  });
});

describe('checkEmail', () => {
  it.each(['carlos.perez@nexus.example', '  CARLOS@Nexus.Example ', 'a@b.co', 'first+tag@sub.domain.example'])('accepts %j', (e) => { expect(checkEmail(en, e)).toBe(''); });
  it.each([['', /Enter the email/], ['   ', /Enter the email/], ['no-at-sign', /valid email/], ['two@@signs.co', /valid email/], ['sp ace@x.co', /valid email/], ['a@b', /valid email/], ['@x.co', /valid email/], ['x@.co', /valid email/]] as [string, RegExp][])('refuses %j', (e, m) => { expect(checkEmail(en, e)).toMatch(m); });
  it('refuses more than 254 characters', () => { expect(checkEmail(en, 'a'.repeat(250) + '@x.co')).toMatch(/too long/); });
});

describe('Spanish messages (same rules as English)', () => {
  it('accepts and refuses the same passwords', () => {
    for (const p of ['correct horse battery staple', 'short', ' correct horse battery', 'carlos.perez@nexus.example', 'aaaaaaaaaaaa', 'abcd'.repeat(18) + 'e', '']) expect(checkPassword(es, p, EMAIL) !== '').toBe(checkPassword(en, p, EMAIL) !== '');
  });
  it.each([
    ['short', 'La contraseña debe tener al menos 12 caracteres.'],
    ['abcd'.repeat(18) + 'e', 'La contraseña no puede pasar de 72 bytes.'],
    [' correct horse battery', 'La contraseña no puede empezar ni terminar con espacios.'],
    ['My-CARLOS.PEREZ-secret', 'La contraseña no puede contener el correo ni su parte inicial.'],
    ['aaaaaaaaaaaa', 'La contraseña debe usar al menos 4 caracteres distintos.'],
  ])('password %j', (p, message) => { expect(checkPassword(es, p, EMAIL)).toBe(message); });
  it.each([['', 'Escribe el correo.'], ['no-at-sign', 'Escribe una dirección de correo válida.'], ['a'.repeat(250) + '@x.co', 'El correo es demasiado largo (máximo 254 caracteres).']])('email %j', (e, message) => { expect(checkEmail(es, e)).toBe(message); });
  it('English text is unchanged', () => {
    expect(checkPassword(en, 'short', EMAIL)).toBe('The password must have at least 12 characters.');
    expect(checkEmail(en, '')).toBe('Enter the email.');
  });
});
