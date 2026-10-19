import { describe, expect, it } from 'vitest';
import { checkText, MAX_AMOUNT_COP, MAX_TEXT, parseAmount } from './validate';

describe('checkText', () => {
  it('accepts normal and exactly-limit text', () => {
    expect(checkText('Warehouse Wi-Fi', 'name')).toBe('');
    expect(checkText('a'.repeat(MAX_TEXT), 'name')).toBe('');
    expect(checkText('Instalación ñandú 🚀', 'name')).toBe('');
  });
  it('rejects empty, blank and too long with a message (never cuts silently)', () => {
    expect(checkText('', 'name')).toMatch(/Enter the name/);
    expect(checkText('   ', 'name')).toMatch(/Enter the name/);
    expect(checkText('a'.repeat(MAX_TEXT + 1), 'client')).toMatch(/too long \(120/);
  });
  it('rejects control characters', () => {
    expect(checkText('a\u0000b', 'name')).toMatch(/not allowed/);
  });
  it('counts like the server: collapsed spaces and trimmed ends', () => {
    expect(checkText(`  ${'a'.repeat(MAX_TEXT)}  `, 'name')).toBe('');
  });
});

describe('parseAmount', () => {
  it('accepts whole pesos between 1 and the cap', () => {
    expect(parseAmount('12000000')).toEqual({ value: 12_000_000, error: '' });
    expect(parseAmount(' 1 ')).toEqual({ value: 1, error: '' });
    expect(parseAmount(String(MAX_AMOUNT_COP))).toEqual({ value: MAX_AMOUNT_COP, error: '' });
  });
  it.each([[''], ['  '], ['0'], ['-5'], ['1.5'], ['1,000'], ['1.000.000'], ['12 000'], ['1e6'], ['abc'], ['12abc'], [String(MAX_AMOUNT_COP + 1)], ['99999999999999999999']])('rejects %p with a message', (raw) => {
    expect(parseAmount(raw).error).not.toBe('');
  });
});
