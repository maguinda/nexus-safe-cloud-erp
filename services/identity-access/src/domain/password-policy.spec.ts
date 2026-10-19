import { checkPassword, PASSWORD_MAX_BYTES, PASSWORD_MIN } from './password-policy';

const EMAIL = 'carlos.perez@nexus.example';

describe('checkPassword', () => {
  it.each(['correct horse battery staple', 'Pa55word-with-12', 'mañana-será-otro-día', 'a1b2c3d4e5f6'])('accepts %j', (p) => {
    expect(checkPassword(p, EMAIL)).toBeNull();
  });

  it('requires at least 12 characters (counted as characters, not bytes)', () => {
    expect(checkPassword('a1b2c3d4e5f'.padEnd(PASSWORD_MIN - 1, 'x'), EMAIL)).toBe('too_short');
    expect(checkPassword('a1b2c3d4e5f6'.slice(0, PASSWORD_MIN), EMAIL)).toBeNull();
    expect(checkPassword('ñandú-ñandú', EMAIL)).toBe('too_short'); // 11 caracteres aunque pese más de 11 bytes
    expect(checkPassword('ñandú-ñandú!', EMAIL)).toBeNull();
    expect(checkPassword('😀'.repeat(6), EMAIL)).toBe('too_short'); // 6 caracteres aunque JavaScript los cuente como 12 unidades
    expect(checkPassword('😀😁😂🤣😃😄😅😆😉😊😋😎', EMAIL)).toBeNull(); // 12 caracteres distintos
  });

  it('refuses more than 72 bytes because bcrypt would silently ignore the rest', () => {
    expect(checkPassword('abcd'.repeat(PASSWORD_MAX_BYTES / 4), EMAIL)).toBeNull(); // exactamente 72 bytes
    expect(checkPassword('abcd'.repeat(PASSWORD_MAX_BYTES / 4) + 'e', EMAIL)).toBe('too_long'); // 73
    expect(checkPassword('ñ'.repeat(37) + 'abc', EMAIL)).toBe('too_long'); // 37×2 + 3 = 77 bytes aunque solo tenga 40 caracteres
  });

  it('refuses leading or trailing spaces (they are almost always a typing slip)', () => {
    expect(checkPassword(' correct horse battery', EMAIL)).toBe('edge_spaces');
    expect(checkPassword('correct horse battery ', EMAIL)).toBe('edge_spaces');
    expect(checkPassword('correct\thorse battery\n', EMAIL)).toBe('edge_spaces');
  });

  it('refuses a password that contains the email or its name part, in any case', () => {
    expect(checkPassword('carlos.perez@nexus.example', EMAIL)).toBe('contains_email');
    expect(checkPassword('My-CARLOS.PEREZ-secret', EMAIL)).toBe('contains_email');
    expect(checkPassword('prefix-carlos.perez', 'Carlos.Perez@nexus.example')).toBe('contains_email');
    expect(checkPassword('abc-a@b.c-def-xyz', 'a@b.c')).toBe('contains_email');
  });

  it('does not reject short name parts that happen to appear inside an ordinary password', () => {
    expect(checkPassword('mario-kart-1234567', 'ana@x.co')).toBeNull(); // «ana» tiene menos de 4 letras: no cuenta
    expect(checkPassword('banana-bread-recipe', 'ana@x.co')).toBeNull();
  });

  it('refuses passwords with fewer than 4 different characters', () => {
    expect(checkPassword('aaaaaaaaaaaa', EMAIL)).toBe('too_simple');
    expect(checkPassword('abababababab', EMAIL)).toBe('too_simple');
    expect(checkPassword('abcabcabcabc', EMAIL)).toBe('too_simple');
    expect(checkPassword('abcdabcdabcd', EMAIL)).toBeNull();
  });

  it('reports the first problem in a fixed order so the message is predictable', () => {
    expect(checkPassword('  ', EMAIL)).toBe('too_short');
    expect(checkPassword(' aaaaaaaaaaaa', EMAIL)).toBe('edge_spaces');
  });
});
