import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer, resetState, token, USERS } from './helpers';

process.env.RELAY_ENABLED = 'false';
process.env.RATE_LIMIT = '100000';

describe('approving a milestone (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const approve = (id: string, who = USERS.lead, corr?: string) => {
    const r = request(app.getHttpServer()).post(`/milestones/${id}/approve`).set('Authorization', bearer(token(who)));
    return corr ? r.set('x-correlation-id', corr) : r;
  };

  beforeAll(async () => {
    const { createApp } = require('../src/app.factory');
    app = await createApp();
    await app.init();
  });
  beforeEach(() => resetState(prisma));
  afterAll(async () => { await resetState(prisma); await app.close(); await prisma.$disconnect(); });

  it('approves, answers 200 with the contract shape, and writes exactly one outbox event', async () => {
    const res = await approve('m2', USERS.lead, 'trace-abcdef12');
    expect(res.status).toBe(200);
    expect(res.body.milestone).toEqual({ id: 'm2', projectId: 'p1', name: 'Link redundancy design', amountCop: 18_500_000, status: 'approved' });
    const rows = await prisma.outboxEvent.findMany({ where: { aggregateId: 'm2' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.body.eventId);
    expect(rows[0].publishedAt).toBeNull(); // el relay aún no corre en esta prueba
    expect(rows[0].routingKey).toBe('project.milestone.approved');
    expect(rows[0].payload).toMatchObject({
      type: 'MilestoneApproved', correlationId: 'trace-abcdef12',
      data: { milestoneId: 'm2', milestoneName: 'Link redundancy design', projectId: 'p1', projectName: 'Branch network upgrade', amountCop: 18_500_000, approvedBy: USERS.lead.email },
    });
  });

  it('takes "approvedBy" from the token even if the body claims another user', async () => {
    await request(app.getHttpServer()).post('/milestones/m2/approve').set('Authorization', bearer(token(USERS.lead))).send({ approvedBy: 'cfo@evil.example' });
    expect((await prisma.milestone.findUnique({ where: { id: 'm2' } }))?.approvedBy).toBe(USERS.lead.email);
  });

  it('answers 409 on the second approval and keeps one event and the first approver', async () => {
    const other = { ...USERS.lead, id: randomUUID(), email: 'second.lead@nexus.example' };
    expect((await approve('m2')).status).toBe(200);
    const again = await approve('m2', other);
    expect(again.status).toBe(409);
    expect(again.body).toEqual(expect.objectContaining({ statusCode: 409, error: 'Conflict', correlationId: expect.any(String) }));
    expect(await prisma.outboxEvent.count({ where: { aggregateId: 'm2' } })).toBe(1);
    expect((await prisma.milestone.findUnique({ where: { id: 'm2' } }))?.approvedBy).toBe(USERS.lead.email);
  });

  it('approving an already-approved seed milestone (m1) is a 409 and writes no event', async () => {
    expect((await approve('m1')).status).toBe(409);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('lets different milestones be approved at the same time', async () => {
    const results = await Promise.all(['m2', 'm3', 'm5', 'm6'].map((id) => approve(id)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await prisma.outboxEvent.count()).toBe(4);
  });

  it('the database itself rejects a second MilestoneApproved event for the same milestone', async () => {
    await approve('m2');
    await expect(prisma.outboxEvent.create({ data: { id: randomUUID(), aggregateId: 'm2', type: 'MilestoneApproved', routingKey: 'x', payload: {} } })).rejects.toThrow();
  });

  it('CONCURRENCY: 30 rounds of 15 simultaneous approvals of the same milestone -> exactly one wins every time', async () => {
    const leads = Array.from({ length: 15 }, (_, i) => ({ ...USERS.lead, id: randomUUID(), email: `lead${i}@nexus.example` }));
    for (let round = 1; round <= 30; round++) {
      await resetState(prisma);
      const res = await Promise.all(leads.map((l) => approve('m3', l)));
      const codes = res.map((r) => r.status);
      const winners = codes.filter((c) => c === 200).length;
      const conflicts = codes.filter((c) => c === 409).length;
      if (winners !== 1 || conflicts !== 14) throw new Error(`round ${round}: ${JSON.stringify(codes)}`);
      // Invariante: un solo evento, y el aprobador guardado es justamente el de la petición que ganó.
      const events = await prisma.outboxEvent.findMany({ where: { aggregateId: 'm3' } });
      expect(events).toHaveLength(1);
      const winnerEmail = leads[codes.indexOf(200)].email;
      expect((await prisma.milestone.findUnique({ where: { id: 'm3' } }))?.approvedBy).toBe(winnerEmail);
      expect((events[0].payload as any).data.approvedBy).toBe(winnerEmail);
      expect(res[codes.indexOf(200)].body.eventId).toBe(events[0].id);
    }
  }, 120_000);
});
