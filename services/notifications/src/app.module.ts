import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { HandleEventUseCase } from './application/handle-event.use-case';
import { InboxUseCases } from './application/inbox.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { HealthController } from './http/health.controller';
import { INBOX, NotificationsController } from './http/notifications.controller';
import { EventConsumer } from './infrastructure/event-consumer';
import { PrismaEventUnitOfWork } from './infrastructure/prisma-event-uow';
import { PrismaInboxQueries } from './infrastructure/prisma-inbox-queries';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let consumer: EventConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [NotificationsController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: INBOX, useFactory: () => new InboxUseCases(new PrismaInboxQueries(prisma)) },
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
