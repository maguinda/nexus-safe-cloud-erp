import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n';
import { actionsFor, E_STATUS, FIELD_MAX, forPanel, nitCheckDigit, validateFiscalForm, xmlFileName } from './einvoice';
import type { EInvoiceListStatus } from './types';

const ALL: EInvoiceListStatus[] = ['not_issued', 'not_applicable', 'pending_customer_data', 'ready', 'generated', 'sandbox_simulated'];

describe('nitCheckDigit (the same values the server tests, computed independently)', () => {
  it.each([['800197268', 4], ['900123456', 8], ['900000001', 2], ['900000002', 1], ['900000003', 7], ['860000000', 0], ['123456789', 6], ['1', 8]])('NIT %s -> %i', (nit, dv) => { expect(nitCheckDigit(nit)).toBe(dv); });
});

describe('validateFiscalForm (same criteria as the server)', () => {
  const ok = { nit: '900.000.001-2', email: 'Cuentas@Banco.example', address: 'Carrera 7 # 8-9', city: 'Bogotá' };
  it('accepts valid data, with or without the check digit and with dots', () => {
    expect(validateFiscalForm(ok)).toEqual({});
    expect(validateFiscalForm({ ...ok, nit: '900000001' })).toEqual({});
    expect(validateFiscalForm({ ...ok, nit: ' 900 000 001-2 ' })).toEqual({});
  });
  it.each<[string, Partial<typeof ok>, Record<string, string>]>([
    ['an empty NIT', { nit: '' }, { nit: 'required' }], ['a wrong check digit', { nit: '900000001-9' }, { nit: 'nitInvalid' }], ['letters in the NIT', { nit: '9000A0001' }, { nit: 'nitInvalid' }],
    ['a short NIT', { nit: '12345' }, { nit: 'nitInvalid' }], ['a long NIT', { nit: '12345678901' }, { nit: 'nitInvalid' }], ['no email', { email: '' }, { email: 'required' }],
    ['an email without domain', { email: 'x@y' }, { email: 'emailInvalid' }], ['an email with a comma', { email: 'a,b@c.co' }, { email: 'emailInvalid' }], ['an email over 254', { email: `${'a'.repeat(60)}@${'b'.repeat(200)}.co` }, { email: 'emailInvalid' }],
    ['a blank address', { address: '   ' }, { address: 'required' }], ['an address over 200', { address: 'a'.repeat(201) }, { address: 'textInvalid' }], ['a control character in the city', { city: 'Cali\u0000' }, { city: 'textInvalid' }], ['a city over 80', { city: 'a'.repeat(81) }, { city: 'textInvalid' }],
  ])('rejects %s', (_n, over, expected) => { expect(validateFiscalForm({ ...ok, ...over })).toEqual(expected); });
  it('reports every wrong field at once', () => { expect(Object.keys(validateFiscalForm({ nit: '', email: '', address: '', city: '' })).sort()).toEqual(['address', 'city', 'email', 'nit']); });
  it('the limits of the inputs are the ones of the server (nothing is cut silently)', () => { expect(FIELD_MAX).toEqual({ nit: 16, email: 254, address: 200, city: 80 }); });
});

describe('statuses and actions', () => {
  it('every status has a Spanish and an English label and none says accepted or valid', () => {
    for (const s of ALL) {
      for (const lang of ['es', 'en'] as const) {
        const text = MESSAGES[lang][E_STATUS[s].label];
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toMatch(/accepted|aceptad|v[aá]lid[ao]/i);
      }
    }
  });
  it('what each status offers', () => {
    expect(actionsFor('not_issued')).toEqual({ data: false, generate: false, view: false, submit: false, deliver: false });
    expect(actionsFor('not_applicable')).toEqual({ data: false, generate: false, view: false, submit: false, deliver: false });
    expect(actionsFor('pending_customer_data')).toEqual({ data: true, generate: false, view: false, submit: false, deliver: false });
    expect(actionsFor('ready')).toEqual({ data: true, generate: true, view: false, submit: false, deliver: false });
    expect(actionsFor('generated')).toEqual({ data: false, generate: false, view: true, submit: true, deliver: true });
    expect(actionsFor('sandbox_simulated')).toEqual({ data: false, generate: false, view: true, submit: false, deliver: true });
  });
  it('only issued invoices are in the panel', () => { expect(forPanel([{ status: 'draft' }, { status: 'issued' }, { status: 'issued' }])).toHaveLength(2); });
  it('the file name keeps letters and digits only and never comes out empty', () => {
    expect(xmlFileName('FE1000')).toBe('FE1000.xml');
    expect(xmlFileName('../../etc/passwd"; x=')).toBe('etcpasswdx.xml');
    expect(xmlFileName('///')).toBe('factura.xml');
    expect(xmlFileName('A'.repeat(100))).toHaveLength(28);
  });
  it('the banner says it in both languages: sandbox, no legal validity', () => {
    expect(MESSAGES.es['einv.banner']).toContain('SANDBOX – SIN VALIDEZ LEGAL');
    expect(MESSAGES.en['einv.banner']).toContain('SANDBOX – NO LEGAL VALIDITY');
  });
});
