import { Logger } from '@nestjs/common';
import { Channel, ChannelModel, ConsumeMessage, connect } from 'amqplib';
import { InvalidEventError } from '../domain/errors';
import { EQUIPMENT_INSTALLED_ROUTING_KEY, EQUIPMENT_PURCHASED_ROUTING_KEY, EQUIPMENT_RETIRED_ROUTING_KEY } from '../domain/purchased';

export const EXCHANGE = 'erp.events';
export const DLX = 'erp.events.dlx';
const BACKOFF_MS = process.env.NODE_ENV === 'test' ? [50, 100, 200] : [500, 1000, 2000, 4000, 8000];
export const QUEUE = 'q.operations.purchases';
export const DLQ = 'q.operations.purchases.dlq';
const MAX_BYTES = 16 * 1024;

/**
 * Consume EquipmentPurchased con una cola propia (q.operations.purchases).
 * Ack solo cuando los equipos quedaron en el inventario (o era un duplicado).
 * Mensaje inválido -> cola de mensajes muertos (no se reintenta, no bloquea a los demás).
 * Fallo pasajero (p. ej. la base cae unos segundos) -> se reintenta con espera creciente (0,5 s a 8 s, unos 15 s en total) CON el mensaje sin confirmar; solo si sigue
 * fallando va a la cola de mensajes muertos. Así una caída corta no vacía la cola hacia los mensajes muertos.
 * Si el canal falla o RabbitMQ cancela el consumo, se reconecta (antes quedaba mudo con el healthcheck en verde).
 */
export class PurchasesConsumer {
  private readonly log = new Logger('OperationsPurchasesConsumer');
  private conn?: ChannelModel;
  private ch?: Channel;
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private retryMs = 500;

  constructor(private readonly handle: (body: unknown) => Promise<string>, private readonly url: string) {}

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
      await ch.bindQueue(QUEUE, EXCHANGE, EQUIPMENT_INSTALLED_ROUTING_KEY);
      await ch.bindQueue(QUEUE, EXCHANGE, EQUIPMENT_RETIRED_ROUTING_KEY);
      // Antes esta cola escuchaba la compra recibida: se desvincula (idempotente) para que recibir un pedido no cree equipos.
      await ch.unbindQueue(QUEUE, EXCHANGE, EQUIPMENT_PURCHASED_ROUTING_KEY);
      await ch.prefetch(10);
      // Se pasa el canal al manejador: RabbitMQ entrega el backlog en cuanto se registra el consumo, ANTES de que this.ch esté asignado.
      // Un error del canal (p. ej. un ack repetido) o la cancelación del consumo cierran todo y se reconecta: sin esto el servicio quedaba sin consumir y sin avisar.
      ch.on('error', () => { /* el evento 'close' hace el resto */ });
      ch.on('close', () => { if (this.ch === ch) { this.ch = undefined; void this.dropConnection(); } });
      await ch.consume(QUEUE, (m) => { if (m === null) { void this.dropConnection(); return; } void this.onMessage(m, ch); });
      this.conn = conn; this.ch = ch; this.retryMs = 500;
      this.log.log(`consuming ${QUEUE}`);
    } catch (e) {
      this.log.warn(`cannot connect to RabbitMQ, retrying: ${e instanceof Error ? e.message : e}`);
      this.scheduleReconnect();
    }
  }

  /** Cierra la conexión actual; su evento 'close' programa la reconexión. */
  private async dropConnection() {
    const conn = this.conn;
    this.conn = undefined; this.ch = undefined;
    try { await conn?.close(); } catch { /* ya cerrada */ }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.connectLoop(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 5000);
  }

  private async onMessage(msg: ConsumeMessage, ch: Channel) {
    try {
      if (msg.content.length > MAX_BYTES) throw new InvalidEventError('message too large');
      let body: unknown;
      try { body = JSON.parse(msg.content.toString('utf8')); } catch { throw new InvalidEventError('not valid JSON'); }
      let result: string | undefined;
      for (let attempt = 0; ; attempt++) {
        try { result = await this.handle(body); break; } catch (e) {
          if (e instanceof InvalidEventError || attempt >= BACKOFF_MS.length || this.stopped) throw e;
          this.log.warn(`processing failed, retrying in ${BACKOFF_MS[attempt]} ms: ${e instanceof Error ? e.message : e}`);
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        }
      }
      this.log.log(`${msg.properties.messageId ?? '?'} -> ${result}`);
      ch.ack(msg);
    } catch (e) {
      const poison = e instanceof InvalidEventError;
      this.log.warn(`${poison ? 'invalid message' : 'gave up after retries'} -> dead-letter: ${e instanceof Error ? e.message : e}`);
      try { ch.nack(msg, false, this.stopped && !poison); } catch { /* el canal se cerró */ }
    }
  }
}
