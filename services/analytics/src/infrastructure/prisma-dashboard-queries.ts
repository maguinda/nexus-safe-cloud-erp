import { PrismaClient } from '@prisma/client';
import { ActivityItem } from '../domain/dashboard';
import { DashboardQueries } from '../domain/ports';
import { Fact } from '../domain/fact';

export class PrismaDashboardQueries implements DashboardQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async facts(): Promise<Fact[]> {
    const rows = await this.prisma.milestoneFact.findMany();
    return rows.map((r) => ({ ...r, invoiceStatus: r.invoiceStatus }));
  }

  async recentActivity(limit: number): Promise<ActivityItem[]> {
    const rows = await this.prisma.activityEntry.findMany({ orderBy: [{ occurredAt: 'desc' }, { receivedAt: 'desc' }], take: limit });
    return rows.map((r) => ({ kind: r.kind, message: r.message, occurredAt: r.occurredAt, receivedAt: r.receivedAt }));
  }

  eventsProcessed(): Promise<number> {
    return this.prisma.processedEvent.count();
  }
}
