import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { GetDashboardUseCase } from './application/get-dashboard.use-case';
import { GetProfitabilityUseCase } from './application/get-profitability.use-case';
import { ProfitabilityController, GET_PROFITABILITY } from './http/profitability.controller';
import { AuditController, AUDIT_PRISMA } from './http/audit.controller';
import { auditEventHandler } from './infrastructure/prisma-audit';
import { allocationEventHandler } from './infrastructure/prisma-allocation-store';
import { HandleEventUseCase } from './application/handle-event.use-case';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { DashboardController, GET_DASHBOARD } from './http/dashboard.controller';
import { HealthController } from './http/health.controller';
import { AUDIT_OPTIONS, EventConsumer } from './infrastructure/event-consumer';
import { PrismaDashboardQueries } from './infrastructure/prisma-dashboard-queries';
import { PrismaEventUnitOfWork } from './infrastructure/prisma-event-uow';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let consumer: EventConsumer | undefined;
let auditConsumer: EventConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [DashboardController, ProfitabilityController, AuditController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: AUDIT_PRISMA, useValue: prisma },
    { provide: GET_PROFITABILITY, useFactory: () => new GetProfitabilityUseCase(new PrismaDashboardQueries(prisma), prisma) },
    { provide: GET_DASHBOARD, useFactory: () => new GetDashboardUseCase(new PrismaDashboardQueries(prisma)) },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = cfg();
    if (c.consumerEnabled) {
      consumer = new EventConsumer(new HandleEventUseCase(new PrismaEventUnitOfWork(prisma), allocationEventHandler(prisma)), c.rabbitUrl);
      consumer.start();
      const audit = auditEventHandler(prisma);
      auditConsumer = new EventConsumer({ execute: (raw) => audit(raw) }, c.rabbitUrl, AUDIT_OPTIONS);
      auditConsumer.start();
    }
  }

  async onModuleDestroy() {
    await consumer?.stop();
    consumer = undefined;
    await auditConsumer?.stop();
    auditConsumer = undefined;
    await prisma.$disconnect();
  }
}
