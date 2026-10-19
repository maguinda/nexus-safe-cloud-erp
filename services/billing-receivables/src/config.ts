import { readFileSync } from 'fs';
import { resolve } from 'path';

export interface Config {
  port: number;
  publicKey: string;
  issuer: string;
  audience: string;
  rabbitUrl: string;
  consumerEnabled: boolean;
  outboxPollMs: number;
  relayEnabled: boolean;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Falla al arrancar si falta algo: mejor que un servicio medio configurado. */
export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 4103),
    publicKey: readFileSync(resolve(required('JWT_PUBLIC_KEY_PATH')), 'utf8'),
    issuer: required('JWT_ISSUER'),
    audience: required('JWT_AUDIENCE'),
    rabbitUrl: required('RABBITMQ_URL'),
    consumerEnabled: process.env.CONSUMER_ENABLED !== 'false',
    outboxPollMs: Number(process.env.OUTBOX_POLL_MS ?? 500),
    relayEnabled: process.env.RELAY_ENABLED !== 'false',
  };
}
