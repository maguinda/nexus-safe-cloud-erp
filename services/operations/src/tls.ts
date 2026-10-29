import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { TLSSocket } from 'tls';

export interface TlsConfig {
  key: Buffer;
  cert: Buffer;
  ca: Buffer;
  /** Nombres (CN del certificado) que pueden llamar a este servicio. */
  allowedClients: string[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`TLS_ENABLED=true needs ${name}`);
  return v;
}

/** TLS_ENABLED=true activa mTLS y exige todo lo necesario: falla al arrancar antes que dejar el servicio a medias. */
export function loadTlsConfig(env: NodeJS.ProcessEnv = process.env): TlsConfig | null {
  if (env.TLS_ENABLED !== 'true') return null;
  const allowedClients = required(env, 'TLS_ALLOWED_CLIENTS').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowedClients.length === 0) throw new Error('TLS_ALLOWED_CLIENTS must list at least one name');
  return {
    key: readFileSync(resolve(required(env, 'TLS_KEY_PATH'))),
    cert: readFileSync(resolve(required(env, 'TLS_CERT_PATH'))),
    ca: readFileSync(resolve(required(env, 'TLS_CA_PATH'))),
    allowedClients,
  };
}

/** requestCert + rejectUnauthorized: sin un certificado firmado por nuestra CA ni siquiera se abre la conexión. */
export function httpsOptions(c: TlsConfig) {
  return { key: c.key, cert: c.cert, ca: c.ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' as const };
}

/** Segunda defensa: un certificado de nuestra CA no basta, el nombre (CN) tiene que estar en la lista de permitidos. */
export function isAllowedClient(socket: Pick<TLSSocket, 'getPeerCertificate'>, allowed: string[]): boolean {
  const cn = socket.getPeerCertificate()?.subject?.CN;
  return typeof cn === 'string' && allowed.includes(cn);
}

export function enforceAllowedClients(server: { on(event: 'secureConnection', cb: (s: TLSSocket) => void): unknown }, allowed: string[]): void {
  server.on('secureConnection', (socket) => { if (!isAllowedClient(socket, allowed)) socket.destroy(); });
}
