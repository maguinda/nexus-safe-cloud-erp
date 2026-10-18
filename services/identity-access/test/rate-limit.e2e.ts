import { INestApplication } from '@nestjs/common';
import request from 'supertest';

process.env.LOGIN_RATE_LIMIT = '3';

describe('login rate limit (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  afterAll(() => app.close());

  it('answers 429 after 3 attempts in a minute, even for a valid password', async () => {
    const attempt = (password: string) => request(app.getHttpServer()).post('/auth/login').send({ email: 'laura.rios@nexus.example', password });
    const first = [await attempt('bad-1'), await attempt('bad-2'), await attempt('bad-3')];
    expect(first.map((r) => r.status)).toEqual([401, 401, 401]);
    const blocked = await attempt(process.env.DEMO_PASSWORD as string);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual(expect.objectContaining({ statusCode: 429, correlationId: expect.any(String) }));
  });

  it('does not rate-limit /health', async () => {
    for (let i = 0; i < 10; i++) expect((await request(app.getHttpServer()).get('/health')).status).toBe(200);
  });
});
