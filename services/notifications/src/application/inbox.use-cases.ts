import { InboxQueries, NotificationItem } from '../domain/ports';
import { Role } from '../domain/events';

export interface Viewer { id: string; role: Role }

/** La bandeja de avisos de una persona: lo que su rol ve, y qué de eso ya leyó ella. */
export class InboxUseCases {
  constructor(private readonly inbox: InboxQueries) {}

  async list(user: Viewer, opts: { unreadOnly: boolean; limit: number; offset: number }): Promise<{ total: number; unread: number; items: NotificationItem[] }> {
    const [page, unread] = await Promise.all([this.inbox.list(user, opts), this.inbox.unreadCount(user)]);
    return { total: page.total, unread, items: page.items };
  }

  async unreadCount(user: Viewer): Promise<{ unread: number }> {
    return { unread: await this.inbox.unreadCount(user) };
  }

  markRead(user: Viewer, id: string): Promise<boolean> { return this.inbox.markRead(user, id); }

  async markAllRead(user: Viewer): Promise<{ marked: number }> {
    return { marked: await this.inbox.markAllRead(user) };
  }
}
