import { ActivityItem } from './dashboard';
import { AnalyticsEvent } from './events';
import { Fact } from './fact';

/** Lo que el consumidor hace dentro de UNA transacción: marcar el evento, fusionarlo en el hecho y anotar la actividad. */
export interface EventScope {
  /** true si el evento era nuevo; false si ya se había procesado (duplicado). */
  markEventProcessed(eventId: string): Promise<boolean>;
  /** Bloquea la fila del hito (la crea si no existe), aplica `merge` y la guarda. */
  mergeFact(event: AnalyticsEvent, merge: (prev: Fact | null) => Fact): Promise<void>;
  addActivity(eventId: string, kind: string, message: string, occurredAt: Date): Promise<void>;
}
export interface EventUnitOfWork {
  run<T>(work: (tx: EventScope) => Promise<T>): Promise<T>;
}


/** Lecturas del tablero: no necesitan transacción. */
export interface DashboardQueries {
  facts(): Promise<Fact[]>;
  /** Más reciente primero. */
  recentActivity(limit: number): Promise<ActivityItem[]>;
  eventsProcessed(): Promise<number>;
}

