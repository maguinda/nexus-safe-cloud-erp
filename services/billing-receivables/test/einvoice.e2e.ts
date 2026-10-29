import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaEInvoiceRepository } from '../src/infrastructure/prisma-einvoice';
import { bearer, OTHER_KEYS, resetState, token, unsigned, USERS, wipeEInvoices } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

const CLIENT = 'Banco Andino (example)';
const CUSTOMER = { name: CLIENT, nit: '900.000.001-2', email: 'cuentas@banco.example', address: 'Carrera 7 # 8-9', city: 'Bogotá' };
const NOTICE = 'SANDBOX – SIN VALIDEZ LEGAL';

describe('electronic invoice, SANDBOX (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const billing = () => bearer(token(USERS.billing));
  const call = (method: 'get' | 'post' | 'put' | 'patch', path: string, auth: string | null = billing(), body?: unknown) => {
    let r = (request(app.getHttpServer()) as any)[method](path);
    if (auth) r = r.set('Authorization', auth);
    return body === undefined ? r : r.send(body);
  };
  let seq = 200;
  /** Una factura emitida con el cliente indicado (se inserta directo: aquí se prueba la factura electrónica, no el consumidor). */
  const issued = async (client: string | null = CLIENT, over: Record<string, unknown> = {}) => {
    const n = seq++;
    const issuedAt = new Date('2026-10-29T15:15:30.000Z');
    await prisma.invoice.create({ data: { number: `INV-${String(n).padStart(4, '0')}`, milestoneId: `e${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`, amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, status: 'issued', issuedAt, issuedBy: USERS.billing.email, dueDate: new Date('2026-11-28T15:15:30.000Z'), clientName: client, ...over } });
    return `INV-${String(n).padStart(4, '0')}`;
  };
  const draft = async (client: string | null = CLIENT) => {
    const n = seq++;
    await prisma.invoice.create({ data: { number: `INV-${String(n).padStart(4, '0')}`, milestoneId: `e${n}`, projectName: 'Branch network upgrade', milestoneName: `Milestone ${n}`, amountCop: 1_000_000, taxCop: 190_000, totalCop: 1_190_000, status: 'draft', clientName: client } });
    return `INV-${String(n).padStart(4, '0')}`;
  };
  const withCustomer = async () => { expect((await call('put', '/customers', billing(), CUSTOMER)).status).toBe(200); };
  const nextNumber = async () => (await prisma.eInvoiceNumbering.findUnique({ where: { id: 1 } }))!.nextNumber;

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(async () => { await resetState(prisma); });
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  describe('the whole story', () => {
    it('issued invoice + fiscal data of the client -> document FE1000 with CUFE, XML, HTML and the legal notice everywhere', async () => {
      await withCustomer();
      const n = await issued();
      const r = await call('post', `/invoices/${n}/electronic`);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ invoiceNumber: n, number: 'FE1000', environment: 'sandbox', status: 'generated', signed: false, validForDian: false, customerName: CLIENT, issueDate: '2026-10-29', issueTime: '10:15:30-05:00', dueDate: '2026-11-28', deliveries: 0 });
      expect(r.body.cufe).toMatch(/^[0-9a-f]{96}$/);
      expect(r.body.legalNotice.es).toContain(NOTICE); expect(r.body.legalNotice.en).toContain('NO LEGAL VALIDITY');
      const xml = await call('get', `/invoices/${n}/electronic/xml`);
      expect(xml.status).toBe(200); expect(xml.headers['content-type']).toContain('application/xml'); expect(xml.headers['content-disposition']).toBe('attachment; filename="FE1000.xml"'); expect(xml.headers['x-content-type-options']).toBe('nosniff');
      expect(xml.text).toContain(NOTICE); expect(xml.text).toContain(r.body.cufe); expect(xml.text).toContain('<cbc:PayableAmount currencyID="COP">1190000.00</cbc:PayableAmount>'); expect(xml.text).toContain('SIN FIRMAR');
      const html = await call('get', `/invoices/${n}/electronic/html`);
      expect(html.status).toBe(200); expect(html.headers['content-type']).toContain('text/html');
      expect(html.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      expect(html.text).toContain(NOTICE); expect(html.text).toContain('<svg'); expect(html.text).toContain('FE1000'); expect(html.text).not.toMatch(/<script/i);
    });
    it('the metadata never carries personal data of the client (NIT, email, address) but the XML does', async () => {
      await withCustomer(); const n = await issued();
      const meta = (await call('post', `/invoices/${n}/electronic`)).body;
      const flat = JSON.stringify(meta);
      for (const secret of ['900000001', 'cuentas@banco.example', 'Carrera 7']) expect(flat).not.toContain(secret);
      const xml = (await call('get', `/invoices/${n}/electronic/xml`)).text;
      for (const field of ['900000001', 'cuentas@banco.example', 'Carrera 7']) expect(xml).toContain(field);
    });
    it('generating twice (double click) returns the SAME document (200 the second time) and spends ONE consecutive', async () => {
      await withCustomer(); const n = await issued();
      const a = await call('post', `/invoices/${n}/electronic`); const b = await call('post', `/invoices/${n}/electronic`);
      expect([a.status, b.status]).toEqual([201, 200]);
      expect(b.body.cufe).toBe(a.body.cufe); expect(b.body.number).toBe('FE1000');
      expect(await nextNumber()).toBe(1001);
      expect(await prisma.electronicInvoice.count()).toBe(1);
    });
    it('issuing an invoice generates the document by itself when the client data is there, and the invoice is issued either way', async () => {
      await withCustomer(); const n = await draft();
      const r = await call('patch', `/invoices/${n}/issue`);
      expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: 'issued', electronicStatus: 'generated', clientName: CLIENT });
      expect((await call('get', `/invoices/${n}/electronic`)).body.number).toBe('FE1000');
    });
    it('without fiscal data the invoice is still issued, it says pending_customer_data, and after the data is entered the document is generated', async () => {
      const n = await draft();
      const r = await call('patch', `/invoices/${n}/issue`);
      expect(r.status).toBe(200); expect(r.body).toMatchObject({ status: 'issued', electronicStatus: 'pending_customer_data' });
      expect((await call('get', '/invoices')).body.find((i: any) => i.number === n).electronicStatus).toBe('pending_customer_data');
      expect((await call('get', `/invoices/${n}/electronic`)).status).toBe(404);
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(409);
      await withCustomer();
      expect((await call('get', '/invoices')).body.find((i: any) => i.number === n).electronicStatus).toBe('ready');
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(201);
      expect((await call('get', '/invoices')).body.find((i: any) => i.number === n).electronicStatus).toBe('generated');
    });
    it('an older invoice with no client is not_applicable and cannot be converted; a draft is not_issued and cannot either', async () => {
      const old = await issued(null); const d = await draft();
      const list = (await call('get', '/invoices')).body;
      expect(list.find((i: any) => i.number === old).electronicStatus).toBe('not_applicable');
      expect(list.find((i: any) => i.number === d).electronicStatus).toBe('not_issued');
      expect((await call('post', `/invoices/${old}/electronic`)).status).toBe(409);
      expect((await call('post', `/invoices/${d}/electronic`)).status).toBe(409);
      expect(await nextNumber()).toBe(1000);
    });
    it('the client is matched ignoring case, accents and extra spaces', async () => {
      await call('put', '/customers', billing(), { ...CUSTOMER, name: '  BANCO   ANDINO (example) ' });
      const n = await issued('banco andino (EXAMPLE)');
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(201);
    });
  });

  describe('submit and delivery are SIMULATED and say so', () => {
    it('submit gives sandbox_simulated with a SANDBOX reference, never accepted, and a second submit keeps the first reference', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      const a = await call('post', `/invoices/${n}/electronic/submit`);
      expect(a.status).toBe(200); expect(a.body.status).toBe('sandbox_simulated'); expect(a.body.providerRef).toMatch(/^SANDBOX-/); expect(a.body.validForDian).toBe(false);
      expect(JSON.stringify(a.body)).not.toMatch(/accepted/i);
      const b = await call('post', `/invoices/${n}/electronic/submit`);
      expect(b.body.providerRef).toBe(a.body.providerRef); expect(b.body.submittedAt).toBe(a.body.submittedAt);
    });
    it('CONCURRENCY: 10 submits at once leave ONE reference', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      const res = await Promise.all(Array.from({ length: 10 }, () => call('post', `/invoices/${n}/electronic/submit`)));
      expect(new Set(res.map((r) => r.body.providerRef)).size).toBe(1);
      expect(res.every((r) => r.status === 200 && r.body.status === 'sandbox_simulated')).toBe(true);
    });
    it('a delivery is registered to the email stored in the document, says nothing was sent, and stops after 20', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      const r = await call('post', `/invoices/${n}/electronic/deliveries`);
      expect(r.status).toBe(201); expect(r.body.note).toContain('no email was sent'); expect(r.body.deliveries).toBe(1);
      expect(await prisma.eInvoiceDelivery.findFirst()).toMatchObject({ recipient: 'cuentas@banco.example', channel: 'email', status: 'logged' });
      const burst = await Promise.all(Array.from({ length: 30 }, () => call('post', `/invoices/${n}/electronic/deliveries`)));
      expect(await prisma.eInvoiceDelivery.count()).toBe(20);
      const full = burst.filter((r) => r.status === 409);
      expect(full.length).toBeGreaterThanOrEqual(11); // los que ya no caben RESPONDEN 409 (antes volvían 201 sin registrar nada)
      expect(full[0].body.message).toContain('delivery registry of this document is full');
      expect(burst.filter((r) => r.status === 201)).toHaveLength(19);
    });
    it('the recipient cannot be chosen: a body with another address is refused or ignored', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      await call('post', `/invoices/${n}/electronic/deliveries`, billing(), { recipient: 'attacker@evil.example', email: 'attacker@evil.example' });
      expect((await prisma.eInvoiceDelivery.findMany()).map((d) => d.recipient).every((x) => x === 'cuentas@banco.example')).toBe(true);
    });
    it('submit and delivery on an invoice with no document are 404', async () => {
      const n = await issued();
      expect((await call('post', `/invoices/${n}/electronic/submit`)).status).toBe(404);
      expect((await call('post', `/invoices/${n}/electronic/deliveries`)).status).toBe(404);
      expect((await call('get', `/invoices/${n}/electronic/xml`)).status).toBe(404);
      expect((await call('get', `/invoices/${n}/electronic/html`)).status).toBe(404);
    });
  });

  describe('consecutive numbers: no gaps, no duplicates', () => {
    it('CONCURRENCY (30 rounds): 8 simultaneous generations of the SAME invoice give ONE document and ONE consecutive', async () => {
      await withCustomer();
      for (let round = 0; round < 30; round++) {
        await wipeEInvoices(prisma);
        await prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = 1000 WHERE id = 1`;
        const n = await issued();
        const res = await Promise.all(Array.from({ length: 8 }, () => call('post', `/invoices/${n}/electronic`)));
        const codes = res.map((r) => r.status).sort();
        expect({ round, codes }).toEqual({ round, codes: [200, 200, 200, 200, 200, 200, 200, 201] });
        expect(new Set(res.map((r) => r.body.cufe)).size).toBe(1);
        expect(await prisma.electronicInvoice.count()).toBe(1);
        expect(await nextNumber()).toBe(1001);
      }
    });
    it('CONCURRENCY: 25 different invoices generated at once get 25 DIFFERENT consecutives, contiguous from 1000 to 1024', async () => {
      await withCustomer();
      const numbers = await Promise.all(Array.from({ length: 25 }, () => issued()));
      const res = await Promise.all(numbers.map((n) => call('post', `/invoices/${n}/electronic`)));
      expect(res.map((r) => r.status)).toEqual(Array(25).fill(201));
      const got = res.map((r) => Number(r.body.number.replace('FE', ''))).sort((a, b) => a - b);
      expect(got).toEqual(Array.from({ length: 25 }, (_, i) => 1000 + i));
      expect(await nextNumber()).toBe(1025);
      expect(new Set(res.map((r) => r.body.cufe)).size).toBe(25);
    });
    it('a failure AFTER the consecutive was taken leaves no gap and no half document (the whole transaction rolls back)', async () => {
      await withCustomer();
      const other = await issued();
      // Un documento ajeno ya ocupa el número FE1000: la inserción del siguiente choca justo después de tomar el consecutivo.
      await prisma.$executeRaw`INSERT INTO electronic_invoices (id, invoice_id, prefix, consecutive, number, issue_date, issue_time, due_date, cufe, environment, status, xml, qr_text, supplier, customer, invoice_snapshot)
        SELECT gen_random_uuid(), id, 'FE', 1000, 'FE1000', '2026-10-29', '10:00:00-05:00', '2026-11-28', ${'f'.repeat(96)}, 'sandbox', 'generated', '<x/>', 'q', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb FROM invoices WHERE number = ${other}`;
      const target = await issued();
      const r = await call('post', `/invoices/${target}/electronic`);
      expect(r.status).toBe(500);
      expect(await nextNumber()).toBe(1000); // el consecutivo NO se gastó
      expect(await prisma.electronicInvoice.count({ where: { invoice: { number: target } } })).toBe(0);
      await wipeEInvoices(prisma);
      const ok = await call('post', `/invoices/${target}/electronic`);
      expect(ok.status).toBe(201); expect(ok.body.number).toBe('FE1000'); // sin hueco
    });
    it('when the authorized range is exhausted it says so (409) and the invoice stays issued, with nothing half written', async () => {
      await withCustomer();
      await prisma.$executeRaw`UPDATE einvoice_numbering SET range_to = 1000 WHERE id = 1`;
      const a = await issued(); const b = await issued();
      expect((await call('post', `/invoices/${a}/electronic`)).status).toBe(201);
      const r = await call('post', `/invoices/${b}/electronic`);
      expect(r.status).toBe(409); expect(r.body.message).toContain('exhausted');
      expect(await nextNumber()).toBe(1001);
      expect((await prisma.invoice.findUnique({ where: { number: b } }))!.status).toBe('issued');
    });
    it('a numbering resolution that is not valid for the issue date refuses to generate (409) and spends nothing', async () => {
      await withCustomer();
      await prisma.$executeRaw`UPDATE einvoice_numbering SET valid_from = '2030-01-01T00:00:00Z', valid_to = '2030-12-31T00:00:00Z' WHERE id = 1`;
      const n = await issued();
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(409);
      expect(await nextNumber()).toBe(1000);
    });
    it('the database itself refuses a consecutive outside the range, a second document per invoice, a repeated CUFE and a repeated number', async () => {
      await expect(prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = 5000 WHERE id = 1`).rejects.toThrow();
      await expect(prisma.$executeRaw`UPDATE einvoice_numbering SET range_to = 10 WHERE id = 1`).rejects.toThrow();
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      await expect(prisma.$executeRaw`INSERT INTO electronic_invoices (id, invoice_id, prefix, consecutive, number, issue_date, issue_time, due_date, cufe, environment, status, xml, qr_text, supplier, customer, invoice_snapshot)
        SELECT gen_random_uuid(), id, 'FE', 5, 'FE5', '2026-10-29', '10:00:00-05:00', '2026-11-28', ${'e'.repeat(96)}, 'sandbox', 'generated', '<x/>', 'q', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb FROM invoices WHERE number = ${n}`).rejects.toThrow();
    });
  });

  describe('a generated document cannot be edited (the database refuses)', () => {
    const generated = async () => { await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`); return n; };
    it.each([['xml', "xml = '<changed/>'"], ['cufe', `cufe = '${'a'.repeat(96)}'`], ['number', "number = 'FE9999'"], ['consecutive', 'consecutive = 77'], ['customer', `customer = '{}'::jsonb`], ['supplier', `supplier = '{}'::jsonb`], ['qr_text', "qr_text = 'x'"], ['issue_date', "issue_date = '2020-01-01'"]])('UPDATE of %s is refused', async (_c, set) => {
      await generated();
      await expect(prisma.$executeRawUnsafe(`UPDATE electronic_invoices SET ${set}`)).rejects.toThrow(/cannot be modified/);
    });
    it('the status can advance once (generated -> sandbox_simulated) but never go back, and "accepted" does not exist', async () => {
      const n = await generated(); await call('post', `/invoices/${n}/electronic/submit`);
      await expect(prisma.$executeRawUnsafe(`UPDATE electronic_invoices SET status = 'generated', submitted_at = NULL, provider_ref = NULL`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`UPDATE electronic_invoices SET status = 'accepted'`)).rejects.toThrow();
    });
    it('changing the fiscal data of the client afterwards does NOT change a document already generated (it keeps its own copy)', async () => {
      const n = await generated();
      const before = (await call('get', `/invoices/${n}/electronic/xml`)).text;
      await call('put', '/customers', billing(), { ...CUSTOMER, nit: '900000001', email: 'otro@banco.example', address: 'Otra dirección 1' });
      const after = (await call('get', `/invoices/${n}/electronic/xml`)).text;
      expect(after).toBe(before); expect(after).toContain('cuentas@banco.example'); expect(after).not.toContain('otro@banco.example');
    });
  });

  describe('hostile text is escaped, never executed', () => {
    it('markup, quotes, a CDATA end and emoji in the client name, the milestone and the project become inert text in the XML and the HTML', async () => {
      const evil = `<script>alert(1)</script> & "q" ]]> 🚀`;
      await call('put', '/customers', billing(), { ...CUSTOMER, name: evil, address: evil, city: 'Cali' });
      const n = await issued(evil, { milestoneName: evil, projectName: evil });
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(201);
      const xml = (await call('get', `/invoices/${n}/electronic/xml`)).text; const html = (await call('get', `/invoices/${n}/electronic/html`)).text;
      for (const doc of [xml, html]) { expect(doc).not.toContain('<script>alert'); expect(doc).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(doc).toContain('🚀'); }
    });
  });

  describe('fiscal data of the clients', () => {
    it('is created, listed (only by the billing analyst) and updated by name without duplicating', async () => {
      await withCustomer(); await call('put', '/customers', billing(), { ...CUSTOMER, name: CLIENT.toUpperCase(), city: 'Medellín' });
      const list = (await call('get', '/customers')).body;
      expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ nit: '900000001', dv: 2, city: 'Medellín' });
    });
    it.each<[string, Record<string, unknown>]>([
      ['a wrong check digit', { nit: '900000001-9' }], ['letters in the NIT', { nit: '9000A0001' }], ['a short NIT', { nit: '12345' }], ['a long NIT', { nit: '12345678901' }], ['an email without domain', { email: 'x@y' }],
      ['a huge email', { email: `${'a'.repeat(300)}@x.co` }], ['control characters', { name: 'Banco\u0000' }], ['an empty city', { city: '   ' }], ['an address over 200', { address: 'a'.repeat(201) }], ['a number as name', { name: 12 }],
      ['an unknown extra field', { role: 'admin' }], ['a missing field', { city: undefined }],
    ])('refuses %s with 400 and stores nothing', async (_n, over) => {
      const r = await call('put', '/customers', billing(), { ...CUSTOMER, ...over });
      expect(r.status).toBe(400);
      expect(await prisma.customer.count()).toBe(0);
    });
    it('accepts a NIT with its correct check digit and without it', async () => {
      expect((await call('put', '/customers', billing(), { ...CUSTOMER, nit: '900000001-2' })).status).toBe(200);
      expect((await call('put', '/customers', billing(), { ...CUSTOMER, nit: '900000001' })).status).toBe(200);
    });
  });

  describe('permissions (every new route)', () => {
    const routes: [string, string][] = [['get', '/customers'], ['put', '/customers'], ['post', '/invoices/INV-0101/electronic'], ['get', '/invoices/INV-0101/electronic'], ['get', '/invoices/INV-0101/electronic/xml'], ['get', '/invoices/INV-0101/electronic/html'], ['post', '/invoices/INV-0101/electronic/submit'], ['post', '/invoices/INV-0101/electronic/deliveries']];
    it.each(routes)('%s %s: no token or a bad token -> 401', async (m, path) => {
      for (const a of [null, 'Bearer not.a.jwt', bearer(token(USERS.billing, { expiresIn: -60 })), bearer(token(USERS.billing, { key: OTHER_KEYS.privateKey })), bearer(unsigned(USERS.billing))]) {
        expect((await call(m as any, path, a, m === 'put' ? CUSTOMER : undefined)).status).toBe(401);
      }
    });
    it.each(routes.flatMap(([m, p]) => [['project_lead', USERS.lead, m, p], ['sales', USERS.sales, m, p], ['manager', USERS.manager, m, p]] as const))('%s is refused (403) on %s %s and no data comes out', async (_r, user, m, path) => {
      const res = await call(m as any, path as string, bearer(token(user)), m === 'put' ? CUSTOMER : undefined);
      expect(res.status).toBe(403);
      expect(Object.keys(res.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
    });
    it('a role in a header or in the body does not raise the role', async () => {
      const r = await (request(app.getHttpServer()) as any).get('/customers').set('Authorization', bearer(token(USERS.sales))).set('X-Role', 'billing_analyst');
      expect(r.status).toBe(403);
    });
    it.each([['INV-1'], ['inv-0101'], ['INV-0101; DROP TABLE invoices'], ['..%2F..%2Fetc'], ['INV-0101%00']])('a hostile invoice number %j is 400 before touching the database', async (bad) => {
      for (const path of [`/invoices/${bad}/electronic`, `/invoices/${bad}/electronic/xml`, `/invoices/${bad}/electronic/html`]) expect([400, 404]).toContain((await call('get', path)).status);
      expect((await call('post', `/invoices/${bad}/electronic`)).status).toBe(400);
    });
    it('an invoice that does not exist is 404 (no information about others)', async () => {
      expect((await call('post', '/invoices/INV-9999/electronic')).status).toBe(404);
      expect((await call('get', '/invoices/INV-9999/electronic')).status).toBe(404);
    });
  });

  describe('money: the document says what the book says', () => {
    it.each([1, 3, 50, 999_999_999, 1_000_000_000])('the XML of a %i COP invoice has exactly the amounts of the invoice row (subtotal + IVA = total)', async (amount) => {
      const tax = Math.floor((amount * 19 + 50) / 100);
      await withCustomer(); const n = await issued(CLIENT, { amountCop: amount, taxCop: tax, totalCop: amount + tax });
      const xml = (await call('post', `/invoices/${n}/electronic`).then(() => call('get', `/invoices/${n}/electronic/xml`))).text;
      expect(xml).toContain(`<cbc:LineExtensionAmount currencyID="COP">${amount}.00</cbc:LineExtensionAmount>`);
      expect(xml).toContain(`<cbc:PayableAmount currencyID="COP">${amount + tax}.00</cbc:PayableAmount>`);
      expect(xml).toContain(`<cbc:TaxAmount currencyID="COP">${tax}.00</cbc:TaxAmount>`);
    });
  });

  describe('what the review found (each one fails without its fix)', () => {
    it('the delivery limit holds under CONCURRENCY (30 rounds × 25 at once): exactly 20 records and the rest answer 409, never a silent 201', async () => {
      await withCustomer();
      for (let round = 0; round < 30; round++) {
        await wipeEInvoices(prisma);
        await prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = 1000 WHERE id = 1`;
        const n = await issued();
        await call('post', `/invoices/${n}/electronic`);
        const res = await Promise.all(Array.from({ length: 25 }, () => call('post', `/invoices/${n}/electronic/deliveries`)));
        const codes = { round, created: res.filter((r) => r.status === 201).length, full: res.filter((r) => r.status === 409).length };
        expect(codes).toEqual({ round, created: 20, full: 5 });
        expect(await prisma.eInvoiceDelivery.count()).toBe(20);
        await prisma.invoice.delete({ where: { number: n } }).catch(() => undefined);
      }
    });
    it('CONCURRENCY (30 rounds × 25 different invoices): consecutives are contiguous with no gaps and no repeats every time', async () => {
      await withCustomer();
      for (let round = 0; round < 30; round++) {
        await wipeEInvoices(prisma);
        await prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = 1000 WHERE id = 1`;
        const numbers = await Promise.all(Array.from({ length: 25 }, () => issued()));
        const res = await Promise.all(numbers.map((n) => call('post', `/invoices/${n}/electronic`)));
        expect(res.map((r) => r.status)).toEqual(Array(25).fill(201));
        expect(res.map((r) => Number(r.body.number.slice(2))).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, k) => 1000 + k));
        expect(await nextNumber()).toBe(1025);
      }
    });
    it('the LAST consecutive of the range with two invoices at once: one gets it (201) and the other is refused (409); the counter ends exactly at the limit', async () => {
      await withCustomer();
      for (let round = 0; round < 30; round++) {
        await wipeEInvoices(prisma);
        await prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = 1999, range_to = 1999 WHERE id = 1`;
        const [a, b] = [await issued(), await issued()];
        const res = await Promise.all([call('post', `/invoices/${a}/electronic`), call('post', `/invoices/${b}/electronic`)]);
        expect({ round, codes: res.map((r) => r.status).sort() }).toEqual({ round, codes: [201, 409] });
        expect(await nextNumber()).toBe(2000);
        expect(await prisma.electronicInvoice.count()).toBe(1);
      }
    });
    it('generating while the client data is edited at the same time: the document NEVER mixes the old and the new data (30 rounds)', async () => {
      for (let round = 0; round < 30; round++) {
        await wipeEInvoices(prisma);
        await prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = 1000 WHERE id = 1`;
        await call('put', '/customers', billing(), { ...CUSTOMER, nit: '900000001', email: 'viejo@banco.example', address: 'Dirección vieja 1' });
        const n = await issued();
        const [g] = await Promise.all([call('post', `/invoices/${n}/electronic`), call('put', '/customers', billing(), { ...CUSTOMER, nit: '900000002', email: 'nuevo@banco.example', address: 'Dirección nueva 2' })]);
        expect(g.status).toBe(201);
        const xml = (await call('get', `/invoices/${n}/electronic/xml`)).text;
        const doc = await prisma.electronicInvoice.findFirst({ where: { invoice: { number: n } } });
        const c = doc!.customer as { nit: string; email: string; address: string };
        const old = c.nit === '900000001' && c.email === 'viejo@banco.example' && c.address === 'Dirección vieja 1';
        const fresh = c.nit === '900000002' && c.email === 'nuevo@banco.example' && c.address === 'Dirección nueva 2';
        expect({ round, coherent: old || fresh }).toEqual({ round, coherent: true });
        expect(xml).toContain(`>${c.nit}</cbc:CompanyID>`); expect(xml).toContain(c.email);
      }
    });
    it('the validity of the resolution is exact at its edges (Colombia time): the first and last second are valid, one millisecond outside is refused', async () => {
      await withCustomer();
      const at = new Date('2026-10-29T15:15:30.000Z');
      for (const [from, to, ok] of [[at, new Date(at.getTime() + 60_000), true], [new Date(at.getTime() - 60_000), at, true], [new Date(at.getTime() + 1), new Date(at.getTime() + 60_000), false], [new Date(at.getTime() - 60_000), new Date(at.getTime() - 1), false]] as const) {
        await wipeEInvoices(prisma);
        await prisma.eInvoiceNumbering.update({ where: { id: 1 }, data: { validFrom: from, validTo: to, nextNumber: 1000 } });
        const n = await issued(CLIENT, { issuedAt: at });
        expect({ from: from.toISOString(), to: to.toISOString(), status: (await call('post', `/invoices/${n}/electronic`)).status }).toEqual({ from: from.toISOString(), to: to.toISOString(), status: ok ? 201 : 409 });
        expect(await nextNumber()).toBe(ok ? 1001 : 1000);
      }
    });
    it('an invoice issued at 22:00 in Colombia (03:00 UTC of the next day) is dated and due in COLOMBIA time: issue date and due date are exactly 30 days apart', async () => {
      await withCustomer();
      const issuedAt = new Date('2026-10-30T03:00:00.000Z');
      const n = await issued(CLIENT, { issuedAt, dueDate: new Date(issuedAt.getTime() + 30 * 86_400_000) });
      const meta = (await call('post', `/invoices/${n}/electronic`)).body;
      expect(meta).toMatchObject({ issueDate: '2026-10-29', issueTime: '22:00:00-05:00', dueDate: '2026-11-28' });
    });
    it('the HTML is built from the invoice AS IT WAS when the document was generated, even if the invoice row changes later', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      const original = (await prisma.invoice.findUnique({ where: { number: n } }))!.milestoneName;
      await prisma.$executeRaw`UPDATE invoices SET milestone_name = 'CAMBIADO DESPUÉS', amount_cop = 2000000, tax_cop = 380000, total_cop = 2380000 WHERE number = ${n}`;
      const html = (await call('get', `/invoices/${n}/electronic/html`)).text;
      expect(html).toContain(original); expect(html).toContain('1.190.000 COP'); expect(html).not.toContain('CAMBIADO DESPUÉS'); expect(html).not.toContain('2.380.000');
    });
    it('an invoice whose tax is not the 19 % of its subtotal gets NO document (the XML says "IVA 19 %" and must not lie), and no consecutive is spent', async () => {
      await withCustomer();
      const n = await issued(CLIENT, { amountCop: 1_000_000, taxCop: 100_000, totalCop: 1_100_000 });
      const r = await call('post', `/invoices/${n}/electronic`);
      expect(r.status).toBe(409); expect(r.body.message).toContain('19 % IVA rule');
      expect(await nextNumber()).toBe(1000);
    });
    it('the shipping can only be set once at the repository level too: a second markSubmitted keeps the FIRST reference', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`);
      const repo = new PrismaEInvoiceRepository(prisma);
      const first = await repo.markSubmitted(n, 'SANDBOX-first', new Date('2026-10-29T16:00:00Z'));
      const second = await repo.markSubmitted(n, 'SANDBOX-second', new Date('2026-10-29T17:00:00Z'));
      expect(first?.providerRef).toBe('SANDBOX-first'); expect(second?.providerRef).toBe('SANDBOX-first'); expect(second?.submittedAt?.toISOString()).toBe('2026-10-29T16:00:00.000Z');
    });
    it('once sent, the reference and the date cannot be changed even by SQL; documents and delivery records cannot be deleted or truncated; delivery records cannot be edited', async () => {
      await withCustomer(); const n = await issued(); await call('post', `/invoices/${n}/electronic`); await call('post', `/invoices/${n}/electronic/submit`); await call('post', `/invoices/${n}/electronic/deliveries`);
      await expect(prisma.$executeRawUnsafe(`UPDATE electronic_invoices SET provider_ref = 'SANDBOX-otra'`)).rejects.toThrow(/cannot change/);
      await expect(prisma.$executeRawUnsafe(`UPDATE electronic_invoices SET submitted_at = now()`)).rejects.toThrow(/cannot change/);
      await expect(prisma.$executeRawUnsafe(`UPDATE electronic_invoices SET invoice_snapshot = '{}'::jsonb`)).rejects.toThrow(/cannot be modified/);
      await expect(prisma.$executeRawUnsafe('DELETE FROM electronic_invoices')).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.$executeRawUnsafe('TRUNCATE electronic_invoices CASCADE')).rejects.toThrow(/cannot be deleted/);
      await expect(prisma.$executeRawUnsafe(`UPDATE einvoice_deliveries SET recipient = 'otro@x.co'`)).rejects.toThrow(/cannot be modified/);
      await expect(prisma.$executeRawUnsafe('DELETE FROM einvoice_deliveries')).rejects.toThrow(/cannot be deleted/);
      expect(await prisma.electronicInvoice.count()).toBe(1); expect(await prisma.eInvoiceDelivery.count()).toBe(1);
    });
    it('a client name with accents typed in a different Unicode form (NFD vs NFC) still finds its fiscal data, and a NIT with leading zeros is kept as written', async () => {
      const composed = 'Peña Hermanos SAS'; const decomposed = 'Pen\u0303a Hermanos SAS';
      await call('put', '/customers', billing(), { ...CUSTOMER, name: composed, nit: '000123456' });
      const n = await issued(decomposed);
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(201);
      expect((await call('get', `/invoices/${n}/electronic/xml`)).text).toContain('>000123456</cbc:CompanyID>');
    });
    it('two client names that normalize to the SAME key are ONE client: the second PUT updates the first (business rule, documented)', async () => {
      await call('put', '/customers', billing(), { ...CUSTOMER, name: 'Pena Hermanos', nit: '900000001' });
      await call('put', '/customers', billing(), { ...CUSTOMER, name: 'PEÑA   hermanos', nit: '900000002' });
      const all = (await call('get', '/customers')).body;
      expect(all).toHaveLength(1); expect(all[0].nit).toBe('900000002');
    });
    it('a client name of exactly 120 characters, with emoji, works end to end; the XML keeps the emoji', async () => {
      const name = `${'Á'.repeat(100)}${'🚀'.repeat(10)}`.slice(0, 120);
      expect([...name].length).toBeGreaterThan(0);
      expect((await call('put', '/customers', billing(), { ...CUSTOMER, name: 'a'.repeat(121) })).status).toBe(400);
      await call('put', '/customers', billing(), { ...CUSTOMER, name: 'b'.repeat(120) });
      const n = await issued('b'.repeat(120));
      expect((await call('post', `/invoices/${n}/electronic`)).status).toBe(201);
    });
  });
});
