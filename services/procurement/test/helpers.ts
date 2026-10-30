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
export const SEED_SUPPLIERS = ['22222222-2222-4222-8222-222222222201', '22222222-2222-4222-8222-222222222202'];
export const SEED_ITEMS = ['33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333302', '33333333-3333-4333-8333-333333333303'];
export const SEED_STOCK: Record<string, number> = { [SEED_ITEMS[0]]: 8, [SEED_ITEMS[1]]: 3, [SEED_ITEMS[2]]: 2 };
/** Deja la base como el seed: borra pedidos, avisos y outbox, lo creado por las pruebas y devuelve las existencias de los artículos del seed. */
export async function resetState(prisma: PrismaClient) {
  await prisma.outboxEvent.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.alertSuggestion.deleteMany();
  await prisma.processedEvent.deleteMany();
  await prisma.supplier.deleteMany({ where: { id: { notIn: SEED_SUPPLIERS } } });
  await prisma.item.deleteMany({ where: { id: { notIn: SEED_ITEMS } } });
  for (const [id, onHand] of Object.entries(SEED_STOCK)) await prisma.item.update({ where: { id }, data: { onHand } });
}
