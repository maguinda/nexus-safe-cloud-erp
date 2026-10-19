import { INestApplication } from '@nestjs/common';
import request from 'supertest';

process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('Swagger page (demo docs)', () => {
  let app: INestApplication;
  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(() => app.close());

  it('serves /docs without upgrade-insecure-requests, so Safari can load its scripts over the plain-HTTP docs port', async () => {
    // Con esa directiva, Safari pide los scripts por HTTPS aunque sea localhost y la página queda en blanco (error de TLS).
    const res = await request(app.getHttpServer()).get('/docs');
    expect(res.status).toBe(200);
    const csp: string = res.headers['content-security-policy'];
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('keeps the rest of the content security policy (same-origin scripts only, no plugins, no sniffing)', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    const csp: string = res.headers['content-security-policy'];
    for (const directive of ["default-src 'self'", "script-src 'self'", "script-src-attr 'none'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'"]) expect(csp).toContain(directive);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
