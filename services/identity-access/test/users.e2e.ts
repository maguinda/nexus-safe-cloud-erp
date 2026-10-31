import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { badTokens, bearer, token } from './helpers';

process.env.LOGIN_RATE_LIMIT = '100000'; // los límites de intentos se prueban en rate-limit.e2e.ts y users-rate-limit.e2e.ts
process.env.USERS_WRITE_RATE_LIMIT = '100000';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD as string;
const GOOD = 'Qa-Passw0rd-long!';
const prisma = new PrismaClient();
const SEED: [string, string][] = [['laura.rios@nexus.example', 'project_lead'], ['andres.mora@nexus.example', 'billing_analyst'], ['camila.soto@nexus.example', 'sales'], ['diana.vega@nexus.example', 'manager']];
const seen: string[] = []; // todo lo que respondió la API: al final se comprueba que nunca apareció un hash ni una contraseña

let app: INestApplication;
const call = async (method: 'get' | 'post' | 'patch', path: string, tok: string | null, body?: unknown) => {
  let r = (request(app.getHttpServer()) as any)[method](path);
  if (tok !== null) r = r.set('Authorization', tok.startsWith('Bearer') ? tok : bearer(tok));
  const res = body === undefined ? await r : await r.send(body);
  seen.push(JSON.stringify(res.body));
  return res;
};
const login = async (email: string, password = DEMO_PASSWORD) => (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.accessToken as string;
const create = (tok: string, o: Partial<{ email: string; name: string; role: string; password: string; staffId: string | null }> = {}) => call('post', '/users', tok, { email: 'qa.nuevo@nexus.example', name: 'Carlos Pérez', role: 'sales', password: GOOD, ...o });
const wipe = async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'qa.' } } });
  for (const [email, role] of SEED) await prisma.user.update({ where: { email }, data: { role: role as any } });
};

let diana: string, laura: string;
beforeAll(async () => {
  const { createApp } = require('../src/app.factory');
  app = await createApp(); await app.init();
  await wipe();
  diana = await login('diana.vega@nexus.example'); laura = await login('laura.rios@nexus.example');
});
afterAll(async () => {
  await wipe();
  // Invariante global de la suite: jamás salió un hash de bcrypt, un campo passwordHash ni la contraseña que se envió.
  const all = seen.join('\n');
  expect(all).not.toMatch(/\$2[aby]\$\d\d\$/); expect(all).not.toMatch(/"(passwordHash|password_hash)"\s*:/); // como CLAVE; el mensaje de error puede nombrar el campo que el cliente mandó de más expect(all).not.toContain(GOOD);
  await prisma.$disconnect(); await app.close();
});

describe('access control: only a manager may administer users', () => {
  const routes = (tok: string | null) => [() => call('get', '/users', tok), () => create(tok ?? '', {}).catch(() => null), () => call('patch', '/users/2f0b5d3e-6f1c-4d1e-9a52-0c3a4f5b6c7d/role', tok, { role: 'sales' })];

  it('answers 401 on every route without a token', async () => {
    expect((await call('get', '/users', null)).status).toBe(401);
    expect((await call('post', '/users', null, { email: 'qa.a@nexus.example', name: 'A', role: 'sales', password: GOOD })).status).toBe(401);
    expect((await call('patch', '/users/2f0b5d3e-6f1c-4d1e-9a52-0c3a4f5b6c7d/role', null, { role: 'sales' })).status).toBe(401);
  });

  it.each(Object.keys(badTokens('a.' + Buffer.from('{}').toString('base64url') + '.c')))('answers 401 on every route with a bad token: %s', async (name) => {
    const t = badTokens(laura)[name]; // base: un token de alguien que NO es gerente, para que «alterar el rol» sí cambie la firma
    for (const [method, path, body] of [['get', '/users', undefined], ['post', '/users', { email: 'qa.b@nexus.example', name: 'B', role: 'sales', password: GOOD }], ['patch', '/users/2f0b5d3e-6f1c-4d1e-9a52-0c3a4f5b6c7d/role', { role: 'sales' }]] as const) {
      const res = await call(method, path, t === '' ? 'Bearer ' : bearer(t), body);
      expect(res.status).toBe(401);
    }
    expect(await prisma.user.count({ where: { email: { startsWith: 'qa.' } } })).toBe(0); // y no se creó nadie
  });

  it('answers 403 to project_lead, billing_analyst and sales on every route (and writes nothing)', async () => {
    for (const email of ['laura.rios@nexus.example', 'andres.mora@nexus.example', 'camila.soto@nexus.example']) {
      const t = await login(email);
      expect((await call('get', '/users', t)).status).toBe(403);
      expect((await create(t)).status).toBe(403);
      expect((await call('patch', '/users/2f0b5d3e-6f1c-4d1e-9a52-0c3a4f5b6c7d/role', t, { role: 'manager' })).status).toBe(403);
    }
    expect(await prisma.user.count({ where: { email: { startsWith: 'qa.' } } })).toBe(0);
  });

  it('takes the role from the signed token only, never from the body or a header the client can forge', async () => {
    const res = await (request(app.getHttpServer()).post('/users') as any).set('Authorization', bearer(laura)).set('x-role', 'manager').set('x-user-role', 'manager')
      .send({ email: 'qa.esc@nexus.example', name: 'Esc', role: 'manager', password: GOOD, actorRole: 'manager' });
    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { email: 'qa.esc@nexus.example' } })).toBe(0);
  });

  it('keeps login and health public', async () => {
    expect((await request(app.getHttpServer()).get('/health')).status).toBe(200);
    expect((await request(app.getHttpServer()).post('/auth/login').send({ email: 'laura.rios@nexus.example', password: DEMO_PASSWORD })).status).toBe(200);
  });
  void routes;
});

