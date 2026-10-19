import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { bearer } from './helpers';

process.env.LOGIN_RATE_LIMIT = '100000';
process.env.USERS_WRITE_RATE_LIMIT = '3'; // se lee al cargar el controlador: por eso va antes del require
const prisma = new PrismaClient();

describe('user creation is rate limited per client', () => {
  let app: INestApplication;
  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  afterAll(async () => { await prisma.user.deleteMany({ where: { email: { startsWith: 'qa.rl' } } }); await prisma.$disconnect(); await app.close(); });

  it('answers 429 from the 4th creation in a minute', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: 'diana.vega@nexus.example', password: process.env.DEMO_PASSWORD });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app.getHttpServer()).post('/users').set('Authorization', bearer(login.body.accessToken)).send({ email: `qa.rl${i}@nexus.example`, name: 'Rl', role: 'sales', password: 'Qa-Passw0rd-long!' });
      codes.push(r.status);
    }
    expect(codes).toEqual([201, 201, 201, 429, 429]);
    expect(await prisma.user.count({ where: { email: { startsWith: 'qa.rl' } } })).toBe(3);
  });
});
