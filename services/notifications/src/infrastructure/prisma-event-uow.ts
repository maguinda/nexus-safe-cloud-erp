import { Prisma, PrismaClient } from '@prisma/client';
import { NotificationDraft } from '../domain/events';
import { EventScope, EventUnitOfWork } from '../domain/ports';

const TX = { timeout: 10_000, maxWait: 10_000 };

export class PrismaEventUnitOfWork implements EventUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}
  run<T>(work: (tx: EventScope) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (c) => work(new PrismaEventScope(c)), TX);
  }
}

class PrismaEventScope implements EventScope {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async markEventProcessed(eventId: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING: si dos copias del mismo evento llegan a la vez, solo una inserta (la otra espera y ve que ya existe).
    const n = await this.tx.$executeRaw`INSERT INTO processed_events (event_id) VALUES (${eventId}::uuid) ON CONFLICT (event_id) DO NOTHING`;
    return n === 1;
  }

  async addNotification(d: NotificationDraft): Promise<void> {
    await this.tx.notification.create({ data: {
      eventId: d.eventId, kind: d.kind, severity: d.severity, audienceRoles: d.audienceRoles, params: d.params, correlationId: d.correlationId, occurredAt: d.occurredAt } });
  }
}
