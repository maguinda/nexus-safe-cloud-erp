import { Logger } from '@nestjs/common';
import { ChannelModel, Channel, ConsumeMessage, connect } from 'amqplib';
import { HandleMilestoneApprovedUseCase } from '../application/handle-milestone-approved.use-case';
import { HandleQuoteApprovedUseCase } from '../application/handle-quote-approved.use-case';
import { InvalidEventError } from '../domain/errors';

export const EXCHANGE = 'erp.events';
export const DLX = 'erp.events.dlx';
export const QUEUE = 'q.billing';
export const DLQ = 'q.billing.dlq';
export const ROUTING_KEY = 'project.milestone.approved';
export const QUOTE_ROUTING_KEY = 'project.quote.approved';
const MAX_BYTES = 16 * 1024;

/**
 * Consume MilestoneApproved. Ack solo cuando la factura quedó guardada (o era un duplicado).
 * Mensaje inválido -> cola de mensajes muertos (no se reintenta, no bloquea a los demás).
 * Fallo pasajero (p. ej. la base cae) -> se reintenta una vez; si vuelve a fallar, también va a la cola de mensajes muertos.
 */
export class MilestoneApprovedConsumer {
  private readonly log = new Logger('BillingConsumer');
  private conn?: ChannelModel;
  private ch?: Channel;
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private retryMs = 500;

  constructor(private readonly useCase: HandleMilestoneApprovedUseCase, private readonly url: string, private readonly quoteUseCase?: HandleQuoteApprovedUseCase) {}

  start() {
    this.stopped = false;
    void this.connectLoop();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const { ch, conn } = this;
    this.ch = undefined; this.conn = undefined;
    try { await ch?.close(); } catch { /* ya cerrado */ }
    try { await conn?.close(); } catch { /* ya cerrado */ }
  }

  private async connectLoop() {
    if (this.stopped) return;
    try {
      const conn = await connect(this.url);
      conn.on('error', () => { /* el evento 'close' dispara la reconexión */ });
      conn.on('close', () => { this.conn = undefined; this.ch = undefined; if (!this.stopped) this.scheduleReconnect(); });
      const ch = await conn.createChannel();
      await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
      await ch.assertExchange(DLX, 'direct', { durable: true });
      await ch.assertQueue(DLQ, { durable: true });
      await ch.bindQueue(DLQ, DLX, QUEUE);
      await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': DLX, 'x-dead-letter-routing-key': QUEUE } });
      await ch.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
      if (this.quoteUseCase) await ch.bindQueue(QUEUE, EXCHANGE, QUOTE_ROUTING_KEY);
      await ch.prefetch(10);
      // Se pasa el canal al manejador: RabbitMQ entrega el backlog en cuanto se registra el consumo, ANTES de que this.ch esté asignado.
      await ch.consume(QUEUE, (m) => void this.onMessage(m, ch));
      this.conn = conn; this.ch = ch; this.retryMs = 500;
      this.log.log(`consuming ${QUEUE}`);
    } catch (e) {
      this.log.warn(`cannot connect to RabbitMQ, retrying: ${e instanceof Error ? e.message : e}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.connectLoop(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 5000);
  }

  private async onMessage(msg: ConsumeMessage | null, ch: Channel) {
    if (!msg) return;
    try {
      if (msg.content.length > MAX_BYTES) throw new InvalidEventError('message too large');
      let body: unknown;
      try { body = JSON.parse(msg.content.toString('utf8')); } catch { throw new InvalidEventError('not valid JSON'); }
      // La misma cola recibe dos tipos de evento: el tipo decide quién lo procesa (un tipo desconocido es un mensaje inválido).
      const type = typeof body === 'object' && body !== null ? (body as { type?: unknown }).type : undefined;
      const result = type === 'QuoteApproved' && this.quoteUseCase ? await this.quoteUseCase.execute(body) : await this.useCase.execute(body);
      this.log.log(`${msg.properties.messageId ?? '?'} -> ${result}`);
      ch.ack(msg);
    } catch (e) {
      const poison = e instanceof InvalidEventError;
      const giveUp = poison || msg.fields.redelivered;
      this.log.warn(`${poison ? 'invalid message' : 'processing failed'}${giveUp ? ' -> dead-letter' : ' -> retry once'}: ${e instanceof Error ? e.message : e}`);
      try { ch.nack(msg, false, !giveUp); } catch { /* el canal se cerró */ }
    }
  }
}
