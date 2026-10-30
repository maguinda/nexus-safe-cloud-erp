import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { AllocateEngineerUseCase, CreateEngineerUseCase, DeleteAllocationUseCase, ListCapacityUseCase, SetSalaryUseCase } from './application/capacity.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { ALLOCATE, CapacityController, CREATE_ENGINEER, DELETE_ALLOCATION, LIST_CAPACITY, SET_SALARY } from './http/capacity.controller';
import { HealthController } from './http/health.controller';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { PrismaCapacity } from './infrastructure/prisma-capacity';
import { PrismaUnitOfWork } from './infrastructure/prisma-unit-of-work';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let relay: OutboxRelay | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [CapacityController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: LIST_CAPACITY, useFactory: () => new ListCapacityUseCase(new PrismaCapacity(prisma)) },
    { provide: SET_SALARY, useFactory: () => new SetSalaryUseCase(new PrismaCapacity(prisma)) },
    { provide: CREATE_ENGINEER, useFactory: () => new CreateEngineerUseCase(new PrismaCapacity(prisma)) },
    { provide: ALLOCATE, useFactory: () => new AllocateEngineerUseCase(new PrismaUnitOfWork(prisma)) },
    { provide: DELETE_ALLOCATION, useFactory: () => new DeleteAllocationUseCase(new PrismaUnitOfWork(prisma)) },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = cfg();
    if (c.relayEnabled) {
      relay = new OutboxRelay(prisma, { url: c.rabbitUrl, pollMs: c.outboxPollMs });
      relay.start();
    }
  }

  async onModuleDestroy() {
    await relay?.stop();
    relay = undefined;
    await prisma.$disconnect();
  }
}
