import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';

export const EXCHANGE = 'erp.events';

export interface RelayOptions { url: string; pollMs: number }

/**
 * Publica a RabbitMQ lo que quedó en outbox_events. Entrega "al menos una vez": si el proceso cae después de
 * publicar y antes de marcar, el evento se repite; por eso los consumidores son idempotentes.
 * FOR UPDATE SKIP LOCKED permite varias réplicas del relay sin que se pisen.
 */
export class OutboxRelay {
  private readonly log = new Logger('OutboxRelay');
  private conn?: ChannelModel;
  private ch?: ConfirmChannel;
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private busy = false;

  constructor(private readonly prisma: PrismaClient, private readonly opts: RelayOptions) {}

  start() {
    this.stopped = false;
    this.schedule(0);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
    await this.close();
  }

  private schedule(ms: number) {
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    let next = this.opts.pollMs;
    try {
      await this.ensureChannel();
      const published = await this.flush();
      if (published > 0) next = 0;
    } catch (e) {
      this.log.warn(`relay error, retrying: ${e instanceof Error ? e.message : e}`);
      await this.close();
      next = Math.min(5000, this.opts.pollMs * 4);
    } finally {
      this.busy = false;
      this.schedule(next);
    }
  }

  private async ensureChannel() {
    if (this.ch) return;
    const conn = await connect(this.opts.url);
    conn.on('error', () => void this.close());
    conn.on('close', () => { this.conn = undefined; this.ch = undefined; });
    const ch = await conn.createConfirmChannel();
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    this.conn = conn;
    this.ch = ch;
  }

  private async close() {
    const { ch, conn } = this;
    this.ch = undefined;
    this.conn = undefined;
    try { await ch?.close(); } catch { /* ya cerrado */ }
    try { await conn?.close(); } catch { /* ya cerrado */ }
  }

  /** Publica y marca hasta 20 eventos. Si algo falla, la transacción se revierte y quedan pendientes. */
  private flush(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; routing_key: string; payload: Prisma.JsonValue }[]>`
          SELECT id, routing_key, payload FROM outbox_events
          WHERE published_at IS NULL ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED`;
        for (const r of rows) {
          await this.publish(r.id, r.routing_key, r.payload);
          await tx.outboxEvent.update({ where: { id: r.id }, data: { publishedAt: new Date() } });
        }
        return rows.length;
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
  }

  private publish(id: string, routingKey: string, payload: Prisma.JsonValue): Promise<void> {
    const body: any = payload;
    return new Promise((resolve, reject) => {
      this.ch!.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
        persistent: true,
        contentType: 'application/json',
        messageId: id,
        type: body?.type,
        headers: { 'x-correlation-id': body?.correlationId },
      }, (err) => (err ? reject(err) : resolve()));
    });
  }
}
