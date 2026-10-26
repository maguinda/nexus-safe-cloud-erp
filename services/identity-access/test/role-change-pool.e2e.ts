import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer } from './helpers';

// El servicio abre pocas conexiones a la base (el servidor del CI tiene 2 procesadores: 5 conexiones). Se fija ANTES de crear la app
// para que la prueba no dependa de la máquina en la que corre: 3 conexiones y una ráfaga de 15 cambios de rol a la vez.
process.env.DATABASE_URL = `${process.env.DATABASE_URL}${String(process.env.DATABASE_URL).includes('?') ? '&' : '?'}connection_limit=3`;
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.USERS_WRITE_RATE_LIMIT = '100000';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD as string;
const prisma = new PrismaClient({ datasources: { db: { url: String(process.env.DATABASE_URL).replace(/[?&]connection_limit=3/, '') } } }); // la comprobación usa su propio cliente, sin el límite
const SEED: [string, string][] = [['laura.rios@nexus.example', 'project_lead'], ['andres.mora@nexus.example', 'billing_analyst'], ['camila.soto@nexus.example', 'sales'], ['diana.vega@nexus.example', 'manager']];

let app: INestApplication;
beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'qa.pool' } } });
  for (const [email, role] of SEED) await prisma.user.update({ where: { email }, data: { role: role as any } });
  await app.close(); await prisma.$disconnect();
});

describe('role changes with few database connections', () => {
  it('a burst of 15 changes at once with only 3 connections queues up: every one answers 200 and none fails with a 500', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: 'diana.vega@nexus.example', password: DEMO_PASSWORD });
    const diana = login.body.accessToken as string;
    const created = await request(app.getHttpServer()).post('/users').set('Authorization', bearer(diana)).send({ email: 'qa.pool@nexus.example', name: 'Qa Pool', role: 'sales', password: 'Qa-Passw0rd-long!' });
    expect(created.status).toBe(201);
    const roles = ['sales', 'billing_analyst', 'project_lead', 'manager'];
    const out = await Promise.all(Array.from({ length: 15 }, (_, i) => request(app.getHttpServer()).patch(`/users/${created.body.id}/role`).set('Authorization', bearer(diana)).send({ role: roles[i % 4] })));
    expect(out.map((r) => r.status)).toEqual(Array(15).fill(200));
    expect(roles).toContain((await prisma.user.findUniqueOrThrow({ where: { id: created.body.id } })).role);
    expect(await prisma.user.count({ where: { role: 'manager' } })).toBeGreaterThanOrEqual(1); // y nunca se quedó el sistema sin gerente
  }, 90_000);
});
