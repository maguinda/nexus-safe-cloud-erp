import { INestApplication } from '@nestjs/common';
import request from 'supertest';

process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '3';

// Detrás del gateway el límite por IP debe contar a cada persona por separado (el gateway escribe X-Forwarded-For con la IP real).
describe('rate limit per real client IP (behind the gateway)', () => {
  let app: INestApplication;
  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(() => app.close());

  const hit = (xff: string | null) => { const r = request(app.getHttpServer()).get('/projects'); return (xff === null ? r : r.set('X-Forwarded-For', xff)).then((x) => x.status); };

  it('each real IP has its own bucket: one exhausting its 3 requests does not block another', async () => {
    const a = '203.0.113.10';
    expect(await Promise.all([hit(a), hit(a), hit(a)])).not.toContain(429);
    expect(await hit(a)).toBe(429); // la 4.ª de la misma IP sí se rechaza
    expect(await hit('203.0.113.11')).not.toBe(429); // otra persona, otra bolsa
  });

  it('a client cannot dodge its bucket by adding fake entries to the left of X-Forwarded-For', async () => {
    const a = '203.0.113.20';
    await Promise.all([hit(a), hit(a), hit(a)]);
    expect(await hit(a)).toBe(429);
    for (const fake of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) expect(await hit(`${fake}, ${a}`)).toBe(429); // manda la entrada del gateway (la de más a la derecha)
  });

  it('without the header it falls back to the connection address, with its own bucket', async () => {
    expect(await Promise.all([hit(null), hit(null), hit(null)])).not.toContain(429);
    expect(await hit(null)).toBe(429);
  });
});
