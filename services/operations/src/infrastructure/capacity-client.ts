import { readFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { resolve } from 'path';

/** Capacidad respondió que no (409 por pasarse de 100 %, 404 persona inexistente, 400 datos…): el mensaje es el suyo. */
export class CapacityRejectedError extends Error { constructor(public readonly status: number, message: string) { super(message); } }
/** Capacidad no contestó (caído, lento, mal certificado): no se sabe si guardó o no. */
export class CapacityUnavailableError extends Error { constructor(detail: string) { super(`Technical capacity is not available (${detail}); try again`); } }

export interface ReserveInput { engineerId: string; label: string; percent: number; startDate: string; endDate: string; allowOverallocation: boolean }
/** Lo que Operations necesita de Capacidad. El token de la persona se reenvía: Capacidad vuelve a comprobar que es gerencia. */
export interface CapacityClient {
  reserve(orderId: string, input: ReserveInput, bearer: string, correlationId: string): Promise<{ peak: number; overAllocated: boolean }>;
  release(orderId: string, bearer: string, correlationId: string): Promise<void>;
}

/** Servicio a servicio: HTTPS con mTLS (el certificado de Operations; su nombre tiene que estar en TLS_ALLOWED_CLIENTS de Capacidad) o HTTP plano en pruebas. */
export class HttpCapacityClient implements CapacityClient {
  private readonly agent: http.Agent;
  constructor(private readonly baseUrl: string, tls?: { key: string; cert: string; ca: string }, private readonly timeoutMs = 8000) {
    this.agent = baseUrl.startsWith('https:') ? new https.Agent({ key: readFileSync(resolve(tls!.key)), cert: readFileSync(resolve(tls!.cert)), ca: readFileSync(resolve(tls!.ca)), keepAlive: true, minVersion: 'TLSv1.2' }) : new http.Agent({ keepAlive: true });
  }

  private call(method: 'PUT' | 'DELETE', path: string, bearer: string, correlationId: string, body?: object): Promise<{ status: number; json: any }> {
    return new Promise((resolveP, reject) => {
      const url = new URL(path, this.baseUrl);
      const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(url, { method, agent: this.agent, timeout: this.timeoutMs, headers: { authorization: bearer, 'x-correlation-id': correlationId, ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}) } }, (res) => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size > 64 * 1024) { req.destroy(new Error('response too large')); return; } chunks.push(c); });
        res.on('end', () => { let json: any = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* sin cuerpo */ } resolveP({ status: res.statusCode ?? 0, json }); });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => reject(new CapacityUnavailableError(e.message)));
      if (data) req.write(data);
      req.end();
    });
  }

  async reserve(orderId: string, input: ReserveInput, bearer: string, correlationId: string) {
    const r = await this.call('PUT', `/maintenance/${orderId}`, bearer, correlationId, input);
    if (r.status === 200) return { peak: Number(r.json?.peak ?? 0), overAllocated: r.json?.overAllocated === true };
    if (r.status >= 400 && r.status < 500) throw new CapacityRejectedError(r.status, String(r.json?.message ?? 'Technical capacity refused the request'));
    throw new CapacityUnavailableError(`HTTP ${r.status}`);
  }

  async release(orderId: string, bearer: string, correlationId: string) {
    const r = await this.call('DELETE', `/maintenance/${orderId}`, bearer, correlationId);
    if (r.status === 204 || r.status === 200) return;
    if (r.status >= 400 && r.status < 500) throw new CapacityRejectedError(r.status, String(r.json?.message ?? 'Technical capacity refused the request'));
    throw new CapacityUnavailableError(`HTTP ${r.status}`);
  }
}

/** Arma el cliente desde el entorno: CAPACITY_URL (por defecto https://capacity:4106) y, con https, el certificado propio (TLS_CERT_PATH, TLS_KEY_PATH, TLS_CA_PATH). */
export function capacityClientFromEnv(env: NodeJS.ProcessEnv = process.env): CapacityClient {
  // Con mTLS activado (producción y la pila de Docker) Capacidad está en https; sin él (pruebas locales) en http plano.
  const url = env.CAPACITY_URL ?? (env.TLS_ENABLED === 'true' ? 'https://capacity:4106' : 'http://localhost:4106');
  if (url.startsWith('https:')) {
    for (const n of ['TLS_CERT_PATH', 'TLS_KEY_PATH', 'TLS_CA_PATH']) if (!env[n]) throw new Error(`CAPACITY_URL is https and needs ${n}`);
    return new HttpCapacityClient(url, { key: env.TLS_KEY_PATH!, cert: env.TLS_CERT_PATH!, ca: env.TLS_CA_PATH! });
  }
  return new HttpCapacityClient(url);
}