describe('GET /users', () => {
  it('lists the seeded users with only the public fields', async () => {
    const res = await call('get', '/users', diana);
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.email)).toEqual(expect.arrayContaining(SEED.map(([e]) => e)));
    for (const u of res.body) { expect(Object.keys(u).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role', 'staffId']); expect(u.email).toBe(u.email.toLowerCase()); }
  });
});

describe('POST /users', () => {
  it('creates a salesperson who can then sign in, and stores only a bcrypt hash', async () => {
    const res = await create(diana, { email: 'qa.vendedor1@nexus.example', name: 'Carlos Pérez', role: 'sales' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role', 'staffId']);
    expect(res.body).toMatchObject({ email: 'qa.vendedor1@nexus.example', name: 'Carlos Pérez', role: 'sales' });
    const row = await prisma.user.findUnique({ where: { email: 'qa.vendedor1@nexus.example' } });
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$10\$/); expect(row?.passwordHash).not.toContain(GOOD);
    const signIn = await request(app.getHttpServer()).post('/auth/login').send({ email: 'QA.Vendedor1@Nexus.Example ', password: GOOD });
    expect(signIn.status).toBe(200); expect(signIn.body.user).toEqual({ email: 'qa.vendedor1@nexus.example', name: 'Carlos Pérez', role: 'sales', staffId: null, language: 'es', theme: 'system' });
    expect((await call('get', '/users', signIn.body.accessToken)).status).toBe(403); // el nuevo vendedor no administra usuarios
    expect((await request(app.getHttpServer()).post('/auth/login').send({ email: 'qa.vendedor1@nexus.example', password: GOOD + 'x' })).status).toBe(401);
  });

  it('can create the roles the company needs, including two salespeople', async () => {
    for (const [i, role] of ['sales', 'sales', 'billing_analyst', 'project_lead'].entries()) {
      expect((await create(diana, { email: `qa.rol${i}@nexus.example`, name: `Rol ${i}`, role })).status).toBe(201);
    }
    const sales = (await call('get', '/users', diana)).body.filter((u: any) => u.role === 'sales' && u.email.startsWith('qa.rol'));
    expect(sales).toHaveLength(2);
  });

  it('normalizes the email and the name before storing them', async () => {
    const res = await create(diana, { email: '  QA.Normaliza@NEXUS.example  ', name: '  Ana   María \t Gómez  ' });
    expect(res.status).toBe(201); expect(res.body).toMatchObject({ email: 'qa.normaliza@nexus.example', name: 'Ana María Gómez' });
  });

  it('refuses a repeated email in any case or spacing with 409', async () => {
    await create(diana, { email: 'qa.repetido@nexus.example' });
    for (const email of ['qa.repetido@nexus.example', 'QA.REPETIDO@nexus.example', '  qa.Repetido@Nexus.example ', 'camila.soto@nexus.example', 'CAMILA.SOTO@NEXUS.EXAMPLE']) {
      expect((await create(diana, { email })).status).toBe(409);
    }
    expect(await prisma.user.count({ where: { email: 'qa.repetido@nexus.example' } })).toBe(1);
  });

  it.each([
    ['no body', {}], ['missing email', { name: 'A', role: 'sales', password: GOOD }], ['missing name', { email: 'qa.v1@nexus.example', role: 'sales', password: GOOD }],
    ['missing role', { email: 'qa.v2@nexus.example', name: 'A', password: GOOD }], ['missing password', { email: 'qa.v3@nexus.example', name: 'A', role: 'sales' }],
    ['email is not an email', { email: 'not-an-email', name: 'A', role: 'sales', password: GOOD }], ['email too long', { email: 'a'.repeat(250) + '@x.co', name: 'A', role: 'sales', password: GOOD }],
    ['SQL-looking email', { email: "x'; DROP TABLE users;--@nexus.example", name: 'A', role: 'sales', password: GOOD }],
    ['unknown role', { email: 'qa.v4@nexus.example', name: 'A', role: 'admin', password: GOOD }], ['role as array', { email: 'qa.v5@nexus.example', name: 'A', role: ['sales'], password: GOOD }],
    ['role as object', { email: 'qa.v6@nexus.example', name: 'A', role: { $ne: 'x' }, password: GOOD }], ['empty name', { email: 'qa.v7@nexus.example', name: '   ', role: 'sales', password: GOOD }],
    ['name of 121 characters', { email: 'qa.v8@nexus.example', name: 'n'.repeat(121), role: 'sales', password: GOOD }], ['name with a control character', { email: 'qa.v9@nexus.example', name: 'Ana\u0000Pérez', role: 'sales', password: GOOD }],
    ['name is a number', { email: 'qa.v10@nexus.example', name: 12345, role: 'sales', password: GOOD }], ['password is a number', { email: 'qa.v11@nexus.example', name: 'A', role: 'sales', password: 123456789012 }],
    ['password of 129 characters', { email: 'qa.v12@nexus.example', name: 'A', role: 'sales', password: 'aB3'.repeat(43) }],
    ['extra field passwordHash', { email: 'qa.v13@nexus.example', name: 'A', role: 'sales', password: GOOD, passwordHash: '$2a$10$abc' }], ['extra field id', { email: 'qa.v14@nexus.example', name: 'A', role: 'sales', password: GOOD, id: '2f0b5d3e-6f1c-4d1e-9a52-0c3a4f5b6c7d' }],
    ['extra field isAdmin', { email: 'qa.v15@nexus.example', name: 'A', role: 'sales', password: GOOD, isAdmin: true }],
  ])('rejects with 400 and creates nothing: %s', async (_n, body) => {
    const before = await prisma.user.count();
    const res = await call('post', '/users', diana, body);
    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(before); // no se creó nadie y la tabla sigue en pie
  });

  it.each([
    ['too short', 'Short-1!', /at least 12/], ['only 4 different characters repeated', 'abababababababab', /4 different/], ['leading space', ' correct-horse-battery', /start or end with spaces/],
    ['trailing newline', 'correct-horse-battery\n', /start or end with spaces/], ['contains the email name part', 'xx-qa.carlos.perez-xx-2026', /email/], ['more than 72 bytes', 'aB3-'.repeat(19), /72 bytes/],
  ])('rejects a weak password with 400 and a clear message: %s', async (_n, password, message) => {
    const res = await create(diana, { email: 'qa.carlos.perez@nexus.example', password });
    expect(res.status).toBe(400); expect(res.body.message).toMatch(message);
    expect(await prisma.user.count({ where: { email: 'qa.carlos.perez@nexus.example' } })).toBe(0);
  });

  it('refuses a body over 10 kB with 413 and malformed JSON with 400', async () => {
    expect((await call('post', '/users', diana, { email: 'qa.big@nexus.example', name: 'n'.repeat(11_000), role: 'sales', password: GOOD })).status).toBe(413);
    const bad = await (request(app.getHttpServer()).post('/users') as any).set('Authorization', bearer(diana)).set('Content-Type', 'application/json').send('{"email": "qa.json@nexus.example", ');
    expect(bad.status).toBe(400);
  });

  it('does not let a prototype-pollution payload create a manager', async () => {
    const res = await (request(app.getHttpServer()).post('/users') as any).set('Authorization', bearer(diana)).set('Content-Type', 'application/json')
      .send('{"email":"qa.proto@nexus.example","name":"P","password":"' + GOOD + '","__proto__":{"role":"manager"},"constructor":{"prototype":{"role":"manager"}}}');
    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { email: 'qa.proto@nexus.example' } })).toBe(0);
  });

  it('stores a hostile-looking name literally and leaves the table intact (queries are parameterized)', async () => {
    const name = "Robert'); DROP TABLE users;--";
    const res = await create(diana, { email: 'qa.bobby@nexus.example', name });
    expect(res.status).toBe(201); expect(res.body.name).toBe(name);
    const xss = await create(diana, { email: 'qa.xss@nexus.example', name: '<img src=x onerror=alert(1)>' });
    expect(xss.status).toBe(201); expect(xss.body.name).toBe('<img src=x onerror=alert(1)>'); // se guarda tal cual; la web lo escapa al mostrarlo
    expect(await prisma.user.count()).toBeGreaterThanOrEqual(6);
  });

  it('lets exactly one of 15 simultaneous requests with the same email win, in 30 rounds', async () => {
    for (let round = 0; round < 30; round++) {
      const email = `qa.dup${round}@nexus.example`;
      const results = await Promise.all(Array.from({ length: 15 }, () => create(diana, { email, name: `Dup ${round}` })));
      const codes = results.map((r) => r.status).sort();
      expect(codes.filter((c) => c === 201)).toHaveLength(1);
      expect(codes.filter((c) => c === 409)).toHaveLength(14);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    }
  }, 180_000);

  it('the database itself refuses an uppercase email, an empty name and an oversized name (second line of defense)', async () => {
    const base = { passwordHash: '$2a$10$' + 'x'.repeat(53), role: 'sales' as const };
    await expect(prisma.user.create({ data: { ...base, email: 'qa.Upper@nexus.example', name: 'U' } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { ...base, email: 'qa.nm1@nexus.example', name: '' } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { ...base, email: 'qa.nm2@nexus.example', name: 'n'.repeat(121) } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { ...base, email: 'a@', name: 'ok' } })).rejects.toThrow();
    expect(await prisma.user.count({ where: { email: { in: ['qa.Upper@nexus.example', 'qa.nm1@nexus.example', 'qa.nm2@nexus.example', 'a@'] } } })).toBe(0);
  });
});

