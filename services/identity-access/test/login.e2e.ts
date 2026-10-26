import { readFileSync } from 'fs';
import { INestApplication } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import request from 'supertest';

process.env.LOGIN_RATE_LIMIT = '1000'; // el límite de intentos se prueba en rate-limit.e2e.ts
const PUBLIC_KEY = readFileSync('../../infra/keys/jwt-public.pem', 'utf8');
const EMAIL = 'laura.rios@nexus.example';

describe('POST /auth/login (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const login = (body: unknown) => request(app.getHttpServer()).post('/auth/login').send(body as any);

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  afterAll(() => app.close());

  it('signs in with valid credentials and returns a token verifiable with the public key', async () => {
    const res = await login({ email: EMAIL, password: process.env.DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.user).toEqual({ email: EMAIL, name: 'Laura Ríos', role: 'project_lead', language: 'es' });
    const claims: any = verify(res.body.accessToken, PUBLIC_KEY, { algorithms: ['RS256'], issuer: 'identity-access', audience: 'erp-api' });
    expect(claims.role).toBe('project_lead');
    expect(claims.email).toBe(EMAIL);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|\$2[aby]\$/i);
  });

  it('accepts the email in any case and with spaces', async () => {
    const res = await login({ email: ' LAURA.RIOS@NEXUS.EXAMPLE ', password: process.env.DEMO_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('returns each demo role', async () => {
    for (const [email, role] of [['andres.mora@nexus.example', 'billing_analyst'], ['camila.soto@nexus.example', 'sales'], ['diana.vega@nexus.example', 'manager']]) {
      const res = await login({ email, password: process.env.DEMO_PASSWORD });
      expect(res.body.user.role).toBe(role);
    }
  });

  it('gives the same 401 body for a wrong password and for an unknown user', async () => {
    const wrong = await login({ email: EMAIL, password: 'wrong-password' });
    const ghost = await login({ email: 'ghost@nexus.example', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    const strip = ({ correlationId, ...rest }: any) => rest;
    expect(strip(wrong.body)).toEqual(strip(ghost.body));
  });

  describe('hostile input', () => {
    it.each([
      ['missing body', undefined],
      ['empty object', {}],
      ['missing password', { email: EMAIL }],
      ['not an email', { email: 'laura', password: 'x' }],
      ['extra field (mass assignment)', { email: EMAIL, password: 'x', role: 'project_lead' }],
      ['password too long (129)', { email: EMAIL, password: 'a'.repeat(129) }],
      ['email too long', { email: 'a'.repeat(250) + '@x.co', password: 'x' }],
      ['password as array', { email: EMAIL, password: ['x'] }],
      ['password as object', { email: EMAIL, password: { $ne: null } }],
      ['SQL in the email', { email: "' OR 1=1 --", password: 'x' }],
    ])('rejects %s with 400, never 500', async (_n, body) => {
      const res = await login(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual(expect.objectContaining({ statusCode: 400, error: expect.any(String), message: expect.any(String), correlationId: expect.any(String) }));
    });

    it('treats SQL in the password as a wrong password (401)', async () => {
      const res = await login({ email: EMAIL, password: "' OR '1'='1" });
      expect(res.status).toBe(401);
    });

    it('rejects a body over 10 kb with 413', async () => {
      const res = await login({ email: EMAIL, password: 'a'.repeat(20_000) });
      expect(res.status).toBe(413);
    });

    it('rejects malformed JSON with 400', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').set('Content-Type', 'application/json').send('{"email":');
      expect(res.status).toBe(400);
    });

    it('does not authenticate through another method or content type', async () => {
      expect((await request(app.getHttpServer()).get('/auth/login')).status).toBe(404);
      const form = await request(app.getHttpServer()).post('/auth/login').type('form').send({ email: EMAIL, password: process.env.DEMO_PASSWORD });
      expect(form.status).toBeGreaterThanOrEqual(400);
      expect(form.status).toBeLessThan(500);
    });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a safe correlation id and replaces an unsafe one', async () => {
    const ok = await login({ email: EMAIL, password: 'x' }).set('x-correlation-id', 'trace-12345678');
    expect(ok.headers['x-correlation-id']).toBe('trace-12345678');
    const bad = await login({ email: EMAIL, password: 'x' }).set('x-correlation-id', 'bad id <script>');
    expect(bad.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('handles 40 simultaneous logins, all correct, all with distinct tokens', async () => {
    const results = await Promise.all(Array.from({ length: 40 }, () => login({ email: EMAIL, password: process.env.DEMO_PASSWORD })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.accessToken)).size).toBe(40);
  });
});
