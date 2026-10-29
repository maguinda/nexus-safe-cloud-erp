import { NotificationDraft, Role } from './events';

/** Lo que el consumidor hace dentro de UNA transacción: marcar el evento y guardar el aviso. */
export interface EventScope {
  /** true si el evento era nuevo; false si ya se había procesado (duplicado). */
  markEventProcessed(eventId: string): Promise<boolean>;
  addNotification(draft: NotificationDraft): Promise<void>;
}
export interface EventUnitOfWork {
  run<T>(work: (tx: EventScope) => Promise<T>): Promise<T>;
}

export interface NotificationItem {
  id: string; kind: string; severity: string; params: Record<string, string | number>; occurredAt: string; read: boolean;
}
export interface InboxQueries {
  /** Los de ese rol, el más reciente primero; `read` es de ESA persona. */
  list(user: { id: string; role: Role }, opts: { unreadOnly: boolean; limit: number; offset: number }): Promise<{ total: number; items: NotificationItem[] }>;
  unreadCount(user: { id: string; role: Role }): Promise<number>;
  /** true si existía y esa persona puede verlo (si no, no se marca nada: no se puede sondear avisos de otros roles). */
  markRead(user: { id: string; role: Role }, id: string): Promise<boolean>;
  /** Cuántos marcó. */
  markAllRead(user: { id: string; role: Role }): Promise<number>;
}
