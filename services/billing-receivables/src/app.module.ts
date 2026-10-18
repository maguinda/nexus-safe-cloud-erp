import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { HandleMilestoneApprovedUseCase } from './application/handle-milestone-approved.use-case';
import { IssueInvoiceUseCase, ListInvoicesUseCase, ReconcileInvoicesUseCase } from './application/invoices.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { HealthController } from './http/health.controller';
import { InvoicesController, ISSUE_INVOICE, LIST_INVOICES, RECONCILE_INVOICES } from './http/invoices.controller';
import { MilestoneApprovedConsumer } from './infrastructure/milestone-approved-consumer';
import { PrismaInvoiceQueries } from './infrastructure/prisma-invoice-queries';
import { PrismaInboxUnitOfWork, PrismaIssueUnitOfWork } from './infrastructure/prisma-units-of-work';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let consumer: MilestoneApprovedConsumer | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [InvoicesController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: RECONCILE_INVOICES, useFactory: () => new ReconcileInvoicesUseCase(new PrismaInvoiceQueries(prisma)) },
    { provide: LIST_INVOICES, useFactory: () => new ListInvoicesUseCase(new PrismaInvoiceQueries(prisma)) },
    { provide: ISSUE_INVOICE, useFactory: () => new IssueInvoiceUseCase(new PrismaIssueUnitOfWork(prisma)) },
  ],
})
export class AppModule implements OnApplicationBootstrap, OnModuleDestroy {
  onApplicationBootstrap() {
    const c = cfg();
    if (c.consumerEnabled) {
      consumer = new MilestoneApprovedConsumer(new HandleMilestoneApprovedUseCase(new PrismaInboxUnitOfWork(prisma)), c.rabbitUrl);
      consumer.start();
    }
  }

  async onModuleDestroy() {
    await consumer?.stop();
    consumer = undefined;
    await prisma.$disconnect();
  }
}
