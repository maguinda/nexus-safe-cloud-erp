import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EInvoiceNotReadyError, InvalidCustomerError } from '../errors';
import { computeCufe, money } from './cufe';
import { customerKey, validateCustomer } from './customer';
import { buildElectronicInvoice, colombiaDateTime, EInvoiceInput, Party } from './document';
import { buildInvoiceHtml } from './html';
import { LEGAL_NOTICE_ES } from './legal';
import { nitCheckDigit } from './nit';
import { SandboxEInvoiceProvider } from './provider';
import { xmlEscape } from './xml';

const supplier: Party = { nit: '900123456', dv: 8, name: 'Velocity Softworks (sandbox)', address: 'Calle 1 No 2-3', city: 'Medellín', email: 'facturacion@velocity.example' };
const customer: Party = { nit: '900000001', dv: 2, name: 'Banco Andino (example)', address: 'Carrera 7 # 8-9', city: 'Bogotá', email: 'cuentas@banco.example' };
const input = (over: Partial<EInvoiceInput> = {}): EInvoiceInput => ({
  invoice: { number: 'INV-0103', projectName: 'Branch network upgrade', milestoneName: 'Link redundancy design', amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, issuedAt: new Date('2026-10-29T15:15:30.000Z'), dueDate: new Date('2026-11-28T15:15:30.000Z') },
  supplier, customer, numbering: { prefix: 'FE', consecutive: 1000 }, environment: 'sandbox', technicalKey: 'sandbox-technical-key', verifyUrlBase: 'http://localhost:8080/sandbox/einvoice/verify?documentkey=', ...over,
});

describe('nitCheckDigit', () => {
  it.each([['800197268', 4], ['900123456', 8], ['900000001', 2], ['860000000', 0], ['123456789', 6], ['1', 8]])('NIT %s -> DV %i (values computed independently)', (nit, dv) => { expect(nitCheckDigit(nit)).toBe(dv); });
  it.each([[''], ['12a'], ['1234567890123456'], ['-1'], ['1.5'], [' 1']])('rejects %p', (bad) => { expect(() => nitCheckDigit(bad)).toThrow(InvalidCustomerError); });
});

describe('demo clients of the seed (fictitious data)', () => {
  const demo: { name: string; key: string; nit: string; dv: number; email: string; address: string; city: string }[] = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'demo-customers.json'), 'utf8'));
  it.each(demo.map((c) => [c.name, c] as const))('%s: its DV is the real one, its key is the normalized name and it passes the same validation as a customer typed by hand', (_n, c) => {
    expect(c.dv).toBe(nitCheckDigit(c.nit));
    expect(c.key).toBe(customerKey(c.name));
    expect(validateCustomer({ name: c.name, nit: `${c.nit}-${c.dv}`, email: c.email, address: c.address, city: c.city })).toMatchObject({ nit: c.nit, dv: c.dv });
  });
  it('there are the three clients of the demo projects', () => { expect(demo.map((c) => c.name)).toEqual(['Banco Andino (example)', 'Retail Norte (example)', 'Pyme Sur (example)']); });
});

describe('validateCustomer', () => {
  const ok = { name: '  Banco   Andino (example) ', nit: '900.000.001-2', email: 'Cuentas@Banco.example', address: 'Carrera 7 # 8-9', city: 'Bogotá' };
  it('cleans the text, drops the dots of the NIT, computes the DV and lowercases the email', () => {
    expect(validateCustomer(ok)).toEqual({ name: 'Banco Andino (example)', nit: '900000001', dv: 2, email: 'cuentas@banco.example', address: 'Carrera 7 # 8-9', city: 'Bogotá' });
  });
  it('accepts a NIT without DV', () => { expect(validateCustomer({ ...ok, nit: '900000001' }).dv).toBe(2); });
  it.each<[string, unknown]>([
    ['a wrong check digit', { ...ok, nit: '900000001-3' }], ['letters in the NIT', { ...ok, nit: '90000A001' }], ['a NIT too short', { ...ok, nit: '12345' }], ['a NIT too long', { ...ok, nit: '12345678901' }],
    ['no email', { ...ok, email: undefined }], ['an email without a domain', { ...ok, email: 'x@y' }], ['an email with a comma', { ...ok, email: 'a,b@c.co' }], ['an email over 254', { ...ok, email: `${'a'.repeat(60)}@${'b'.repeat(200)}.co` }],
    ['control characters in the name', { ...ok, name: 'Banco\u0000X' }], ['an empty name', { ...ok, name: '   ' }], ['a name over 120', { ...ok, name: 'a'.repeat(121) }],
    ['a number as name', { ...ok, name: 123 }], ['null', null], ['an array', []], ['a string', 'x'],
  ])('rejects %s', (_n, raw) => { expect(() => validateCustomer(raw)).toThrow(InvalidCustomerError); });
  it('turns any whitespace, even a line or paragraph separator, into one plain space (nothing multi-line reaches the XML)', () => {
    expect(validateCustomer({ ...ok, address: `Calle 1${String.fromCharCode(0x2028)}#   2${String.fromCharCode(0x2029)}-3\n4` }).address).toBe('Calle 1 # 2 -3 4');
  });
  it('keeps markup as plain text (escaping happens when the document is written)', () => { expect(validateCustomer({ ...ok, name: '<b>Banco</b> & Cía' }).name).toBe('<b>Banco</b> & Cía'); });
  it('customerKey ignores case, accents and extra spaces', () => { expect(customerKey('  Banco  ANDINO Ñandú ')).toBe(customerKey('banco andino nandu')); });
});

