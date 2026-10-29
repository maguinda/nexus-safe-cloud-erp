import { INestApplication } from '@nestjs/common';
import { createServer, Server } from 'http';
import request from 'supertest';
import { bearer, token, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';
process.env.ADVISOR_RATE_LIMIT = '100000';
process.env.ADVISOR_AI_PER_MINUTE = '2';

describe('advisor: the paid calls are capped, the free ones are not (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let stub: Server;
  let calls = 0;
  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  const post = (body: object) => request(app.getHttpServer()).post('/advisor/brief').set('Authorization', bearer(token(USERS.manager))).send(body);

  beforeAll(async () => {
    stub = createServer((req, res) => { req.resume(); req.on('end', () => { calls++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ content: [{ type: 'text', text: 'not json' }] })); }); });
    await new Promise<void>((ok) => stub.listen(0, '127.0.0.1', ok));
    process.env.ANTHROPIC_API_KEY = 'sk-test-cap';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    await new Promise((ok) => stub.close(ok));
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['ANTHROPIC_BASE_URL', saved.base]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('with a limit of 2 a minute, the third AI request is answered with rules («limit») and the model is not called', async () => {
    const out: (string | null)[] = [];
    for (let i = 0; i < 4; i++) out.push((await post({ language: 'es', ai: true })).body.fallbackReason);
    expect(out).toEqual(['invalid', 'invalid', 'limit', 'limit']); // las dos primeras llegaron al modelo (su respuesta no servía); las demás ni lo intentaron
    expect(calls).toBe(2);
  });
  it('the rules never spend the budget: ten requests without AI in a row all answer and the model is not called', async () => {
    const before = calls;
    for (let i = 0; i < 10; i++) { const r = await post({ language: 'es', ai: false }); expect(r.status).toBe(200); expect(r.body.fallbackReason).toBeNull(); }
    expect(calls).toBe(before);
  });
});
