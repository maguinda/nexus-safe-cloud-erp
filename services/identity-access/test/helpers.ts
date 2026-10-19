import { generateKeyPairSync, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { sign } from 'jsonwebtoken';

const PRIVATE_KEY = readFileSync('../../infra/keys/jwt-private.pem', 'utf8');
const PUBLIC_KEY = readFileSync('../../infra/keys/jwt-public.pem', 'utf8');
const OTHER = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

export const DEMO = { email: 'diana.vega@nexus.example' }; // la gerente de demostración
export const bearer = (t: string) => `Bearer ${t}`;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Firma como lo haría identity-access; las opciones permiten fabricar tokens defectuosos a propósito. */
export function token(c: { id?: string | null; email?: string; role?: string }, o: { key?: string; issuer?: string; audience?: string; expiresIn?: number | string; alg?: 'RS256' | 'HS256' } = {}) {
  const key = o.key ?? PRIVATE_KEY;
  return sign({ email: c.email ?? 'x@nexus.example', role: c.role ?? 'manager' }, key, {
    algorithm: o.alg ?? 'RS256', ...(c.id === null ? {} : { subject: c.id ?? randomUUID() }), issuer: o.issuer ?? 'identity-access', audience: o.audience ?? 'erp-api', expiresIn: (o.expiresIn ?? 900) as any,
  });
}

/** Doce maneras de presentar un token que NO debe abrir ninguna ruta de administración (todas deben dar 401). */
export function badTokens(valid: string): Record<string, string> {
  const [h, p, s] = valid.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return {
    'expired': token({}, { expiresIn: -60 }),
    'signed with another key': token({}, { key: OTHER.privateKey }),
    'wrong issuer': token({}, { issuer: 'evil' }),
    'wrong audience': token({}, { audience: 'other-api' }),
    'alg=none': `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, role: 'manager' })}.`,
    'payload tampered (role=manager) with the old signature': `${h}.${b64({ ...claims, role: 'manager' })}.${s}`,
    'HS256 signed with the public key (algorithm confusion)': token({}, { key: PUBLIC_KEY, alg: 'HS256' }),
    'unknown role': token({ role: 'admin' }),
    'subject is not a UUID': token({ id: "1' OR '1'='1" }),
    'no subject': token({ id: null }),
    'empty bearer': '',
    'garbage': 'not.a.token',
  };
}
