import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_RETENTION_DAYS } from './domain/retention';

export interface Config {
  port: number;
  publicKey: string;
  issuer: string;
  audience: string;
  rabbitUrl: string;
  outboxPollMs: number;
  relayEnabled: boolean;
  consumerEnabled: boolean;
  retentionDays: number;
  retentionCheckMs: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Falla al arrancar si falta algo: mejor que un servicio medio configurado. */
export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 4107),
    publicKey: readFileSync(resolve(required('JWT_PUBLIC_KEY_PATH')), 'utf8'),
    issuer: required('JWT_ISSUER'),
    audience: required('JWT_AUDIENCE'),
    rabbitUrl: required('RABBITMQ_URL'),
    outboxPollMs: Number(process.env.OUTBOX_POLL_MS ?? 500),
    relayEnabled: process.env.RELAY_ENABLED !== 'false',
    consumerEnabled: process.env.CONSUMER_ENABLED !== 'false',
    // Lecturas de sensores: se guardan 365 días por defecto; RETENTION_DAYS=0 las guarda para siempre. Un plazo inválido (menos de 30 días) detiene el arranque.
    retentionDays: process.env.RETENTION_DAYS === undefined || process.env.RETENTION_DAYS === '' ? DEFAULT_RETENTION_DAYS : Number(process.env.RETENTION_DAYS),
    retentionCheckMs: Math.max(1000, Number(process.env.RETENTION_CHECK_MS ?? 3_600_000) || 3_600_000),
  };
}
