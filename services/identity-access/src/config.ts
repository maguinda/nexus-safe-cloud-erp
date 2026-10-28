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
  /** Minutos que dura un token de renovación sin usarse (cada renovación lo corre hacia adelante). */
  refreshIdleMinutes: number;
  /** Tope absoluto de una sesión, en horas, aunque se use todo el tiempo. */
  sessionMaxHours: number;
  /** Con HTTPS, la cookie de renovación lleva Secure. En la demo local (http://localhost) va apagado. */
  cookieSecure: boolean;
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
  const idle = Number(process.env.REFRESH_IDLE_MINUTES ?? 30);
  if (!Number.isInteger(idle) || idle < 1 || idle > 1440) throw new Error('REFRESH_IDLE_MINUTES must be an integer between 1 and 1440');
  const maxHours = Number(process.env.SESSION_MAX_HOURS ?? 8);
  if (!Number.isInteger(maxHours) || maxHours < 1 || maxHours > 72) throw new Error('SESSION_MAX_HOURS must be an integer between 1 and 72');
  const privateKey = readFileSync(resolve(required('JWT_PRIVATE_KEY_PATH')), 'utf8');
  return {
    port: Number(process.env.PORT ?? 4101),
    privateKey,
    publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString(),
    issuer: required('JWT_ISSUER'),
    audience: required('JWT_AUDIENCE'),
    ttlSeconds: ttl,
    refreshIdleMinutes: idle,
    sessionMaxHours: maxHours,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
  };
}
