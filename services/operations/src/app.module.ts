import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { ExploreNetworkUseCase, ExploreReadingsUseCase, GetTrendsUseCase } from './application/explore.use-cases';
import { GetAdviceUseCase } from './application/get-advice.use-case';
import { GetNetworkUseCase } from './application/get-network.use-case';
import { GetTelemetryUseCase } from './application/get-telemetry.use-case';
import { IngestReadingsUseCase } from './application/ingest-readings.use-case';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { INGEST_KEY, ServiceKeyGuard } from './auth/service-key.guard';
import { loadConfig } from './config';
import { AdvisorController, GET_ADVICE } from './http/advisor.controller';
import { HealthController } from './http/health.controller';
import { EXPLORE_NETWORK, GET_NETWORK, NetworkController } from './http/network.controller';
import { EXPLORE_READINGS, GET_TELEMETRY, GET_TRENDS, INGEST_READINGS, TelemetryController } from './http/telemetry.controller';
import { DeleteOldReadingsUseCase } from './application/delete-old-readings.use-case';
import { PrismaReadingRetention } from './infrastructure/prisma-reading-retention';
import { RetentionScheduler } from './infrastructure/retention-scheduler';
import { retentionCutoff } from './domain/retention';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { AnthropicAdviceWriter } from './infrastructure/anthropic-advice-writer';
import { PrismaNetworkExplorer } from './infrastructure/prisma-network-explorer';
import { PrismaNetworkQueries } from './infrastructure/prisma-network-queries';
import { PrismaReadingIngest } from './infrastructure/prisma-reading-ingest';
import { PrismaTelemetryExplorer } from './infrastructure/prisma-telemetry-explorer';
import { PrismaTelemetryQueries } from './infrastructure/prisma-telemetry-queries';
import { PrismaTrendsQueries } from './infrastructure/prisma-trends-queries';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let relay: OutboxRelay | undefined;
let retention: RetentionScheduler | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [TelemetryController, NetworkController, AdvisorController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
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
    if (c.relayEnabled) {
      relay = new OutboxRelay(prisma, { url: c.rabbitUrl, pollMs: c.outboxPollMs });
      relay.start();
    }
    // Falla al arrancar si el plazo es peligroso (menos de 30 días): mejor que borrar de más.
    retentionCutoff(new Date(), c.retentionDays);
    if (c.retentionDays > 0 && process.env.RETENTION_ENABLED !== 'false') {
      retention = new RetentionScheduler(new DeleteOldReadingsUseCase(new PrismaReadingRetention(prisma), c.retentionDays), c.retentionCheckMs);
      retention.start();
    }
  }

  async onModuleDestroy() {
    await relay?.stop();
    relay = undefined;
    await retention?.stop();
    retention = undefined;
    await prisma.$disconnect();
  }
}
