import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import request from 'supertest';
import { loadNetwork } from '../prisma/network-load';
import { bearer, OTHER_KEYS, token, unsigned, USERS } from './helpers';

process.env.CONSUMER_ENABLED = 'false'; // estas pruebas no necesitan RabbitMQ
process.env.RATE_LIMIT = '100000';

const file = <T>(n: string): T => JSON.parse(readFileSync(`prisma/data/${n}`, 'utf8'));
type Device = { id: number; name: string; category: string; criticality: string };
type Link = { id: number; originName: string; destinationName: string; linkType: string; functional: boolean | null; criticality: string };

describe('network inventory: the Nexus data loaded into Analytics and read by the manager (e2e, real PostgreSQL)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const devices = file<Device[]>('network-devices.json');
  const links = file<Link[]>('network-links.json');
  const get = (auth?: string) => { const r = request(app.getHttpServer()).get('/network/summary'); return auth ? r.set('Authorization', auth) : r; };
  const manager = () => bearer(token(USERS.manager));
  const wipe = async () => { await prisma.networkMonitoring.deleteMany(); await prisma.networkLink.deleteMany(); await prisma.networkDevice.deleteMany(); };
  const counts = async () => ({ devices: await prisma.networkDevice.count(), links: await prisma.networkLink.count(), monitoring: await prisma.networkMonitoring.count() });
  const ALL = { devices: 76, links: 74, monitoring: 10 };
  const countBy = <T>(rows: T[], key: (r: T) => string) => { const m: Record<string, number> = {}; for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1; return m; };

  beforeAll(async () => { const { createApp } = require('../src/app.factory'); app = await createApp(); await app.init(); });
  beforeEach(async () => { await wipe(); await loadNetwork(prisma); });
  afterAll(async () => { await wipe(); await loadNetwork(prisma); await app.close(); await prisma.$disconnect(); }); // la demo queda con sus datos

  describe('authentication and roles', () => {
    const bad: [string, string | undefined][] = [
      ['no token', undefined], ['garbage', 'Bearer not.a.jwt'], ['expired', bearer(token(USERS.manager, { expiresIn: -60 }))],
      ['signed with another key', bearer(token(USERS.manager, { key: OTHER_KEYS.privateKey }))], ['alg=none', bearer(unsigned(USERS.manager))],
      ['unknown role', bearer(token({ ...USERS.lead, role: 'admin' }))],
    ];
    for (const [name, auth] of bad) it(`${name} -> 401`, async () => { expect((await get(auth)).status).toBe(401); });
    it('the manager gets 200', async () => { expect((await get(manager())).status).toBe(200); });
    it.each([['project_lead', USERS.lead], ['billing_analyst', USERS.billing], ['sales', USERS.sales]])('%s gets 403 and no figure leaks', async (_n, u) => {
      const r = await get(bearer(token(u)));
      expect(r.status).toBe(403);
      expect(Object.keys(r.body).sort()).toEqual(['correlationId', 'error', 'message', 'statusCode']);
      expect(JSON.stringify(r.body)).not.toMatch(/Switch|Router|ASA|Multilayer|totals|syslog/i);
    });
  });

  describe('what the manager reads', () => {
    it('matches the source exactly: 76 devices, 74 links, 10 pieces of infrastructure, 5 critical devices', async () => {
      const b = (await get(manager())).body;
      expect(b.totals).toEqual({ devices: 76, links: 74, criticalDevices: 5, infrastructure: 10 });
      expect(b.byCriticality).toEqual([{ criticality: 'Crítica', count: 5 }, { criticality: 'Alta', count: 5 }, { criticality: 'Media', count: 66 }]);
      // el mismo cálculo hecho aparte sobre el archivo
      const byCat = countBy(devices, (d) => d.category);
      expect(Object.fromEntries(b.byCategory.map((c: any) => [c.category, c.count]))).toEqual(byCat);
      expect(b.byCategory[0]).toEqual({ category: 'Laptop', count: 36 });
      expect(byCat).toMatchObject({ Laptop: 36, PC: 11, 'CCTV / IoT': 9, IoT: 6, 'Switch Acceso': 5, 'Switch Capa 3': 2, Router: 2, 'Firewall / ASA': 1, Servidor: 1 });
    });

    it('links: 74 in total, 69 functional, none not-functional and 5 without data (the IoT ones)', async () => {
      const l = (await get(manager())).body.links;
      expect(l).toMatchObject({ total: 74, functional: 69, notFunctional: 0, noData: 5 });
      expect(l.byType).toEqual([{ type: 'eCopper', count: 69 }, { type: 'eCustomIOLink', count: 5 }]);
      expect(l.byCriticality).toEqual([{ criticality: 'Crítica', count: 11 }, { criticality: 'Alta', count: 63 }, { criticality: 'Media', count: 0 }]);
      expect(l.byType.reduce((n: number, t: any) => n + t.count, 0)).toBe(links.length);
      expect(links.filter((x) => x.functional === null).every((x) => x.linkType === 'eCustomIOLink')).toBe(true);
    });

    it('monitoring: nothing has syslog, SNMP or NTP configured, only 4 of 10 have NetFlow, and 12 signals could be watched', async () => {
      const m = (await get(manager())).body.monitoring;
      expect(m).toEqual({ equipment: 10, syslog: 0, snmp: 0, ntp: 0, netflow: 4, withoutAnyConfig: 6, signalsPossible: 12 });
    });

    it('the infrastructure list starts with the 5 critical pieces, then the 5 high ones, each by name', async () => {
      const rows = (await get(manager())).body.infrastructure;
      expect(rows).toHaveLength(10);
      expect(rows.map((r: any) => r.criticality)).toEqual(['Crítica', 'Crítica', 'Crítica', 'Crítica', 'Crítica', 'Alta', 'Alta', 'Alta', 'Alta', 'Alta']);
      for (const g of [rows.slice(0, 5), rows.slice(5)]) { const n = g.map((r: any) => r.name); expect(n).toEqual([...n].sort((a: string, b: string) => a.localeCompare(b))); }
      expect(rows.every((r: any) => r.signals === 12)).toBe(true);
      const core = rows.find((r: any) => r.name === 'Multilayer Switch0');
      expect(core).toMatchObject({ model: '3560-24PS', role: 'Core / Distribución L3', ips: '10.0.0.2; 10.0.0.9', netflow: true, syslog: false });
    });

    it('answers fast: it never loads the 76 devices or the 74 links', async () => {
      const t = Date.now(); expect((await get(manager())).status).toBe(200); expect(Date.now() - t).toBeLessThan(2000);
    });

    it('with nothing loaded it answers 200 with zeros, not an error', async () => {
      await wipe();
      const b = (await get(manager())).body;
      expect(b.totals).toEqual({ devices: 0, links: 0, criticalDevices: 0, infrastructure: 0 });
      expect(b.byCategory).toEqual([]); expect(b.infrastructure).toEqual([]);
      expect(b.monitoring).toEqual({ equipment: 0, syslog: 0, snmp: 0, ntp: 0, netflow: 0, withoutAnyConfig: 0, signalsPossible: 0 });
    });
  });

  describe('the loader', () => {
    it('is idempotent: loading again changes nothing', async () => {
      expect(await loadNetwork(prisma)).toEqual(ALL);
      expect((await get(manager())).body.totals.devices).toBe(76);
    });

    it('finishes a half-done load without duplicating what is already there', async () => {
      await prisma.networkMonitoring.deleteMany(); await prisma.networkLink.deleteMany({ where: { id: { gt: 30 } } });
      expect(await counts()).toEqual({ devices: 76, links: 30, monitoring: 0 });
      expect(await loadNetwork(prisma)).toEqual(ALL);
    });

    it('two loads at the same time (10 rounds) still leave exactly the source: no error, no duplicate', async () => {
      for (let i = 0; i < 10; i++) {
        await wipe();
        await Promise.all([loadNetwork(prisma), loadNetwork(prisma)]);
        expect(await counts()).toEqual(ALL);
      }
    });

    it('every link joins two devices of the inventory, and each monitored piece is a device of the inventory', async () => {
      const names = new Set(devices.map((d) => d.name));
      expect(links.every((l) => names.has(l.originName) && names.has(l.destinationName))).toBe(true);
      const orphans = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM network_monitoring m LEFT JOIN network_devices d ON d.name = m.device_name WHERE d.id IS NULL`);
      expect(orphans[0].n).toBe(0);
    });
  });

  describe('the database refuses what it should', () => {
    const dev = { id: 9001, name: 'QA device', ptType: 'x', model: 'x', category: 'x', role: 'x', criticality: 'Media', serial: 'QA-1', ips: null, gateways: null };
    const link = { id: 9001, originName: 'QA device', originPort: 'Fa0/1', destinationName: 'Multilayer Switch0', destinationPort: 'Fa0/2', linkType: 'eCopper', cableType: null, functional: null, length: 1, criticality: 'Alta' };
    it('a criticality that is not Crítica, Alta or Media (device and link)', async () => {
      await expect(prisma.networkDevice.create({ data: { ...dev, criticality: 'Baja' } })).rejects.toThrow();
      await prisma.networkDevice.create({ data: dev });
      await expect(prisma.networkLink.create({ data: { ...link, criticality: 'Baja' } })).rejects.toThrow();
    });
    it('a link of a device that is not in the inventory (foreign key)', async () => {
      await expect(prisma.networkLink.create({ data: { ...link, originName: 'Does not exist' } })).rejects.toThrow();
      await prisma.networkDevice.create({ data: dev });
      await expect(prisma.networkLink.create({ data: { ...link, destinationName: 'Does not exist' } })).rejects.toThrow();
    });
    it('monitoring of a device that is not in the inventory', async () => {
      await expect(prisma.networkMonitoring.create({ data: { deviceName: 'Ghost', syslog: false, snmp: false, ntp: false, netflow: false, signals: [] } })).rejects.toThrow();
    });
    it('a second device with the same name (unique) or the same id', async () => {
      await expect(prisma.networkDevice.create({ data: { ...dev, name: 'Multilayer Switch0' } })).rejects.toThrow();
      await expect(prisma.networkDevice.create({ data: { ...dev, id: 2 } })).rejects.toThrow();
    });
    it('a link that joins a device with itself through the same port', async () => {
      await prisma.networkDevice.create({ data: dev });
      await expect(prisma.networkLink.create({ data: { ...link, destinationName: 'QA device', destinationPort: 'Fa0/1' } })).rejects.toThrow(/network_links_not_self_port_check/);
      await expect(prisma.networkLink.create({ data: { ...link, destinationName: 'QA device', destinationPort: 'Fa0/9', id: 9002 } })).resolves.toBeTruthy(); // otro puerto sí se puede
    });
    // Con SQL directo: el cliente de Prisma ya rechaza NaN e infinitos antes de llegar a la base, y aquí se prueba la regla de la base.
    it.each(['-1', "'NaN'::float8", "'Infinity'::float8", "'-Infinity'::float8"])('a length of %s (CHECK in the database)', async (v) => {
      await prisma.networkDevice.create({ data: dev });
      await expect(prisma.$executeRawUnsafe(`INSERT INTO network_links (id, origin_name, origin_port, destination_name, destination_port, link_type, criticality, length) VALUES (9003, 'QA device', 'a', 'Multilayer Switch0', 'b', 'eCopper', 'Alta', ${v})`)).rejects.toThrow(/network_links_length_check/);
    });
    it('deleting a device that still has links or monitoring (restrict)', async () => {
      await expect(prisma.networkDevice.delete({ where: { name: 'Multilayer Switch0' } })).rejects.toThrow();
    });
  });
});
