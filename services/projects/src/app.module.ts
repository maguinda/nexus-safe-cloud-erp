import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { ApproveMilestoneUseCase } from './application/approve-milestone.use-case';
import { CreateMilestoneUseCase, CreateProjectUseCase } from './application/create.use-cases';
import { ListMilestonesUseCase, ListProjectsUseCase } from './application/queries.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { HealthController } from './http/health.controller';
import { APPROVE_MILESTONE, CREATE_MILESTONE, CREATE_PROJECT, LIST_MILESTONES, LIST_PROJECTS, ProjectsController } from './http/projects.controller';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { PrismaProjectCommands } from './infrastructure/prisma-project-commands';
import { PrismaProjectQueries } from './infrastructure/prisma-project-queries';
import { PrismaUnitOfWork } from './infrastructure/prisma-unit-of-work';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let relay: OutboxRelay | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [ProjectsController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: LIST_PROJECTS, useFactory: () => new ListProjectsUseCase(new PrismaProjectQueries(prisma)) },
    { provide: LIST_MILESTONES, useFactory: () => new ListMilestonesUseCase(new PrismaProjectQueries(prisma)) },
    { provide: CREATE_PROJECT, useFactory: () => new CreateProjectUseCase(new PrismaProjectCommands(prisma)) },
    { provide: CREATE_MILESTONE, useFactory: () => new CreateMilestoneUseCase(new PrismaProjectCommands(prisma)) },
    { provide: APPROVE_MILESTONE, useFactory: () => new ApproveMilestoneUseCase(new PrismaUnitOfWork(prisma)) },
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
