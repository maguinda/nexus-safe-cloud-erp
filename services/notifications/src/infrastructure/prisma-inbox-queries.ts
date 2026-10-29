import { PrismaClient } from '@prisma/client';
import { Role } from '../domain/events';
import { InboxQueries, NotificationItem } from '../domain/ports';

type U = { id: string; role: Role };

export class PrismaInboxQueries implements InboxQueries {
  constructor(private readonly prisma: PrismaClient) {}

  async list(user: U, opts: { unreadOnly: boolean; limit: number; offset: number }): Promise<{ total: number; items: NotificationItem[] }> {
    // Dos consultas fijas (sin armar SQL con texto): solo cambia si se piden únicamente las no leídas.
    const rows = opts.unreadOnly
      ? await this.prisma.$queryRaw<any[]>`
          SELECT n.id, n.kind, n.severity, n.params, n.occurred_at, false AS read FROM notifications n
          WHERE ${user.role} = ANY(n.audience_roles) AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ${user.id}::uuid)
          ORDER BY n.occurred_at DESC, n.id LIMIT ${opts.limit} OFFSET ${opts.offset}`
      : await this.prisma.$queryRaw<any[]>`
          SELECT n.id, n.kind, n.severity, n.params, n.occurred_at, EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ${user.id}::uuid) AS read
          FROM notifications n WHERE ${user.role} = ANY(n.audience_roles)
          ORDER BY n.occurred_at DESC, n.id LIMIT ${opts.limit} OFFSET ${opts.offset}`;
    const total = opts.unreadOnly ? await this.unreadCount(user) : await this.visibleCount(user);
    return { total, items: rows.map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, params: r.params, occurredAt: new Date(r.occurred_at).toISOString(), read: r.read })) };
  }

  private async visibleCount(user: U): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM notifications WHERE ${user.role} = ANY(audience_roles)`;
    return Number(n);
  }

  async unreadCount(user: U): Promise<number> {
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM notifications n WHERE ${user.role} = ANY(n.audience_roles)
      AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ${user.id}::uuid)`;
    return Number(n);
  }

  async markRead(user: U, id: string): Promise<boolean> {
    // Solo si el aviso existe Y es de su rol: de lo contrario responde igual que si no existiera (no se sondean avisos ajenos).
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO notification_reads (notification_id, user_id)
      SELECT n.id, ${user.id}::uuid FROM notifications n WHERE n.id = ${id}::uuid AND ${user.role} = ANY(n.audience_roles)
      ON CONFLICT DO NOTHING RETURNING notification_id AS id`;
    if (rows.length === 1) return true;
    const [{ n }] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM notifications WHERE id = ${id}::uuid AND ${user.role} = ANY(audience_roles)`;
    return Number(n) === 1; // ya estaba leído: sigue siendo «existe y es suyo»
  }

  async markAllRead(user: U): Promise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO notification_reads (notification_id, user_id)
      SELECT n.id, ${user.id}::uuid FROM notifications n WHERE ${user.role} = ANY(n.audience_roles) ON CONFLICT DO NOTHING`;
  }
}
