import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { GetAdviceUseCase } from './application/get-advice.use-case';
import { GetDashboardUseCase } from './application/get-dashboard.use-case';
import { ExploreNetworkUseCase, ExploreReadingsUseCase, GetTrendsUseCase } from './application/explore.use-cases';
import { GetNetworkUseCase } from './application/get-network.use-case';
import { GetTelemetryUseCase } from './application/get-telemetry.use-case';
import { HandleEventUseCase } from './application/handle-event.use-case';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { AdvisorController, GET_ADVICE } from './http/advisor.controller';
import { DashboardController, GET_DASHBOARD } from './http/dashboard.controller';
import { HealthController } from './http/health.controller';
import { EXPLORE_NETWORK, GET_NETWORK, NetworkController } from './http/network.controller';
import { EXPLORE_READINGS, GET_TELEMETRY, GET_TRENDS, INGEST_READINGS, TelemetryController } from './http/telemetry.controller';
import { IngestReadingsUseCase } from './application/ingest-readings.use-case';
import { INGEST_KEY, ServiceKeyGuard } from './auth/service-key.guard';
import { PrismaReadingIngest } from './infrastructure/prisma-reading-ingest';
import { AnthropicAdviceWriter } from './infrastructure/anthropic-advice-writer';
import { EventConsumer } from './infrastructure/event-consumer';
import { PrismaDashboardQueries } from './infrastructure/prisma-dashboard-queries';
import { PrismaEventUnitOfWork } from './infrastructure/prisma-event-uow';
import { PrismaNetworkExplorer } from './infrastructure/prisma-network-explorer';
import { PrismaNetworkQueries } from './infrastructure/prisma-network-queries';
import { PrismaTelemetryExplorer } from './infrastructure/prisma-telemetry-explorer';
import { PrismaTrendsQueries } from './infrastructure/prisma-trends-queries';
import { PrismaTelemetryQueries } from './infrastructure/prisma-telemetry-queries';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let consumer: EventConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [DashboardController, TelemetryController, NetworkController, AdvisorController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: GET_DASHBOARD, useFactory: () => new GetDashboardUseCase(new PrismaDashboardQueries(prisma)) },
    { provide: GET_TELEMETRY, useFactory: () => new GetTelemetryUseCase(new PrismaTelemetryQueries(prisma)) },
    { provide: GET_NETWORK, useFactory: () => new GetNetworkUseCase(new PrismaNetworkQueries(prisma)) },
    { provide: GET_TRENDS, useFactory: () => new GetTrendsUseCase(new PrismaTrendsQueries(prisma)) },
    {
      provide: GET_ADVICE,
      // La llave es opcional: sin ella el asesor responde con reglas y el botón de IA avisa que no está disponible. Nunca se escribe en un log ni en una respuesta.
      useFactory: () => {
        const key = process.env.ANTHROPIC_API_KEY;
        const writer = key ? new AnthropicAdviceWriter(key, process.env.ADVISOR_MODEL ?? 'claude-sonnet-5-5', process.env.ANTHROPIC_BASE_URL) : null;
        return new GetAdviceUseCase(new GetTrendsUseCase(new PrismaTrendsQueries(prisma)), new GetNetworkUseCase(new PrismaNetworkQueries(prisma)), writer, undefined, undefined, process.env.ADVISOR_AI_PER_MINUTE ? Number(process.env.ADVISOR_AI_PER_MINUTE) : undefined);
      },
    },
    // La clave de servicio de los emisores de telemetría. Sin ella (o con menos de 32 caracteres) la ingesta responde 503; nunca se escribe en un log.
    { provide: INGEST_KEY, useFactory: () => process.env.INGEST_KEY ?? '' },
    ServiceKeyGuard,
    { provide: INGEST_READINGS, useFactory: () => new IngestReadingsUseCase(new PrismaReadingIngest(prisma)) },
    { provide: EXPLORE_READINGS, useFactory: () => new ExploreReadingsUseCase(new PrismaTelemetryExplorer(prisma)) },
    { provide: EXPLORE_NETWORK, useFactory: () => new ExploreNetworkUseCase(new PrismaNetworkExplorer(prisma)) },
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
