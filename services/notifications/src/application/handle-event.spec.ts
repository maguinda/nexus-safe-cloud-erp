import { randomUUID } from 'crypto';
import { InvalidEventError } from '../domain/errors';
import { NotificationDraft } from '../domain/events';
import { EventScope, EventUnitOfWork } from '../domain/ports';
import { HandleEventUseCase } from './handle-event.use-case';

class FakeUow implements EventUnitOfWork {
  seen = new Set<string>(); saved: NotificationDraft[] = []; failOnSave = false;
  async run<T>(work: (tx: EventScope) => Promise<T>): Promise<T> {
    const seenBefore = new Set(this.seen), savedBefore = [...this.saved]; // una transacción de mentira: si falla, no queda nada
    try {
      return await work({
        markEventProcessed: async (id) => { if (this.seen.has(id)) return false; this.seen.add(id); return true; },
        addNotification: async (d) => { if (this.failOnSave) throw new Error('db down'); this.saved.push(d); },
      });
    } catch (e) { this.seen = seenBefore; this.saved = savedBefore; throw e; }
  }
}
const event = (over: any = {}) => ({ eventId: randomUUID(), type: 'ThresholdBreached', occurredAt: '2026-11-20T00:00:00.000Z', correlationId: 'trace-0001-abcd',
  data: { deviceName: 'Cold room sensor', location: 'Bogotá', readingKind: 'temperature', status: 'ALERT', value: 31.5, unit: '°C' }, ...over });

describe('HandleEventUseCase', () => {
  it('saves one notification for a new event', async () => {
    const uow = new FakeUow(); const e = event();
    expect(await new HandleEventUseCase(uow).execute(e)).toBe('applied');
    expect(uow.saved).toHaveLength(1); expect(uow.saved[0]).toMatchObject({ eventId: e.eventId, kind: 'ThresholdBreached' });
  });
  it('a repeated delivery changes nothing', async () => {
    const uow = new FakeUow(); const uc = new HandleEventUseCase(uow); const e = event();
    await uc.execute(e);
    expect(await uc.execute(e)).toBe('duplicate'); expect(uow.saved).toHaveLength(1);
  });
  it('an invalid event is refused before touching anything', async () => {
    const uow = new FakeUow();
    await expect(new HandleEventUseCase(uow).execute(event({ type: 'Nope' }))).rejects.toBeInstanceOf(InvalidEventError);
    expect(uow.seen.size).toBe(0);
  });
  it('if saving fails the event is NOT marked as processed, so the retry can still work', async () => {
    const uow = new FakeUow(); const uc = new HandleEventUseCase(uow); const e = event();
    uow.failOnSave = true; await expect(uc.execute(e)).rejects.toThrow('db down');
    expect(uow.seen.size).toBe(0);
    uow.failOnSave = false; expect(await uc.execute(e)).toBe('applied'); expect(uow.saved).toHaveLength(1);
  });
});
