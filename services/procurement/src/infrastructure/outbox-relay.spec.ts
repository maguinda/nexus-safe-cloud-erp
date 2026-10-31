import { OutboxRelay } from './outbox-relay';

type Row = { id: string; routing_key: string; payload: unknown };

/** Prisma falso: una «tabla» en memoria con la misma forma que usa el relé. */
function fakePrisma(rows: Row[]) {
  const published = new Set<string>();
  const tx = {
    $queryRaw: async () => rows.filter((r) => !published.has(r.id)),
    outboxEvent: { update: async ({ where }: { where: { id: string } }) => { published.add(where.id); } },
  };
  return { published, prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as any };
}

/** Canal falso: si la clave no tiene cola, imita a RabbitMQ (basic.return antes de la confirmación). */
function fakeChannel(routable: (key: string) => boolean) {
  const handlers: Record<string, (m: any) => void> = {};
  const calls: { key: string; mandatory: boolean }[] = [];
  return {
    calls,
    ch: {
      on: (ev: string, h: (m: any) => void) => { handlers[ev] = h; },
      publish: (_ex: string, key: string, _b: Buffer, opts: any, cb: (e?: Error) => void) => {
        calls.push({ key, mandatory: opts.mandatory });
        if (opts.mandatory && !routable(key)) handlers['return']?.({ properties: { messageId: opts.messageId } });
        cb();
      },
    } as any,
    handlers,
  };
}

function relayWith(rows: Row[], mandatory: boolean, routable: (k: string) => boolean) {
  const { prisma, published } = fakePrisma(rows);
  const relay: any = new OutboxRelay(prisma, { url: 'amqp://x', pollMs: 10, mandatory });
  const f = fakeChannel(routable);
  relay.ch = f.ch;
  f.ch.on('return', (m: any) => relay.returned.add(m.properties.messageId));
  return { relay, published, f };
}
const ROWS: Row[] = [{ id: 'a', routing_key: 'ops.x', payload: { type: 'T' } }, { id: 'b', routing_key: 'ops.y', payload: { type: 'T' } }];

describe('OutboxRelay mandatory publishing', () => {
  it('with mandatory ON, an event that no queue receives stays pending (not marked published) and the error says why', async () => {
    const { relay, published } = relayWith(ROWS, true, () => false);
    await expect(relay.flush()).rejects.toThrow(/no queue received ops\.x/);
    expect(published.size).toBe(0);
  });

  it('with mandatory ON, one unroutable event makes the whole batch fail (in the real database the transaction rolls back and every event of the batch stays pending)', async () => {
    const { relay, published, f } = relayWith(ROWS, true, (k) => k === 'ops.x');
    await expect(relay.flush()).rejects.toThrow(/ops\.y/);
    expect(published.has('a')).toBe(true);
    expect(f.calls.every((c) => c.mandatory === true)).toBe(true);
  });

  it('with mandatory ON and every key routable, everything is published', async () => {
    const { relay, published } = relayWith(ROWS, true, () => true);
    expect(await relay.flush()).toBe(2);
    expect(published.size).toBe(2);
  });

  it('with mandatory OFF (default), nothing is requested and an unroutable event is marked published as before', async () => {
    const { relay, published, f } = relayWith(ROWS, false, () => false);
    expect(await relay.flush()).toBe(2);
    expect(published.size).toBe(2);
    expect(f.calls.every((c) => c.mandatory === false)).toBe(true);
  });
});
