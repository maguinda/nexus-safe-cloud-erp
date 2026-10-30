import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { AllocateEngineerUseCase, CreateEngineerUseCase, DeleteAllocationUseCase, ListCapacityUseCase, SetSalaryUseCase } from './application/capacity.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { RatesController, RATES_PRISMA } from './http/rates.controller';
import { MaintenanceController, MAINTENANCE } from './http/maintenance.controller';
import { MaintenanceService } from './infrastructure/prisma-maintenance';
import { WorkOrderClosedConsumer } from './infrastructure/work-order-closed-consumer';
import { parseWorkOrderClosed } from './domain/work-order-closed';
import { ALLOCATE, CapacityController, CREATE_ENGINEER, DELETE_ALLOCATION, LIST_CAPACITY, SET_SALARY } from './http/capacity.controller';
import { HealthController } from './http/health.controller';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { PrismaCapacity } from './infrastructure/prisma-capacity';
import { PrismaUnitOfWork } from './infrastructure/prisma-unit-of-work';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let relay: OutboxRelay | undefined;
let consumer: WorkOrderClosedConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [CapacityController, RatesController, MaintenanceController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: LIST_CAPACITY, useFactory: () => new ListCapacityUseCase(new PrismaCapacity(prisma)) },
    { provide: RATES_PRISMA, useValue: prisma },
    { provide: MAINTENANCE, useFactory: () => new MaintenanceService(prisma) },
    { provide: SET_SALARY, useFactory: () => new SetSalaryUseCase(new PrismaCapacity(prisma)) },
    { provide: CREATE_ENGINEER, useFactory: () => new CreateEngineerUseCase(new PrismaCapacity(prisma)) },
    { provide: ALLOCATE, useFactory: () => new AllocateEngineerUseCase(new PrismaUnitOfWork(prisma)) },
    { provide: DELETE_ALLOCATION, useFactory: () => new DeleteAllocationUseCase(new PrismaUnitOfWork(prisma)) },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = cfg();
    if (c.consumerEnabled) {
      const maintenance = new MaintenanceService(prisma);
      consumer = new WorkOrderClosedConsumer(async (body) => { const e = parseWorkOrderClosed(body); if (!e.orderId) return 'nothing-to-release'; return (await maintenance.release(e.orderId)) > 0 ? 'released' : 'already-released'; }, c.rabbitUrl);
      consumer.start();
    }
    if (c.relayEnabled) {
      relay = new OutboxRelay(prisma, { url: c.rabbitUrl, pollMs: c.outboxPollMs });
      relay.start();
    }
  }

  async onModuleDestroy() {
    await consumer?.stop();
    consumer = undefined;
    await relay?.stop();
    relay = undefined;
    await prisma.$disconnect();
  }
}
