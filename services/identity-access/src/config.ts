import { createPublicKey } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface Config {
  port: number;
  privateKey: string;
  /** Derivada de la privada: identity verifica con ella los tokens que ella misma firmó (rutas de administración de usuarios). */
  publicKey: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Falla al arrancar si falta algo: mejor que un servicio medio configurado. */
export function loadConfig(): Config {
  const ttl = Number(process.env.JWT_TTL_SECONDS ?? 900);
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 3600) throw new Error('JWT_TTL_SECONDS must be an integer between 1 and 3600');
  const privateKey = readFileSync(resolve(required('JWT_PRIVATE_KEY_PATH')), 'utf8');
  return {
    port: Number(process.env.PORT ?? 4101),
    privateKey,
    publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(),
    issuer: required('JWT_ISSUER'),
    audience: required('JWT_AUDIENCE'),
    ttlSeconds: ttl,
  };
}