describe('PATCH /users/:id/role', () => {
  const idOf = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const patch = (tok: string, id: string, body: unknown) => call('patch', `/users/${id}/role`, tok, body);
  const SOME = '2f0b5d3e-6f1c-4d1e-9a52-0c3a4f5b6c7d';

  it('changes someone else’s role; the new role applies from the next sign-in', async () => {
    await create(diana, { email: 'qa.cambio@nexus.example', role: 'sales' });
    const id = await idOf('qa.cambio@nexus.example');
    const oldToken = await login('qa.cambio@nexus.example', GOOD);
    const res = await patch(diana, id, { role: 'billing_analyst' });
    expect(res.status).toBe(200); expect(res.body).toMatchObject({ id, email: 'qa.cambio@nexus.example', role: 'billing_analyst' });
    expect((await request(app.getHttpServer()).post('/auth/login').send({ email: 'qa.cambio@nexus.example', password: GOOD })).body.user.role).toBe('billing_analyst');
    expect(oldToken).toBeTruthy(); // el token anterior sigue diciendo «sales» hasta vencer (15 min): límite documentado
  });

  it('is a no-op (200) when the user already has that role', async () => {
    const id = await idOf('qa.cambio@nexus.example');
    expect((await patch(diana, id, { role: 'billing_analyst' })).status).toBe(200);
  });

  it('answers 404 for an unknown user and 400 for a malformed id, an unknown role or extra fields', async () => {
    expect((await patch(diana, SOME, { role: 'sales' })).status).toBe(404);
    for (const id of ['not-a-uuid', '1; DROP TABLE users', '00000000-0000-0000-0000-00000000000g']) expect((await patch(diana, id, { role: 'sales' })).status).toBe(400);
    const id = await idOf('qa.cambio@nexus.example');
    for (const body of [{}, { role: 'admin' }, { role: ['sales'] }, { role: 'sales', id: SOME }, { role: 'sales', email: 'x@y.co' }, { role: null }]) expect((await patch(diana, id, body)).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'qa.cambio@nexus.example' } })).role).toBe('billing_analyst');
  });

  it('refuses to change your own role with 409 even when another manager exists (so only the own-role rule can stop it)', async () => {
    await create(diana, { email: 'qa.gerente4@nexus.example', role: 'manager' }); // con dos gerentes la regla «último gerente» no interviene
    const me = await idOf('diana.vega@nexus.example');
    const res = await patch(diana, me, { role: 'sales' });
    expect(res.status).toBe(409); expect(res.body.message).toMatch(/your own role/);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'diana.vega@nexus.example' } })).role).toBe('manager');
  });
  it('and the last manager rule: the only remaining manager can never be demoted by anyone', async () => {
    const g4 = await idOf('qa.gerente4@nexus.example'); const me = await idOf('diana.vega@nexus.example');
    expect((await patch(diana, g4, { role: 'sales' })).status).toBe(200); // 2 -> 1: permitido
    expect((await prisma.user.count({ where: { role: 'manager' } }))).toBe(1);
    expect((await patch(diana, me, { role: 'sales' })).status).toBe(409); // el único gerente no puede quitarse el rol
    expect((await prisma.user.count({ where: { role: 'manager' } }))).toBe(1);
  });

  it('refuses a non-manager even for their own id', async () => {
    const lauraId = await idOf('laura.rios@nexus.example');
    expect((await patch(laura, lauraId, { role: 'manager' })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'laura.rios@nexus.example' } })).role).toBe('project_lead');
  });

  it('a manager demoted a moment ago cannot use the old token (the caller’s role is re-read from the database)', async () => {
    await create(diana, { email: 'qa.gerente2@nexus.example', role: 'manager' });
    const gerente2 = await login('qa.gerente2@nexus.example', GOOD);
    expect((await call('get', '/users', gerente2)).status).toBe(200);
    expect((await patch(diana, await idOf('qa.gerente2@nexus.example'), { role: 'sales' })).status).toBe(200); // Diana lo baja; su token sigue vigente
    expect((await call('get', '/users', gerente2)).status).toBe(403);
    expect((await create(gerente2, { email: 'qa.tarde@nexus.example' })).status).toBe(403);
    expect((await patch(gerente2, await idOf('diana.vega@nexus.example'), { role: 'sales' })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: 'diana.vega@nexus.example' } })).role).toBe('manager');
    expect(await prisma.user.count({ where: { email: 'qa.tarde@nexus.example' } })).toBe(0);
  });

  it('two managers who demote each other at the same time never leave the system without a manager, in 30 rounds', async () => {
    await create(diana, { email: 'qa.gerente3@nexus.example', role: 'manager' });
    const g3 = await login('qa.gerente3@nexus.example', GOOD);
    const [dianaId, g3Id] = [await idOf('diana.vega@nexus.example'), await idOf('qa.gerente3@nexus.example')];
    for (let round = 0; round < 30; round++) {
      await prisma.user.updateMany({ where: { id: { in: [dianaId, g3Id] } }, data: { role: 'manager' } });
      const [a, b] = await Promise.all([patch(diana, g3Id, { role: 'sales' }), patch(g3, dianaId, { role: 'sales' })]);
      expect([a.status, b.status].sort()).toEqual([200, 403]); // uno gana; el otro ya no era gerente cuando le tocó su turno
      const managers = await prisma.user.count({ where: { role: 'manager' } });
      expect(managers).toBeGreaterThanOrEqual(1);
    }
    await prisma.user.updateMany({ where: { id: { in: [dianaId, g3Id] } }, data: { role: 'manager' } }); // quien perdió la última ronda vuelve a ser gerente para las pruebas siguientes
  }, 120_000);

  it('15 simultaneous promotions of the same user to different roles leave a valid role and no error', async () => {
    await create(diana, { email: 'qa.carrera@nexus.example', role: 'sales' });
    const id = await idOf('qa.carrera@nexus.example');
    const roles = ['sales', 'billing_analyst', 'project_lead', 'manager'];
    const out = await Promise.all(Array.from({ length: 15 }, (_, i) => patch(diana, id, { role: roles[i % 4] })));
    expect(out.every((r) => r.status === 200)).toBe(true);
    expect(roles).toContain((await prisma.user.findUniqueOrThrow({ where: { id } })).role);
  }, 60_000);
});

