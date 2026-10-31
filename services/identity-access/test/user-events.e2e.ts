import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { Channel, ConsumeMessage, connect } from 'amqplib';
import request from 'supertest';
import { BcryptPasswordHasher } from '../src/infrastructure/bcrypt-password-hasher';

process.env.RELAY_ENABLED = 'true';
process.env.OUTBOX_POLL_MS = '100';
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.RATE_LIMIT = '100000';
process.env.USERS_WRITE_RATE_LIMIT = '100000';
const PASSWORD = 'Correct-Horse-Battery-9';
const TAG = `Evt${randomBytes(3).toString('hex')}`; // nombre de las personas de esta prueba: así se limpian sin tocar nada más

describe('UserCreated and RoleChanged through the outbox to RabbitMQ (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let received: ConsumeMessage[] = [];
  const emails: string[] = [];
  const server = () => app.getHttpServer();
  const waitFor = async (n: number, ms = 8000) => { const end = Date.now() + ms; while (received.length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 50)); };
  const mine = () => received.filter((m) => JSON.parse(m.content.toString()).data?.userName?.startsWith(TAG));
  const outboxOf = (userName: string) => prisma.$queryRaw<{ type: string }[]>`SELECT type FROM outbox_events WHERE payload->'data'->>'userName' = ${userName}`;
  let token = ''; let managerEmail = '';

  beforeAll(async () => {
    conn = await connect(process.env.RABBITMQ_URL as string);
    ch = await conn.createChannel();
    await ch.assertExchange('erp.events', 'topic', { durable: true });
    const q = await ch.assertQueue('', { exclusive: true });
    await ch.bindQueue(q.queue, 'erp.events', 'identity.#');
    await ch.consume(q.queue, (m) => { if (m) { received.push(m); ch.ack(m); } });
    // Las demás pruebas de Identity crean cientos de personas con el relé apagado: sus eventos esperan en la tabla y harían cola delante de los de esta prueba.
    await prisma.outboxEvent.deleteMany();
    const { createApp } = require('../src/app.factory');
    app = await createApp(); await app.init();
    managerEmail = `evt.mgr.${randomBytes(4).toString('hex')}@nexus.example`; emails.push(managerEmail);
    await prisma.user.create({ data: { email: managerEmail, name: `${TAG} Manager`, role: 'manager', passwordHash: await new BcryptPasswordHasher().hash(PASSWORD) } });
    token = (await request(server()).post('/auth/login').send({ email: managerEmail, password: PASSWORD })).body.accessToken;
  });
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM outbox_events WHERE payload->'data'->>'userName' LIKE ${TAG + '%'}`;
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close(); await ch.close(); await conn.close(); await prisma.$disconnect();
  });
  beforeEach(() => { received = []; });
  const create = (name: string, email: string, role = 'sales', extra: Record<string, unknown> = {}) =>
    request(server()).post('/users').set('Authorization', `Bearer ${token}`).set('x-correlation-id', 'trace-evt-0001').send({ email, name, role, password: PASSWORD, ...extra });

  it('POST /users publishes UserCreated to identity.user.created with the person, the role, who did it and the trace, and then marks it published', async () => {
    const email = `evt.${randomBytes(4).toString('hex')}@nexus.example`; emails.push(email);
    const r = await create(`${TAG} Uno`, email);
    expect(r.status).toBe(201);
    await waitFor(1);
    const m = mine()[0];
    expect(m.fields.routingKey).toBe('identity.user.created');
    expect(m.properties).toMatchObject({ deliveryMode: 2, contentType: 'application/json', type: 'UserCreated' });
    const body = JSON.parse(m.content.toString());
    expect(body).toMatchObject({ type: 'UserCreated', correlationId: 'trace-evt-0001', data: { userId: r.body.id, userName: `${TAG} Uno`, role: 'sales', staffId: null, createdBy: managerEmail } });
    expect(body.eventId).toBe(m.properties.messageId);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(`${email}|${PASSWORD}|hash`, 'i'));
    for (let i = 0; i < 40 && (await prisma.outboxEvent.count({ where: { publishedAt: null } })) > 0; i++) await new Promise((r2) => setTimeout(r2, 100));
    expect(await prisma.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it('PATCH /users/:id/role publishes RoleChanged with the previous and the new role; the same role again publishes nothing', async () => {
    const email = `evt.${randomBytes(4).toString('hex')}@nexus.example`; emails.push(email);
    const u = (await create(`${TAG} Dos`, email)).body;
    await waitFor(1); received = [];
    const patch = (role: string) => request(server()).patch(`/users/${u.id}/role`).set('Authorization', `Bearer ${token}`).send({ role });
    expect((await patch('finance')).status).toBe(200);
    await waitFor(1);
    expect(JSON.parse(mine()[0].content.toString())).toMatchObject({ type: 'RoleChanged', data: { userId: u.id, userName: `${TAG} Dos`, previousRole: 'sales', role: 'finance', changedBy: managerEmail } });
    expect(mine()[0].fields.routingKey).toBe('identity.user.role-changed');
    received = [];
    expect((await patch('finance')).status).toBe(200); // mismo rol: nada cambia
    await new Promise((r) => setTimeout(r, 700));
    expect(mine()).toHaveLength(0);
  });

  it('five changes of the same person publish five different events, in order (the unique index must not swallow the later ones)', async () => {
    const email = `evt.${randomBytes(4).toString('hex')}@nexus.example`; emails.push(email);
    const u = (await create(`${TAG} Tres`, email)).body; await waitFor(1); received = [];
    const seq = ['finance', 'sales', 'billing_analyst', 'sales', 'project_lead'];
    for (const role of seq) expect((await request(server()).patch(`/users/${u.id}/role`).set('Authorization', `Bearer ${token}`).send({ role })).status).toBe(200);
    await waitFor(5);
    const got = mine().map((m) => JSON.parse(m.content.toString()));
    expect(got.map((g) => g.data.role)).toEqual(seq);
    expect(new Set(got.map((g) => g.eventId)).size).toBe(5);
  });

  it('refused requests leave nothing in the outbox: taken email (409), weak password (400), not a manager (403), engineer without staff (400)', async () => {
    const email = `evt.${randomBytes(4).toString('hex')}@nexus.example`; emails.push(email);
    await create(`${TAG} Cuatro`, email); await waitFor(1);
    const before = (await outboxOf(`${TAG} Cuatro`)).length;
    const otherName = `${TAG} Rechazado`;
    expect((await create(otherName, email)).status).toBe(409);
    expect((await request(server()).post('/users').set('Authorization', `Bearer ${token}`).send({ email: 'x@nexus.example', name: otherName, role: 'sales', password: 'short' })).status).toBe(400);
    expect((await create(otherName, 'y@nexus.example', 'engineer')).status).toBe(400);
    const sales = `evt.s.${randomBytes(4).toString('hex')}@nexus.example`; emails.push(sales);
    await prisma.user.create({ data: { email: sales, name: `${TAG} Ventas`, role: 'sales', passwordHash: await new BcryptPasswordHasher().hash(PASSWORD) } });
    const st = (await request(server()).post('/auth/login').send({ email: sales, password: PASSWORD })).body.accessToken;
    expect((await request(server()).post('/users').set('Authorization', `Bearer ${st}`).send({ email: 'z@nexus.example', name: otherName, role: 'sales', password: PASSWORD })).status).toBe(403);
    expect(await outboxOf(otherName)).toHaveLength(0);
    expect(await outboxOf(`${TAG} Cuatro`)).toHaveLength(before);
  });

  it('8 creations of the SAME email at the same time: exactly one 201, one user and exactly one UserCreated (30 rounds)', async () => {
    for (let round = 0; round < 30; round++) {
      const email = `evt.race.${round}.${randomBytes(3).toString('hex')}@nexus.example`; emails.push(email);
      const name = `${TAG} Race${round}`;
      const rs = await Promise.all([...Array(8)].map(() => create(name, email)));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(await outboxOf(name)).toEqual([{ type: 'UserCreated' }]); // la invariante: todo alta aceptada tiene su evento y ninguno de más
    }
  });
});