describe('CUFE', () => {
  const base = { number: 'FE1000', issueDate: '2026-10-29', issueTime: '10:15:30-05:00', subtotalCop: 1_000_000, ivaCop: 190_000, totalCop: 1_190_000, supplierNit: '900123456', customerNit: '900000001', technicalKey: 'sandbox-technical-key', environmentCode: '2' };
  it('is the SHA-384 of the concatenation of the Anexo Técnico (a known vector computed independently with Python)', () => {
    expect(computeCufe(base)).toBe('0cf397d84547d606136811863cb2376a4c84a463ff0288ce2e32c16e143e85776cbfb9dd36a55e78bba1ba0e0ff4f5bf');
  });
  it('has 96 hexadecimal characters and changes with ANY field', () => {
    const c = computeCufe(base);
    expect(c).toMatch(/^[0-9a-f]{96}$/);
    for (const [k, v] of Object.entries({ number: 'FE1001', issueDate: '2026-10-30', issueTime: '10:15:31-05:00', subtotalCop: 1_000_001, ivaCop: 190_001, totalCop: 1_190_001, supplierNit: '900123457', customerNit: '900000002', technicalKey: 'other', environmentCode: '1' })) {
      expect(computeCufe({ ...base, [k]: v })).not.toBe(c);
    }
  });
  it('money writes whole pesos with two decimals and refuses fractions, negatives and unsafe numbers', () => {
    expect(money(0)).toBe('0.00'); expect(money(1_190_000)).toBe('1190000.00');
    for (const bad of [1.5, -1, Number.NaN, Infinity, 2 ** 60]) expect(() => money(bad)).toThrow(RangeError);
  });
  it('the formula is written out in the test, not borrowed from the code under test', () => {
    const raw = 'FE1000' + '2026-10-29' + '10:15:30-05:00' + '1000000.00' + '01' + '190000.00' + '04' + '0.00' + '03' + '0.00' + '1190000.00' + '900123456' + '900000001' + 'sandbox-technical-key' + '2';
    expect(computeCufe(base)).toBe(createHash('sha384').update(raw).digest('hex'));
  });
});

describe('colombiaDateTime (UTC-5, one clock)', () => {
  it('shifts five hours back and writes the offset', () => { expect(colombiaDateTime(new Date('2026-10-29T15:15:30.000Z'))).toEqual({ date: '2026-10-29', time: '10:15:30-05:00' }); });
  it('crosses midnight backwards: 03:00 UTC is 22:00 of the previous day in Colombia', () => { expect(colombiaDateTime(new Date('2026-10-29T03:00:00.000Z'))).toEqual({ date: '2026-10-28', time: '22:00:00-05:00' }); });
});

/** Revisa que las etiquetas abran y cierren en orden (no hay parser de XML en Node). */
function wellFormed(xml: string): boolean {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue;
    if (m[1] === '/') { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]);
  }
  return stack.length === 0;
}

