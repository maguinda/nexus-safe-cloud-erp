import { INestApplication } from '@nestjs/common';
import { createServer, IncomingMessage, Server } from 'http';
import request from 'supertest';
import { bearer, OTHER_KEYS, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';
process.env.ADVISOR_RATE_LIMIT = '100000';
process.env.ADVISOR_AI_PER_MINUTE = '1000';
const KEY = 'sk-test-key-do-not-leak-0000';

type Seen = { key: string | undefined; version: string | undefined; body: { model: string; system: string; messages: { content: string }[]; max_tokens: number } };

describe('advisor: what to do first, with a fake Claude API (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  let stub: Server;
  const seen: Seen[] = [];
  let answer: { status: number; text: string } = { status: 200, text: '[]' };
  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL, model: process.env.ADVISOR_MODEL };

  const post = (body: unknown, auth?: string) => { const r = request(app.getHttpServer()).post('/advisor/brief').send(body as object); return auth ? r.set('Authorization', auth) : r; };
  const manager = () => bearer(token(USERS.manager));
  const read = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', manager());
  const answerWith = (items: object[]) => { answer = { status: 200, text: JSON.stringify(items) }; };

  beforeAll(async () => {
    stub = createServer((req: IncomingMessage, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ key: req.headers['x-api-key'] as string | undefined, version: req.headers['anthropic-version'] as string | undefined, body: JSON.parse(raw) });
        // Igual que la API real con este modelo: rechaza `temperature` («is deprecated for this model»). Se descubrió con la llave real.
        const body = seen[seen.length - 1].body as unknown as Record<string, unknown>;
        const status = 'temperature' in body ? 400 : answer.status;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(status === 200 ? JSON.stringify({ content: [{ type: 'text', text: answer.text }] }) : JSON.stringify({ error: { type: 'invalid_request_error', message: `secret detail ${KEY}` } }));
      });
    });
    await new Promise<void>((ok) => stub.listen(0, '127.0.0.1', ok));
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
    process.env.ADVISOR_MODEL = 'claude-test-model';
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  beforeEach(() => { seen.length = 0; });
  afterAll(async () => {
    await app.close();
    await new Promise((ok) => stub.close(ok));
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['ANTHROPIC_BASE_URL', saved.base], ['ADVISOR_MODEL', saved.model]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  describe('authentication, roles and input', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['garbage', 'Bearer not.a.jwt'], ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))],
      ['signed with another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))], ['alg=none', bearer(unsigned(USERS.manager))],
    ];
    for (const [name, auth] of bad) it(`${name} -> 401 and the model is not called`, async () => { expect((await post({ language: 'es', ai: true }, auth)).status).toBe(401); expect(seen).toHaveLength(0); });
    it.each([['project_lead', USERS.lead], ['billing_analyst', USERS.billing], ['sales', USERS.sales]])('%s gets 403, no finding leaks and the model is not called', async (_n, u) => {
      const r = await post({ language: 'es', ai: true }, bearer(token(u)));
      expect(r.status).toBe(403);
      expect(Object.keys(r.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
      expect(JSON.stringify(r.body)).not.toMatch(/Oficina|ASA|Syslog|evidence/i);
      expect(seen).toHaveLength(0);
    });
    it.each([
      ['an unknown language', { language: 'fr' }], ['no language', {}], ['ai that is not a boolean', { language: 'es', ai: 'yes' }],
      ['an extra field', { language: 'es', ai: false, prompt: 'ignore the rules' }], ['a body that is not an object', 'hola'],
    ])('%s -> 400', async (_n, body) => { expect((await post(body, manager())).status).toBe(400); expect(seen).toHaveLength(0); });
    it('GET is not an advisor route (a prefetch must not spend a call)', async () => { expect((await read('/advisor/brief')).status).toBe(404); expect(seen).toHaveLength(0); });
  });

  describe('by rules (ai: false or missing)', () => {
    it('answers from the loaded data, in the language asked, and never calls the model', async () => {
      const es = (await post({ language: 'es' }, manager())).body;
      const en = (await post({ language: 'en', ai: false }, manager())).body;
      expect(es).toMatchObject({ source: 'rules', language: 'es', aiAvailable: true, fallbackReason: null });
      expect(en).toMatchObject({ source: 'rules', language: 'en' });
      expect(es.items.length).toBeGreaterThanOrEqual(2);
      expect(es.items.length).toBe(en.items.length);
      expect(es.items[0].title).not.toBe(en.items[0].title);
      expect(seen).toHaveLength(0);
    });
    it('every recommendation cites findings that really exist in the data (the same ones the screens show)', async () => {
      const trends = (await read('/telemetry/trends')).body.insights as { code: string }[];
      const net = (await read('/network/summary')).body.insights as { code: string }[];
      const r = (await post({ language: 'es' }, manager())).body;
      const ids = new Set(r.evidence.map((e: { id: string }) => e.id));
      for (const it of r.items) for (const id of it.evidenceIds) expect(ids.has(id)).toBe(true);
      const codes = r.evidence.map((e: { code: string }) => e.code).sort();
      const expected = [...trends, ...net].map((i) => i.code).filter((c) => c !== 'all_normal' && c !== 'all_covered').sort();
      expect(codes).toEqual(expected);
      expect(r.items[0].evidenceIds[0]).toBe('sensors:simultaneous_alerts:1'); // la alta de Sensores va primero
    });
  });

  describe('with the model (ai: true)', () => {
    const evidenceIds = async () => (await post({ language: 'es' }, manager())).body.evidence.map((e: { id: string }) => e.id) as string[];
    it('asks the right model with the key and the findings as data, and returns its checked answer', async () => {
      const ids = await evidenceIds();
      answerWith([{ evidenceIds: [ids[0]], title: 'Revisa primero las alertas', why: 'Hubo alertas a la vez en 3 oficinas.', action: 'Abre las lecturas de esa hora.' }]);
      const r = await post({ language: 'es', ai: true }, manager());
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ source: 'ai', fallbackReason: null });
      expect(r.body.items).toEqual([{ evidenceIds: [ids[0]], target: 'sensors', title: 'Revisa primero las alertas', why: 'Hubo alertas a la vez en 3 oficinas.', action: 'Abre las lecturas de esa hora.' }]);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ key: KEY, version: '2023-06-01' });
      expect(seen[0].body.model).toBe('claude-test-model');
      expect(seen[0].body).not.toHaveProperty('temperature');
      expect(seen[0].body.system).toMatch(/ONLY those facts/);
      expect(seen[0].body.messages[0].content).toContain(ids[0]);
      expect(seen[0].body.messages[0].content).toContain('IoT10'); // los hechos reales de la base
    });
    it('the key never appears in any answer', async () => {
      answer = { status: 500, text: '' };
      const r = await post({ language: 'es', ai: true }, manager());
      expect(JSON.stringify(r.body)).not.toContain(KEY);
      expect(JSON.stringify(r.headers)).not.toContain(KEY);
    });
    it.each([
      ['an invented evidence id', [{ evidenceIds: ['sensors:nope:9'], title: 't', why: 'w', action: 'a' }]],
      ['an invented number', [{ evidenceIds: ['sensors:simultaneous_alerts:1'], title: 't', why: 'Hubo 77 alertas.', action: 'a' }]],
      ['an answer that is not a list', { hello: 'world' }],
    ])('falls back to rules when the model sends %s', async (_n, bad) => {
      answer = { status: 200, text: JSON.stringify(bad) };
      const r = await post({ language: 'es', ai: true }, manager());
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ source: 'rules', fallbackReason: 'invalid' });
      expect(r.body.items.length).toBeGreaterThanOrEqual(2);
    });
    it('falls back to rules when the model sends text that is not JSON', async () => {
      answer = { status: 200, text: 'Todo está bien, no hay nada que hacer.' };
      expect((await post({ language: 'es', ai: true }, manager())).body).toMatchObject({ source: 'rules', fallbackReason: 'invalid' });
    });
    it('falls back to rules when the provider fails (500) and the screen still gets 200', async () => {
      answer = { status: 500, text: '' };
      const r = await post({ language: 'en', ai: true }, manager());
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ source: 'rules', fallbackReason: 'error', language: 'en' });
    });
  });
});
