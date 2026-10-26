import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { GetDashboardUseCase } from './application/get-dashboard.use-case';
import { GetNetworkUseCase } from './application/get-network.use-case';
import { GetTelemetryUseCase } from './application/get-telemetry.use-case';
import { HandleEventUseCase } from './application/handle-event.use-case';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { DashboardController, GET_DASHBOARD } from './http/dashboard.controller';
import { HealthController } from './http/health.controller';
import { GET_NETWORK, NetworkController } from './http/network.controller';
import { GET_TELEMETRY, TelemetryController } from './http/telemetry.controller';
import { EventConsumer } from './infrastructure/event-consumer';
import { PrismaDashboardQueries } from './infrastructure/prisma-dashboard-queries';
import { PrismaEventUnitOfWork } from './infrastructure/prisma-event-uow';
import { PrismaNetworkQueries } from './infrastructure/prisma-network-queries';
import { PrismaTelemetryQueries } from './infrastructure/prisma-telemetry-queries';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let consumer: EventConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [DashboardController, TelemetryController, NetworkController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: GET_DASHBOARD, useFactory: () => new GetDashboardUseCase(new PrismaDashboardQueries(prisma)) },
    { provide: GET_TELEMETRY, useFactory: () => new GetTelemetryUseCase(new PrismaTelemetryQueries(prisma)) },
    { provide: GET_NETWORK, useFactory: () => new GetNetworkUseCase(new PrismaNetworkQueries(prisma)) },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = cfg();
    if (c.consumerEnabled) {
      consumer = new EventConsumer(new HandleEventUseCase(new PrismaEventUnitOfWork(prisma)), c.rabbitUrl);
      consumer.start();
    }
  }

  async onModuleDestroy() {
    await consumer?.stop();
    consumer = undefined;
    await prisma.$disconnect();
  }
}