describe('what a token proves', () => {
  it('a token signed by identity for a user who does not exist cannot administer anything', async () => {
    const ghost = token({ role: 'manager' }); // firma correcta, rol manager, pero la persona no existe en la base
    expect((await call('get', '/users', ghost)).status).toBe(403);
    expect((await create(ghost, { email: 'qa.ghost@nexus.example' })).status).toBe(403);
    expect(await prisma.user.count({ where: { email: 'qa.ghost@nexus.example' } })).toBe(0);
  });
});

describe('engineer and technician accounts (they belong to a person of the staff)', () => {
  const ANA = '11111111-1111-4111-8111-1111111111aa', HUGO = '11111111-1111-4111-8111-1111111111bb';
  beforeEach(wipe);
  it('creates them with the staff member, the token carries it, and the response lists it', async () => {
    const e = await create(diana, { email: 'qa.ing@nexus.example', role: 'engineer', staffId: ANA.toUpperCase() }); expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ role: 'engineer', staffId: ANA });
    const t = await create(diana, { email: 'qa.tec@nexus.example', role: 'technician', staffId: HUGO }); expect(t.status).toBe(201);
    const signIn = await request(app.getHttpServer()).post('/auth/login').send({ email: 'qa.ing@nexus.example', password: GOOD });
    expect(signIn.status).toBe(200); expect(signIn.body.user).toEqual({ email: 'qa.ing@nexus.example', name: 'Carlos Pérez', role: 'engineer', staffId: ANA, language: 'es', theme: 'system' });
    const claims: any = JSON.parse(Buffer.from(signIn.body.accessToken.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ role: 'engineer', staffId: ANA });
    const other = await request(app.getHttpServer()).post('/auth/login').send({ email: 'camila.soto@nexus.example', password: DEMO_PASSWORD });
    expect(JSON.parse(Buffer.from(other.body.accessToken.split('.')[1], 'base64url').toString())).not.toHaveProperty('staffId');
    expect((await call('get', '/users', signIn.body.accessToken)).status).toBe(403); // no administran usuarios
    expect((await create(signIn.body.accessToken, { email: 'qa.x@nexus.example' })).status).toBe(403);
  });
  it('refuses a staff role without the person, a bad id, a person on another role, and one person with two accounts (409)', async () => {
    for (const bad of [{ role: 'engineer' }, { role: 'technician', staffId: null }, { role: 'engineer', staffId: 'zz' }, { role: 'technician', staffId: 5 as any }, { role: 'sales', staffId: ANA }, { role: 'manager', staffId: ANA }, { role: 'finance', staffId: ANA }]) {
      expect((await create(diana, { email: 'qa.bad@nexus.example', ...bad })).status).toBe(400);
    }
    expect(await prisma.user.count({ where: { email: 'qa.bad@nexus.example' } })).toBe(0);
    expect((await create(diana, { email: 'qa.ing1@nexus.example', role: 'engineer', staffId: ANA })).status).toBe(201);
    expect((await create(diana, { email: 'qa.ing2@nexus.example', role: 'technician', staffId: ANA })).status).toBe(409);
    expect(await prisma.user.count({ where: { email: 'qa.ing2@nexus.example' } })).toBe(0);
  });
  it('their role never changes and nobody becomes staff by a role change (400); the database keeps the pairing', async () => {
    const e = (await create(diana, { email: 'qa.ing@nexus.example', role: 'engineer', staffId: ANA })).body;
    const sales = (await create(diana, { email: 'qa.v@nexus.example', role: 'sales' })).body;
    for (const [id, role] of [[e.id, 'sales'], [e.id, 'technician'], [e.id, 'manager'], [sales.id, 'engineer'], [sales.id, 'technician']] as const) expect((await call('patch', `/users/${id}/role`, diana, { role })).status).toBe(400);
    expect((await call('patch', `/users/${e.id}/role`, diana, { role: 'engineer' })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: e.id } })).role).toBe('engineer');
    await expect(prisma.$executeRawUnsafe(`UPDATE users SET staff_id = NULL WHERE id = '${e.id}'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE users SET staff_id = '${HUGO}' WHERE id = '${sales.id}'`)).rejects.toThrow();
  });
  it('CONCURRENCY: 8 simultaneous accounts for the same person → exactly one is created', async () => {
    for (let r = 0; r < 10; r++) {
      await wipe();
      const res = await Promise.all(Array.from({ length: 8 }, (_, k) => create(diana, { email: `qa.c${k}@nexus.example`, role: k % 2 ? 'technician' : 'engineer', staffId: ANA })));
      expect(res.filter((x) => x.status === 201)).toHaveLength(1); expect(res.filter((x) => x.status === 409)).toHaveLength(7);
    }
  }, 120_000);
});
