import { describe, expect, it } from 'vitest';
import { LANGS, MESSAGES, makeT, MsgKey, placeholdersOf, translate } from './index';
import { interpolate, isLang } from './core';
import * as esAreas from './es/areas';
import * as enAreas from './en/areas';
import { serverText } from './server';

const keys = Object.keys(MESSAGES.es) as MsgKey[];

describe('the two languages say the same things', () => {
  it('Spanish and English have exactly the same keys', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual([...keys].sort());
  });
  it.each(LANGS)('no %s text is empty', (l) => { for (const k of keys) expect(MESSAGES[l][k].trim(), `${l} ${k}`).not.toBe(''); });
  it('each key uses the same {placeholders} in both languages (a missing one would print a hole)', () => {
    for (const k of keys) expect(placeholdersOf(MESSAGES.en[k]), k).toEqual(placeholdersOf(MESSAGES.es[k]));
  });
  it('no key is defined in two areas (the merge would silently keep only one)', () => {
    const seen = new Map<string, string>();
    for (const [area, obj] of Object.entries(esAreas)) for (const k of Object.keys(obj)) { expect(seen.get(k), `${k} is in ${area} and ${seen.get(k)}`).toBeUndefined(); seen.set(k, area); }
    expect(seen.size).toBe(keys.length);
  });
  it('the English areas match the Spanish ones one by one', () => {
    for (const [area, obj] of Object.entries(esAreas)) expect(Object.keys((enAreas as any)[area]).sort(), area).toEqual(Object.keys(obj).sort());
  });
  it('the English text is not a copy of the Spanish one, except for names and short words that are the same in both', () => {
    const same = keys.filter((k) => MESSAGES.es[k] === MESSAGES.en[k] && MESSAGES.es[k].length > 14 && !/^[A-Z0-9 ·&/.\-—–{}]+$/i.test('') );
    // una frase larga idéntica en los dos idiomas casi seguro quedó sin traducir
    expect(same.filter((k) => /\b(the|your|you|please|could not|not found|enter|sign)\b/i.test(MESSAGES.es[k]))).toEqual([]);
  });
});

describe('interpolate and translate', () => {
  it('replaces every {name}', () => expect(interpolate('hola {a}, {b} y {a}', { a: 'x', b: 2 })).toBe('hola x, 2 y x'));
  it('leaves a missing parameter visible instead of printing undefined', () => expect(interpolate('hola {a}', {})).toBe('hola {a}'));
  it('does not touch a text without parameters', () => expect(interpolate('sin marcadores')).toBe('sin marcadores'));
  it('a parameter value with braces or dollars is inserted as text, not interpreted', () => expect(interpolate('x {a}', { a: '$& {b}' })).toBe('x $& {b}'));
  it('translate picks the language', () => { expect(translate('es', 'nav.projects')).toBe('Proyectos'); expect(translate('en', 'nav.projects')).toBe('Projects'); });
  it('translate falls back to Spanish and then to the key for an unknown language or key', () => {
    expect(translate('fr' as any, 'nav.projects')).toBe('Proyectos');
    expect(translate('es', 'no.such.key' as any)).toBe('no.such.key');
  });
  it('makeT binds a language', () => expect(makeT('en')('header.tokenExpires', { time: '14:59' })).toBe('token expires in 14:59'));
  it('isLang accepts only es and en', () => { for (const v of ['es', 'en']) expect(isLang(v)).toBe(true); for (const v of ['fr', 'ES', '', null, undefined, 1, ['es']]) expect(isLang(v)).toBe(false); });
});

describe('server messages (they come from the services in English)', () => {
  const es = makeT('es'), en = makeT('en');
  const cases: [string, string, string][] = [
    ['Role manager is not allowed to do this', 'Tu rol (Gerente) no puede hacer esto.', 'Your role (Manager) cannot do this.'],
    ['Role sales is not allowed to do this', 'Tu rol (Ventas) no puede hacer esto.', 'Your role (Sales) cannot do this.'],
    ['Invalid or expired token', 'Tu sesión no es válida o ya venció. Inicia sesión de nuevo.', 'Your session is not valid or has expired. Sign in again.'],
    ['Milestone m2 is already approved', 'El hito m2 ya estaba aprobado.', 'Milestone m2 was already approved.'],
    ['Invoice INV-0103 is not a draft', 'La factura INV-0103 ya no es un borrador.', 'Invoice INV-0103 is not a draft anymore.'],
    ['That email is already registered', 'Ese correo ya está registrado.', 'That email is already registered.'],
    ['The password must have at least 12 characters.', 'La contraseña debe tener al menos 12 caracteres.', 'The password must have at least 12 characters.'],
    ['The password must use at least 4 different characters.', 'La contraseña debe usar al menos 4 caracteres distintos.', 'The password must use at least 4 different characters.'],
    ['Request failed (502)', 'La solicitud falló (502).', 'The request failed (502).'],
    ['ThrottlerException: Too Many Requests', 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.', 'Too many attempts. Wait a minute and try again.'],
  ];
  it.each(cases)('%s', (msg, spanish, english) => { expect(serverText(msg, es)).toBe(spanish); expect(serverText(msg, en)).toBe(english); });
  it('a message it does not know is shown as it came (better English than nothing)', () => expect(serverText('Something brand new happened', es)).toBe('Something brand new happened'));
  it('an unknown role name is not invented', () => expect(serverText('Role wizard is not allowed to do this', es)).toBe('Tu rol (wizard) no puede hacer esto.'));
  it('a message that only looks like a known one is not translated', () => expect(serverText('Milestone m2 is already approved, really', es)).toBe('Milestone m2 is already approved, really'));
});
