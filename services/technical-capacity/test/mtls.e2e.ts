import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { request } from 'https';
import { request as httpRequest } from 'http';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { INestApplication } from '@nestjs/common';
import { enforceAllowedClients, httpsOptions, loadTlsConfig } from '../src/tls';

process.env.CONSUMER_ENABLED = 'false';
process.env.RELAY_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
// mTLS de verdad: se levanta la app con TLS y se intenta entrar con distintos "carnés".
const gen = (dir: string) => execFileSync('sh', [resolve('../../infra/certs/gen-certs.sh')], { env: { ...process.env, CERT_DIR: dir }, stdio: 'ignore' });

describe('mTLS between the gateway and technical-capacity (e2e, real TLS handshake)', () => {
  const ours = mkdtempSync(join(tmpdir(), 'mtls-ours-'));
  const other = mkdtempSync(join(tmpdir(), 'mtls-other-')); // otra CA con los mismos nombres: no debe valer
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    gen(ours); gen(other);
    const tls = loadTlsConfig({ TLS_ENABLED: 'true', TLS_KEY_PATH: join(ours, 'capacity-key.pem'), TLS_CERT_PATH: join(ours, 'capacity.pem'), TLS_CA_PATH: join(ours, 'ca.pem'), TLS_ALLOWED_CLIENTS: 'gateway,capacity' })!;
    const { createApp } = require('../src/app.factory');
    app = await createApp(httpsOptions(tls));
    enforceAllowedClients(app.getHttpServer(), tls.allowedClients);
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as any).port;
  });
  afterAll(async () => { await app.close(); rmSync(ours, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); });

  const call = (path: string, who?: { dir: string; name: string }, method = 'GET', body?: string) =>
    new Promise<{ status: number; body: string }>((ok, fail) => {
      const req = request({
        host: '127.0.0.1', port, path, method, ca: readFileSync(join(ours, 'ca.pem')), timeout: 5000,
        ...(who ? { cert: readFileSync(join(who.dir, `${who.name}.pem`)), key: readFileSync(join(who.dir, `${who.name}-key.pem`)) } : {}),
        headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
      }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode!, body: b })); });
      req.on('error', fail); req.on('timeout', () => req.destroy(new Error('timeout')));
      if (body) req.write(body);
      req.end();
    });

  it('lets the gateway in (certificate from our CA, allowed name)', async () => {
    const r = await call('/health', { dir: ours, name: 'gateway' });
    expect(r.status).toBe(200);
  });

  it('lets the service call itself (what its own healthcheck does)', async () => {
    expect((await call('/health', { dir: ours, name: 'capacity' })).status).toBe(200);
  });

  it('refuses a client with NO certificate', async () => {
    await expect(call('/health')).rejects.toBeTruthy();
  });

  it('refuses a certificate issued by a DIFFERENT CA, even with the right name', async () => {
    await expect(call('/health', { dir: other, name: 'gateway' })).rejects.toBeTruthy();
  });

  it('refuses a valid certificate whose name is not allowed (billing cannot call technical-capacity)', async () => {
    await expect(call('/health', { dir: ours, name: 'billing' })).rejects.toBeTruthy();
  });

  it('does not answer plain HTTP on the TLS port', async () => {
    await expect(new Promise((ok, fail) => {
      const r = httpRequest({ host: '127.0.0.1', port, path: '/health', timeout: 3000 }, (res) => ok(res.statusCode));
      r.on('error', fail); r.on('timeout', () => r.destroy(new Error('timeout'))); r.end();
    })).rejects.toBeTruthy();
  });

  it('keeps the JWT layer: a good certificate does not replace the JWT (no token -> 401)', async () => {
    const r = await call('/engineers', { dir: ours, name: 'gateway' });
    expect(r.status).toBe(401);
  });
});
