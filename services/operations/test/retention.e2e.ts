import { PrismaClient } from '@prisma/client';
import { DeleteOldReadingsUseCase } from '../src/application/delete-old-readings.use-case';
import { PrismaReadingRetention } from '../src/infrastructure/prisma-reading-retention';

const NOTE = 'retention-test';
const DAY = 86_400_000;

describe('readings retention (e2e, real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const store = new PrismaReadingRetention(prisma);
  const NOW = new Date();
  let devices: { id: string; unit: string }[] = [];
  const add = (deviceId: string, unit: string, daysAgo: number) => prisma.iotReading.create({ data: { deviceId, recordedAt: new Date(NOW.getTime() - daysAgo * DAY), status: 'NORMAL', value: 20, unit, note: NOTE } });
  const mine = () => prisma.iotReading.count({ where: { note: NOTE } });
  const total = () => prisma.iotReading.count();
  const cleanup = () => prisma.iotReading.deleteMany({ where: { note: NOTE } });

  beforeAll(async () => { devices = await prisma.iotDevice.findMany({ select: { id: true, unit: true }, orderBy: { id: 'asc' } }); await cleanup(); });
  afterEach(cleanup);
  afterAll(async () => { await cleanup(); await loadSeedBack(); await prisma.$disconnect(); });

  it('deletes readings older than the period and keeps the recent ones', async () => {
    const d = devices[0];
    for (const age of [400, 500, 700]) await add(d.id, d.unit, age);
    for (const age of [1, 100, 300]) await add(d.id, d.unit, age);
    const before = await total();
    expect(await new DeleteOldReadingsUseCase(store, 365, () => NOW).execute()).toEqual({ deleted: 3 });
    expect(await mine()).toBe(3); expect(await total()).toBe(before - 3);
  });

  it('NEVER deletes the latest reading of a device, even if it is older than the period', async () => {
    const d = devices[1];
    await prisma.iotReading.deleteMany({ where: { deviceId: d.id } }); // un dispositivo sin lecturas propias para esta prueba
    await add(d.id, d.unit, 900); await add(d.id, d.unit, 800); await add(d.id, d.unit, 700);
    expect((await new DeleteOldReadingsUseCase(store, 365, () => NOW).execute()).deleted).toBe(2);
    const left = await prisma.iotReading.findMany({ where: { deviceId: d.id } });
    expect(left).toHaveLength(1); expect(Math.round((NOW.getTime() - left[0].recordedAt.getTime()) / DAY)).toBe(700); // la más nueva de las tres
    // Repetir no borra nada más.
    expect((await new DeleteOldReadingsUseCase(store, 365, () => NOW).execute()).deleted).toBe(0);
    await loadSeedBack();
  });

  it('is safe to run twice at the same time (no error, nothing deleted twice, the recent ones stay)', async () => {
    const d = devices[2];
    for (let i = 0; i < 40; i++) await add(d.id, d.unit, 400 + i);
    await add(d.id, d.unit, 5);
    const res = await Promise.all([1, 2, 3].map(() => new DeleteOldReadingsUseCase(store, 365, () => NOW).execute()));
    expect(res.reduce((s, r) => s + r.deleted, 0)).toBe(40);
    expect(await mine()).toBe(1);
  });

  it('retention off (0) deletes nothing', async () => {
    const d = devices[3];
    await add(d.id, d.unit, 800); await add(d.id, d.unit, 1);
    expect((await new DeleteOldReadingsUseCase(store, 0, () => NOW).execute()).deleted).toBe(0);
    expect(await mine()).toBe(2);
  });

  it('the seed readings of September 2026 are not touched by a 365-day period', async () => {
    const before = await total();
    expect((await new DeleteOldReadingsUseCase(store, 365, () => new Date('2027-06-01T00:00:00Z')).execute()).deleted).toBe(0);
    expect(await total()).toBe(before);
  });

  async function loadSeedBack() { const { loadIot } = require('../prisma/iot-load'); await loadIot(prisma); }
});
