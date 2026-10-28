import { INestApplication } from '@nestjs/common';
import request from 'supertest';

process.env.REFRESH_RATE_LIMIT = '3';
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.RATE_LIMIT = '100000';

describe('POST /auth/refresh rate limit (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(() => app.close());

  it('answers 429 after 3 renewals in a minute, even before looking at the cookie, and /auth/login keeps its own limit', async () => {
    const attempt = () => request(app.getHttpServer()).post('/auth/refresh').set('X-Requested-With', 'erp-web').set('Cookie', `erp_refresh=${'A'.repeat(43)}`).send();
    expect((await Promise.all([attempt(), attempt(), attempt()])).map((r) => r.status)).toEqual([401, 401, 401]);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(expect.objectContaining({ statusCode: 429, correlationId: expect.any(String) }));
    expect((await request(app.getHttpServer()).post('/auth/login').send({ email: 'nobody@nexus.example', password: 'x' })).status).toBe(401);
  });
});
