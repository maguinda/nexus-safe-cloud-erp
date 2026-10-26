import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkText, MAX_AMOUNT_COP, MAX_TEXT, parseAmount } from './validate';

const en = makeT('en');
const es = makeT('es');

describe('checkText', () => {
  it('accepts normal and exactly-limit text', () => {
    expect(checkText(en, 'Warehouse Wi-Fi', 'name')).toBe('');
    expect(checkText(en, 'a'.repeat(MAX_TEXT), 'name')).toBe('');
    expect(checkText(en, 'Instalación ñandú 🚀', 'name')).toBe('');
  });
  it('rejects empty, blank and too long with a message (never cuts silently)', () => {
    expect(checkText(en, '', 'name')).toMatch(/Enter the name/);
    expect(checkText(en, '   ', 'name')).toMatch(/Enter the name/);
    expect(checkText(en, 'a'.repeat(MAX_TEXT + 1), 'client name')).toMatch(/too long \(120/);
  });
  it('rejects control characters', () => {
    expect(checkText(en, 'a\u0000b', 'name')).toMatch(/not allowed/);
  });
  it('counts like the server: collapsed spaces and trimmed ends', () => {
    expect(checkText(en, `  ${'a'.repeat(MAX_TEXT)}  `, 'name')).toBe('');
  });
});

describe('parseAmount', () => {
  it('accepts whole pesos between 1 and the cap', () => {
    expect(parseAmount(en, '12000000')).toEqual({ value: 12_000_000, error: '' });
    expect(parseAmount(en, ' 1 ')).toEqual({ value: 1, error: '' });
    expect(parseAmount(en, String(MAX_AMOUNT_COP))).toEqual({ value: MAX_AMOUNT_COP, error: '' });
  });
  it.each([[''], ['  '], ['0'], ['-5'], ['1.5'], ['1,000'], ['1.000.000'], ['12 000'], ['1e6'], ['abc'], ['12abc'], [String(MAX_AMOUNT_COP + 1)], ['99999999999999999999']])('rejects %p with a message', (raw) => {
    expect(parseAmount(en, raw).error).not.toBe('');
  });
});

describe('Spanish messages (same checks, same limits)', () => {
  it('accepts what English accepts', () => {
    expect(checkText(es, 'Warehouse Wi-Fi', 'name')).toBe('');
    expect(checkText(es, 'a'.repeat(MAX_TEXT), 'name')).toBe('');
    expect(parseAmount(es, '12000000')).toEqual({ value: 12_000_000, error: '' });
  });
  it('says what is missing, with the right name of the field', () => {
    expect(checkText(es, '', 'project name')).toBe('Escribe el nombre del proyecto.');
    expect(checkText(es, '   ', 'client name')).toBe('Escribe el nombre del cliente.');
    expect(checkText(es, '', 'milestone name')).toBe('Escribe el nombre del hito.');
    expect(checkText(es, '', 'name')).toBe('Escribe el nombre.');
  });
  it('too long and forbidden characters', () => {
    expect(checkText(es, 'a'.repeat(MAX_TEXT + 1), 'client name')).toBe('El nombre del cliente es demasiado largo (máximo 120 caracteres).');
    expect(checkText(es, 'a\u0000b', 'name')).toBe('El nombre tiene caracteres que no se permiten.');
  });
  it.each([['', 'Escribe el monto en pesos.'], ['1.5', 'Usa solo dígitos, como 12000000 (sin puntos, comas ni espacios).'], ['0', 'El monto debe ser de al menos 1 peso.'], [String(MAX_AMOUNT_COP + 1), 'El monto no puede superar 1.000.000.000 de pesos.']])('amount %p', (raw, message) => {
    expect(parseAmount(es, raw).error).toBe(message);
  });
  it('rejects exactly the same inputs in both languages', () => {
    for (const raw of ['', '  ', '0', '-5', '1.5', '1,000', '12abc', String(MAX_AMOUNT_COP + 1)]) expect(parseAmount(es, raw).error !== '').toBe(parseAmount(en, raw).error !== '');
  });
  it('English text is unchanged', () => {
    expect(checkText(en, '', 'project name')).toBe('Enter the project name.');
    expect(parseAmount(en, '1,000').error).toBe('Use digits only, like 12000000 (no dots, commas or spaces).');
  });
});
