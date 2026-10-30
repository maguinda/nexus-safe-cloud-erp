import { generateKeyPairSync, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { sign } from 'jsonwebtoken';

const PRIVATE_KEY = readFileSync('../../infra/keys/jwt-private.pem', 'utf8');
export const OTHER_KEYS = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

export const USERS = {
  lead: { id: randomUUID(), email: 'laura.rios@nexus.example', role: 'project_lead' },
  billing: { id: randomUUID(), email: 'andres.mora@nexus.example', role: 'billing_analyst' },
  sales: { id: randomUUID(), email: 'camila.soto@nexus.example', role: 'sales' },
  manager: { id: randomUUID(), email: 'diana.vega@nexus.example', role: 'manager' },
};

/** Firma como lo haría identity-access; las opciones permiten fabricar tokens defectuosos a propósito. */
export function token(u: { id: string; email: string; role: string }, o: { key?: string; issuer?: string; audience?: string; expiresIn?: number | string; extra?: object } = {}) {
  return sign({ email: u.email, role: u.role, ...(o.extra ?? {}) }, o.key ?? PRIVATE_KEY, {
    algorithm: 'RS256', subject: u.id, issuer: o.issuer ?? 'identity-access', audience: o.audience ?? 'erp-api', expiresIn: (o.expiresIn ?? 900) as any,
  });
}
export const bearer = (t: string) => `Bearer ${t}`;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const unsigned = (u: { id: string; email: string; role: string }) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: u.role, iss: 'identity-access', aud: 'erp-api', exp: Math.floor(Date.now() / 1000) + 900 })}.`;

import { PrismaClient } from '@prisma/client';
/** Deja solo las 2 facturas del seed, borra la bandeja de eventos y reinicia la secuencia en 103. */
/** Los documentos electrónicos NO se pueden borrar (la base lo impide); las pruebas lo declaran dentro de su transacción, igual que el reinicio de la demo. */
export async function wipeEInvoices(prisma: PrismaClient) {
  await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('erp.allow_einvoice_delete', 'on', true)`,
    prisma.eInvoiceDelivery.deleteMany(),
    prisma.electronicInvoice.deleteMany(),
  ]);
}

/** Los pagos son de solo agregar: el trigger de la base los protege y esta es la única forma de limpiarlos (la declara a propósito, solo en esta transacción). */
export async function wipePayments(prisma: PrismaClient) {
  await prisma.$transaction(async (tx) => { await tx.$executeRaw`SELECT set_config('erp.allow_payment_delete', 'on', true)`; await tx.$executeRaw`DELETE FROM payments`; });
}

export async function resetState(prisma: PrismaClient) {
  await wipePayments(prisma);
  await wipeEInvoices(prisma);
  await prisma.customer.deleteMany();
  await prisma.$executeRaw`UPDATE einvoice_numbering SET next_number = range_from, range_to = 1999, valid_from = '2026-01-01T05:00:00Z', valid_to = '2028-01-01T04:59:59Z' WHERE id = 1`;
  await prisma.invoice.deleteMany({ where: { number: { notIn: ['INV-0101', 'INV-0102'] } } });
  await prisma.processedEvent.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.$executeRaw`SELECT setval('invoice_number_seq', 103, false)`;
}
