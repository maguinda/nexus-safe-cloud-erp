import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Channel, connect } from 'amqplib';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { teamEventHandler } from '../src/infrastructure/prisma-team-store';
import { TeamConsumer } from '../src/infrastructure/team-consumer';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RATE_LIMIT = '100000';

describe('project team from EngineerAllocated (e2e, real PostgreSQL and RabbitMQ)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let conn: Awaited<ReturnType<typeof connect>>;
  let ch: Channel;
  let consumer: TeamConsumer;
  const get = (p: string, who?: any) => { let r = request(app.getHttpServer()).get(p); if (who) r = r.set('Authorization', bearer(token(who))); return r; };
  const ev = (data: object = {}) => ({ eventId: randomUUID(), type: 'EngineerAllocated', occurredAt: new Date().toISOString(), correlationId: 'corr-12345678',
    data: { allocationId: randomUUID(), engineerName: 'Camila Torres (example)', projectName: 'Branch network upgrade', percent: 50, periodStart: '2026-11-01', periodEnd: '2026-12-15', ...data } });
  const publish = (e: object, key = 'capacity.engineer.allocated') => ch.publish('erp.events', key, Buffer.from(JSON.stringify(e)), { persistent: true });
  const until = async (f: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await f()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const dlq = async () => (await ch.checkQueue('q.projects.team.dlq')).messageCount;
  const count = () => prisma.projectTeamMember.count();

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init();
    conn = await connect(process.env.RABBITMQ_URL as string); ch = await conn.createChannel();
    await ch.assertExchange('erp.events', 'topic', { durable: true });
    consumer = new TeamConsumer(teamEventHandler(prisma), process.env.RABBITMQ_URL as string); consumer.start();
    await new Promise((r) => setTimeout(r, 1500));
    await ch.purgeQueue('q.projects.team.dlq');
  });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await consumer.stop(); await ch.close(); await conn.close(); await app.close(); await prisma.$disconnect(); });

  it('401 without token, 403 for sales, 404 for an unknown project, 400 for a bad id', async () => {
    expect((await get('/projects/p1/team')).status).toBe(401);
    expect((await get('/projects/p1/team', USERS.sales)).status).toBe(403);
    expect((await get('/projects/p-nope/team', USERS.lead)).status).toBe(404);
    expect((await get('/projects/bad id/team', USERS.lead)).status).toBeGreaterThanOrEqual(400);
  });

  it('a real event reaches the project of the same name; a repeated one does not duplicate; other projects stay empty', async () => {
    const e = ev(); const dead = await dlq();
    publish(e); publish(e); publish(e);
    expect(await until(async () => (await count()) === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await count()).toBe(1);
    expect(await dlq()).toBe(dead); // una copia repetida se confirma como duplicada, no va a mensajes muertos
    for (const u of [USERS.lead, USERS.billing, USERS.manager]) {
      const r = await get('/projects/p1/team', u); expect(r.status).toBe(200);
      expect(r.body).toEqual([{ engineerName: 'Camila Torres (example)', percent: 50, periodStart: '2026-11-01', periodEnd: '2026-12-15' }]);
    }
    expect((await get('/projects/p2/team', USERS.lead)).body).toEqual([]);
  });

  it('two engineers on the same project appear in order; the same engineer twice (two allocations) appears twice', async () => {
    publish(ev({ engineerName: 'Zoe Ruiz (example)', periodStart: '2026-12-01', periodEnd: '2026-12-20' }));
    publish(ev({ engineerName: 'Ana Gil (example)', periodStart: '2026-11-01', periodEnd: '2026-11-30' }));
    publish(ev({ engineerName: 'Ana Gil (example)', periodStart: '2026-11-01', periodEnd: '2026-12-31', percent: 20 }));
    expect(await until(async () => (await count()) === 3)).toBe(true);
    const r = await get('/projects/p1/team', USERS.lead);
    expect(r.body.map((m: any) => `${m.engineerName}|${m.percent}`)).toEqual(['Ana Gil (example)|20', 'Ana Gil (example)|50', 'Zoe Ruiz (example)|50']);
  });

  it('an invalid event goes to the dead-letter queue, stores nothing and does not block the next valid one', async () => {
    const before = await dlq();
    publish(ev({ percent: 500 })); publish(ev({ engineerName: '<script>' })); ch.publish('erp.events', 'capacity.engineer.allocated', Buffer.from('no es json'), { persistent: true });
    expect(await until(async () => (await dlq()) === before + 3)).toBe(true);
    expect(await count()).toBe(0);
    publish(ev()); expect(await until(async () => (await count()) === 1)).toBe(true);
  });

  const removed = (allocationId: string) => ({ eventId: randomUUID(), type: 'AllocationRemoved', occurredAt: new Date().toISOString(), correlationId: 'corr-12345678', data: { allocationId, projectName: 'Branch network upgrade' } });

  it('a removal event takes the engineer out of the team; a repeated removal is a duplicate and does not go to the dead-letter queue', async () => {
    const a = ev(); publish(a);
    expect(await until(async () => (await count()) === 1)).toBe(true);
    const dead = await dlq();
    publish(removed(a.data.allocationId)); publish(removed(a.data.allocationId));
    expect(await until(async () => (await count()) === 0)).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await get('/projects/p1/team', USERS.lead)).body).toEqual([]);
    expect(await dlq()).toBe(dead);
  }, 20_000);

  it('a removal that arrives BEFORE the allocation is remembered: the allocation never shows up', async () => {
    const a = ev(); const h = teamEventHandler(prisma);
    expect(await h(removed(a.data.allocationId))).toBe('marked');
    expect(await h(a)).toBe('ignored (already removed)');
    expect(await count()).toBe(0);
  });

  it('CONCURRENCY: 40 rounds of allocation and removal at the same time, in random order: the removed allocation is never left in the team', async () => {
    const h = teamEventHandler(prisma);
    for (let r = 0; r < 40; r++) {
      const a = ev(); const jobs = [() => h(a), () => h(removed(a.data.allocationId)), () => h(a)];
      if (r % 2) jobs.reverse();
      await Promise.all(jobs.map((j) => j()));
      expect(await prisma.projectTeamMember.count({ where: { allocationId: a.data.allocationId } })).toBe(0);
    }
  });

  it('the database refuses an impossible row by itself (CHECK)', async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO project_team VALUES (gen_random_uuid(),'Ana','P',0,'2026-11-01','2026-12-01',now())`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO project_team VALUES (gen_random_uuid(),'Ana','P',50,'2026-12-01','2026-11-01',now())`)).rejects.toThrow();
  });
});
