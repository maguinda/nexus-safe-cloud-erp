import { Module, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { GenerateElectronicInvoiceUseCase, GetElectronicInvoiceUseCase, ListCustomersUseCase, RegisterEInvoiceDeliveryUseCase, SubmitElectronicInvoiceUseCase, UpsertCustomerUseCase } from './application/einvoice.use-cases';
import { HandleMilestoneApprovedUseCase } from './application/handle-milestone-approved.use-case';
import { IssueInvoiceUseCase, ListInvoicesUseCase, ReconcileInvoicesUseCase } from './application/invoices.use-cases';
import { AUTH_OPTIONS, JwtAuthGuard, RolesGuard } from './auth/auth.guard';
import { loadConfig } from './config';
import { SandboxEInvoiceProvider } from './domain/einvoice/provider';
import { CustomersController, DELIVER_EINVOICE, ElectronicInvoiceController, GENERATE_EINVOICE, GET_EINVOICE, LIST_CUSTOMERS, SUBMIT_EINVOICE, UPSERT_CUSTOMER } from './http/einvoice.controller';
import { HealthController } from './http/health.controller';
import { InvoicesController, ISSUE_INVOICE, LIST_INVOICES, RECONCILE_INVOICES } from './http/invoices.controller';
import { MilestoneApprovedConsumer } from './infrastructure/milestone-approved-consumer';
import { DetectOverdueInvoicesUseCase } from './application/detect-overdue.use-case';
import { OutboxRelay } from './infrastructure/outbox-relay';
import { OverdueScheduler } from './infrastructure/overdue-scheduler';
import { PrismaCustomerRepository, PrismaEInvoiceRepository, PrismaEInvoiceUnitOfWork, QrCodeRenderer } from './infrastructure/prisma-einvoice';
import { PrismaInvoiceQueries } from './infrastructure/prisma-invoice-queries';
import { PrismaInboxUnitOfWork, PrismaIssueUnitOfWork, PrismaOverdueUnitOfWork } from './infrastructure/prisma-units-of-work';

const prisma = new PrismaClient();
const cfg = () => loadConfig();
let consumer: MilestoneApprovedConsumer | undefined;
let relay: OutboxRelay | undefined;
let overdue: OverdueScheduler | undefined;

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }])],
  controllers: [InvoicesController, ElectronicInvoiceController, CustomersController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: AUTH_OPTIONS, useFactory: () => { const c = cfg(); return { publicKey: c.publicKey, issuer: c.issuer, audience: c.audience }; } },
    { provide: RECONCILE_INVOICES, useFactory: () => new ReconcileInvoicesUseCase(new PrismaInvoiceQueries(prisma)) },
    { provide: LIST_INVOICES, useFactory: () => new ListInvoicesUseCase(new PrismaInvoiceQueries(prisma)) },
    { provide: GENERATE_EINVOICE, useFactory: () => new GenerateElectronicInvoiceUseCase(new PrismaEInvoiceUnitOfWork(prisma), cfg().einvoice) },
    { provide: GET_EINVOICE, useFactory: () => new GetElectronicInvoiceUseCase(new PrismaEInvoiceRepository(prisma), new QrCodeRenderer()) },
    { provide: SUBMIT_EINVOICE, useFactory: () => new SubmitElectronicInvoiceUseCase(new PrismaEInvoiceRepository(prisma), new SandboxEInvoiceProvider()) },
    { provide: DELIVER_EINVOICE, useFactory: () => new RegisterEInvoiceDeliveryUseCase(new PrismaEInvoiceRepository(prisma)) },
    { provide: LIST_CUSTOMERS, useFactory: () => new ListCustomersUseCase(new PrismaCustomerRepository(prisma)) },
    { provide: UPSERT_CUSTOMER, useFactory: () => new UpsertCustomerUseCase(new PrismaCustomerRepository(prisma)) },
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
    if (c.relayEnabled) {
      relay = new OutboxRelay(prisma, { url: c.rabbitUrl, pollMs: c.outboxPollMs });
      relay.start();
    }
    if (c.overdueEnabled) {
      overdue = new OverdueScheduler(new DetectOverdueInvoicesUseCase(new PrismaOverdueUnitOfWork(prisma)), c.overdueCheckMs);
      overdue.start();
    }
  }

  async onModuleDestroy() {
    await consumer?.stop();
    consumer = undefined;
    await relay?.stop();
    relay = undefined;
    await overdue?.stop();
    overdue = undefined;
    await prisma.$disconnect();
  }
}
