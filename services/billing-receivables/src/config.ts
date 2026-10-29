import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateCustomer } from './domain/einvoice/customer';
import { EInvoiceSettings } from './application/einvoice.use-cases';

export interface Config {
  port: number;
  publicKey: string;
  issuer: string;
  audience: string;
  rabbitUrl: string;
  consumerEnabled: boolean;
  outboxPollMs: number;
  relayEnabled: boolean;
  /** Revisión periódica de facturas vencidas (apagada solo en las pruebas que la controlan a mano). */
  overdueEnabled: boolean;
  overdueCheckMs: number;
  einvoice: EInvoiceSettings;
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
    overdueEnabled: process.env.OVERDUE_ENABLED !== 'false',
    overdueCheckMs: Math.max(1000, Number(process.env.OVERDUE_CHECK_MS ?? 60_000) || 60_000),
    einvoice: loadEInvoiceSettings(),
  };
}

/**
 * Datos del emisor y reglas del documento electrónico. SOLO existe el ambiente `sandbox`: pedir `production` impide arrancar, porque no hay proveedor
 * tecnológico, certificado de firma ni habilitación de la DIAN conectados y este servicio no puede afirmar lo contrario. Los valores por defecto son
 * ficticios (NIT inventado).
 */
function loadEInvoiceSettings(): EInvoiceSettings {
  const environment = process.env.EINVOICE_ENVIRONMENT ?? 'sandbox';
  if (environment !== 'sandbox') throw new Error(`EINVOICE_ENVIRONMENT=${environment} is not supported: only "sandbox" exists (no DIAN provider, signing certificate or habilitation is connected)`);
  const s = validateCustomer({
    name: process.env.EINVOICE_SUPPLIER_NAME ?? 'Velocity Softworks (sandbox)',
    nit: process.env.EINVOICE_SUPPLIER_NIT ?? '900123456',
    email: process.env.EINVOICE_SUPPLIER_EMAIL ?? 'facturacion@velocity.example',
    address: process.env.EINVOICE_SUPPLIER_ADDRESS ?? 'Calle 1 No 2-3',
    city: process.env.EINVOICE_SUPPLIER_CITY ?? 'Medellín',
  });
  return {
    environment,
    supplier: { nit: s.nit, dv: s.dv, name: s.name, address: s.address, city: s.city, email: s.email },
    technicalKey: process.env.EINVOICE_TECHNICAL_KEY ?? 'sandbox-technical-key-not-official',
    verifyUrlBase: process.env.EINVOICE_VERIFY_URL_BASE ?? 'http://localhost:8080/sandbox/einvoice/verify?documentkey=',
  };
}