describe('buildElectronicInvoice', () => {
  it('numbers the document prefix + consecutive and carries the CUFE of those exact values', () => {
    const d = buildElectronicInvoice(input());
    expect(d.number).toBe('FE1000');
    expect(d.cufe).toBe(computeCufe({ number: 'FE1000', issueDate: '2026-10-29', issueTime: '10:15:30-05:00', subtotalCop: 1_000_000, ivaCop: 190_000, totalCop: 1_190_000, supplierNit: '900123456', customerNit: '900000001', technicalKey: 'sandbox-technical-key', environmentCode: '2' }));
    expect(d.xml).toContain(`<cbc:UUID schemeID="2" schemeName="CUFE-SHA384">${d.cufe}</cbc:UUID>`);
  });
  it('writes the amounts of the invoice as they are (no recalculation) and they add up', () => {
    const { xml } = buildElectronicInvoice(input());
    expect(xml).toContain('<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>');
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="COP">1190000.00</cbc:TaxInclusiveAmount>');
    expect(xml).toContain('<cbc:LineExtensionAmount currencyID="COP">1000000.00</cbc:LineExtensionAmount>');
    expect((xml.match(/190000\.00/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it.each([[1, 0], [3, 1], [50, 10], [333, 63], [999_999_999, 190_000_000]])('with a subtotal of %i the IVA %i appears EVERYWHERE as the book says (XML, QR and CUFE), never recalculated', (amount, tax) => {
    const d = buildElectronicInvoice(input({ invoice: { ...input().invoice, amountCop: amount, taxCop: tax, totalCop: amount + tax } }));
    const taxes = [...d.xml.matchAll(/<cbc:TaxAmount currencyID="COP">([^<]+)</g)].map((m) => m[1]);
    expect(taxes).toEqual(Array(taxes.length).fill(money(tax))); expect(taxes.length).toBe(4);
    expect(d.qrText).toContain(`ValIva: ${money(tax)}`); expect(d.qrText).toContain(`ValTolFac: ${money(amount + tax)}`); expect(d.qrText).toContain(`ValFac: ${money(amount)}`);
    expect(d.cufe).toBe(computeCufe({ number: 'FE1000', issueDate: '2026-10-29', issueTime: '10:15:30-05:00', subtotalCop: amount, ivaCop: tax, totalCop: amount + tax, supplierNit: '900123456', customerNit: '900000001', technicalKey: 'sandbox-technical-key', environmentCode: '2' }));
  });
  it('REFUSES to write a document whose invoice totals do not add up or do not follow the 19 % IVA rule (it never "fixes" money, and never says 19 % about another rate)', () => {
    expect(() => buildElectronicInvoice(input({ invoice: { ...input().invoice, taxCop: 190_001 } }))).toThrow(EInvoiceNotReadyError);
    expect(() => buildElectronicInvoice(input({ invoice: { ...input().invoice, taxCop: 100_000, totalCop: 1_100_000 } }))).toThrow(/19 % IVA rule/);
    expect(() => buildElectronicInvoice(input({ invoice: { ...input().invoice, taxCop: 0, totalCop: 1_000_000 } }))).toThrow(EInvoiceNotReadyError);
    expect(() => buildElectronicInvoice(input({ invoice: { ...input().invoice, totalCop: 1_190_001 } }))).toThrow(EInvoiceNotReadyError);
  });
  it('issue and due dates use the SAME zone: issued at 22:00 in Colombia (03:00 UTC next day) is due exactly 30 days later by the Colombian calendar', () => {
    const issuedAt = new Date('2026-10-30T03:00:00.000Z');
    const d = buildElectronicInvoice(input({ invoice: { ...input().invoice, issuedAt, dueDate: new Date(issuedAt.getTime() + 30 * 86_400_000) } }));
    expect([d.issueDate, d.issueTime, d.dueDate]).toEqual(['2026-10-29', '22:00:00-05:00', '2026-11-28']);
    expect(d.xml).toContain('<cbc:DueDate>2026-11-28</cbc:DueDate>');
  });
  it('at the very start and end of a Colombian day the dates do not slip (00:00:00 and 23:59:59 COT)', () => {
    const at = (iso: string) => buildElectronicInvoice(input({ invoice: { ...input().invoice, issuedAt: new Date(iso), dueDate: new Date(new Date(iso).getTime() + 30 * 86_400_000) } }));
    expect([at('2026-10-29T05:00:00.000Z').issueDate, at('2026-10-29T05:00:00.000Z').dueDate]).toEqual(['2026-10-29', '2026-11-28']);
    expect([at('2026-10-30T04:59:59.000Z').issueDate, at('2026-10-30T04:59:59.000Z').dueDate]).toEqual(['2026-10-29', '2026-11-28']);
  });
  it('is well formed and carries the legal notice in Spanish and English, the unsigned marker and the sandbox environment', () => {
    const { xml } = buildElectronicInvoice(input());
    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain(LEGAL_NOTICE_ES);
    expect(xml).toContain('SANDBOX – NO LEGAL VALIDITY');
    expect(xml).toContain('SIN FIRMAR');
    expect(xml).toContain('<cbc:ProfileExecutionID>2</cbc:ProfileExecutionID>');
  });
  it('ESCAPES hostile text: markup, ampersands, quotes, a CDATA end, control characters and emoji never break the XML or become tags', () => {
    const evil = `<script>alert(1)</script> & "q" 'a' ]]> \u0000\u0008 🚀`;
    const { xml } = buildElectronicInvoice(input({ customer: { ...customer, name: evil, address: evil, city: evil, email: 'a@b.co' }, invoice: { ...input().invoice, milestoneName: evil, projectName: evil } }));
    expect(xml).not.toContain('<script>');
    expect(xml).not.toContain('\u0000'); expect(xml).not.toContain('\u0008');
    expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &apos;a&apos; ]]&gt; ');
    expect(xml).toContain('🚀');
    expect(wellFormed(xml)).toBe(true);
  });
  it('the QR text has the fields of the Anexo and a sandbox address, never the real DIAN one', () => {
    const d = buildElectronicInvoice(input());
    expect(d.qrText.split('\n')).toEqual(['NumFac: FE1000', 'FecFac: 2026-10-29', 'HorFac: 10:15:30-05:00', 'NitFac: 900123456', 'DocAdq: 900000001', 'ValFac: 1000000.00', 'ValIva: 190000.00', 'ValOtroIm: 0.00', 'ValTolFac: 1190000.00', `CUFE: ${d.cufe}`, `http://localhost:8080/sandbox/einvoice/verify?documentkey=${d.cufe}`]);
    expect(d.qrText).not.toContain('dian.gov.co');
  });
  it('keeps an independent copy of both parties (the snapshot) and the due date of the invoice', () => {
    const d = buildElectronicInvoice(input());
    expect(d.customer).toEqual(customer); expect(d.supplier).toEqual(supplier); expect(d.dueDate).toBe('2026-11-28');
  });
  it('rejects a consecutive that is not a positive integer', () => { for (const c of [0, -1, 1.5, Number.NaN]) expect(() => buildElectronicInvoice(input({ numbering: { prefix: 'FE', consecutive: c } }))).toThrow(RangeError); });
});

describe('buildInvoiceHtml', () => {
  const d = buildElectronicInvoice(input());
  const html = buildInvoiceHtml(d, input().invoice, '<svg>QR</svg>');
  it('shows the legal notice first, as an alert, in both languages', () => {
    expect(html.indexOf(LEGAL_NOTICE_ES.replace(/&/g, '&amp;'))).toBeGreaterThan(-1);
    expect(html).toContain('role="alert"'); expect(html).toContain('NO LEGAL VALIDITY');
  });
  it('contains the number, the CUFE, the totals and the parties, and the QR svg as is', () => {
    for (const t of ['FE1000', d.cufe, '1.190.000 COP', 'NIT 900000001-2', 'NIT 900123456-8', '<svg>QR</svg>']) expect(html).toContain(t);
  });
  it('carries its OWN content security policy (a blob: page opened by the app does not inherit the header of the server): no scripts, no external resources', () => {
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'">');
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<style>')); // la política va antes que cualquier otra cosa de la página
  });
  it('escapes EVERY text field of the page (city, email, address, supplier, dates, project, milestone), not only the name', () => {
    const evil = '<b id=x>&"\'';
    const hostile = { nit: '900000001', dv: 2, name: evil, address: evil, city: evil, email: evil };
    const doc = buildElectronicInvoice(input({ customer: hostile, supplier: { ...supplier, name: evil, city: evil, address: evil, email: evil } }));
    const out = buildInvoiceHtml({ ...doc, issueDate: evil, issueTime: evil, dueDate: evil }, { ...input().invoice, projectName: evil, milestoneName: evil, number: evil }, '<svg></svg>');
    expect(out).not.toContain('<b id=x>');
    expect(out.match(/&lt;b id=x&gt;&amp;&quot;&#39;|&lt;b id=x&gt;&amp;&quot;&apos;/g)?.length).toBeGreaterThanOrEqual(12);
  });
  it('escapes hostile text and has no scripts or event handlers', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const doc = buildElectronicInvoice(input({ customer: { ...customer, name: evil } }));
    const out = buildInvoiceHtml(doc, { ...input().invoice, milestoneName: evil }, '<svg></svg>');
    expect(out).not.toContain('<img'); expect(out).not.toMatch(/<script/i); expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('xmlEscape', () => {
  it('escapes the five specials and drops what XML 1.0 forbids (controls, lone surrogates), keeping tab/newline', () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
    expect(xmlEscape('x\u0000y\u000bz\ud800w\ta\nb')).toBe('xyzw\ta\nb');
  });
});

describe('SandboxEInvoiceProvider', () => {
  it('answers sandbox_simulated with a reference, never accepted', async () => {
    const r = await new SandboxEInvoiceProvider(() => 'SANDBOX-1').submit();
    expect(r).toEqual({ ref: 'SANDBOX-1', status: 'sandbox_simulated' });
    expect(JSON.stringify(r)).not.toMatch(/accept/i);
  });
});
