import { generateKeyPairSync, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { sign } from 'jsonwebtoken';

const PRIVATE_KEY = readFileSync('../../infra/keys/jwt-private.pem', 'utf8');
export const OTHER_KEYS = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

export const USERS = {
  lead: { id: randomUUID(), email: 'laura.rios@nexus.example', role: 'project_lead' },
  billing: { id: randomUUID(), email: 'andres.mora@nexus.example', role: 'billing_analyst' },
  sales: { id: randomUUID(), email: 'camila.soto@nexus.example', role: 'sales' },
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
/** Deja los 4 hitos pendientes del seed como estaban y borra el outbox (las pruebas no deben depender del orden). */
export async function resetState(prisma: PrismaClient) {
  await prisma.outboxEvent.deleteMany();
  await prisma.milestone.updateMany({ where: { id: { in: ['m2', 'm3', 'm5', 'm6'] } }, data: { status: 'pending', approvedAt: null, approvedBy: null } });
}
