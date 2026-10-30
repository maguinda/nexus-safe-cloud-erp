import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { HandleEventUseCase } from './application/handle-event.use-case';
import { AdjustStockUseCase, CancelOrderUseCase, CreateItemUseCase, CreateOrderUseCase, CreateSupplierUseCase, ListMovementsUseCase, ListProcurementUseCase, ReceiveOrderUseCase } from './application/procurement.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { HealthController } from './http/health.controller';
import { CountsService } from './infrastructure/prisma-counts';
import { COUNTS, ADJUST, CANCEL_ORDER, CREATE_ITEM, CREATE_ORDER, CREATE_SUPPLIER, LIST, LIST_MOVEMENTS, ProcurementController, RECEIVE_ORDER } from './http/procurement.controller';
import { EventConsumer } from './infrastructure/event-consumer';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { PrismaEventUnitOfWork, PrismaProcurement, PrismaUnitOfWork } from './infrastructure/prisma-procurement';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let relay: OutboxRelay | undefined;
let consumer: EventConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [ProcurementController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: LIST, useFactory: () => new ListProcurementUseCase(new PrismaProcurement(prisma)) },
    { provide: CREATE_SUPPLIER, useFactory: () => new CreateSupplierUseCase(new PrismaProcurement(prisma)) },
    { provide: CREATE_ITEM, useFactory: () => new CreateItemUseCase(new PrismaProcurement(prisma)) },
    { provide: CREATE_ORDER, useFactory: () => new CreateOrderUseCase(new PrismaUnitOfWork(prisma)) },
    { provide: RECEIVE_ORDER, useFactory: () => new ReceiveOrderUseCase(new PrismaUnitOfWork(prisma)) },
    { provide: CANCEL_ORDER, useFactory: () => new CancelOrderUseCase(new PrismaUnitOfWork(prisma)) },
    { provide: COUNTS, useFactory: () => new CountsService(prisma) },
    { provide: LIST_MOVEMENTS, useFactory: () => new ListMovementsUseCase(new PrismaProcurement(prisma)) },
    { provide: ADJUST, useFactory: () => new AdjustStockUseCase(new PrismaUnitOfWork(prisma)) },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = cfg();
    if (c.relayEnabled) { relay = new OutboxRelay(prisma, { url: c.rabbitUrl, pollMs: c.outboxPollMs }); relay.start(); }
    if (c.consumerEnabled) { consumer = new EventConsumer(new HandleEventUseCase(new PrismaEventUnitOfWork(prisma)), c.rabbitUrl); consumer.start(); }
  }

  async onModuleDestroy() {
    await relay?.stop(); relay = undefined;
    await consumer?.stop(); consumer = undefined;
    await prisma.$disconnect();
  }
}
