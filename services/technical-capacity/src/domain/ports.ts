import { Allocation } from './allocation';
import { CapacityEvent } from './events';
import { Engineer } from './engineer';

export interface AllocationView { id: string; kind: 'project' | 'maintenance'; projectName: string; percent: number; startDate: string; endDate: string; overAllocated: boolean }
export interface EngineerView extends Engineer {
  loadToday: number; freeToday: number; peakNext30: number; minFreeNext30: number; allocations: AllocationView[];
}

/** Lecturas: no necesitan transacción. */
export interface CapacityQueries {
  /** Todos los ingenieros con sus asignaciones que aún no terminaron (las de `today` en adelante). */
  engineersWithAllocations(today: number): Promise<{ engineer: Engineer; allocations: (Allocation & { overAllocated: boolean })[] }[]>;
}

export interface TransactionScope {
  /** Bloquea la fila del ingeniero hasta el final de la transacción (SELECT ... FOR UPDATE). null si no existe. */
  lockEngineer(id: string): Promise<Engineer | null>;
  /** Las asignaciones del ingeniero que se cruzan con [from, to]; se llama DENTRO del bloqueo. */
  allocationsOverlapping(engineerId: string, from: number, to: number): Promise<Allocation[]>;
  insertAllocation(a: Allocation, overAllocated: boolean): Promise<void>;
  /** El nombre del proyecto de la asignación borrada; null si no existía. */
  deleteAllocation(id: string): Promise<{ projectName: string } | null>;
  addToOutbox(event: CapacityEvent, aggregateId: string): Promise<void>;
}
export interface UnitOfWork {
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T>;
}

export interface EngineerCommands {
  insertEngineer(e: Engineer): Promise<void>;
  /** false si el ingeniero no existe. */
  /** Escribe el sueldo mensual y el costo diario con prestaciones (lo calcula la función SQL employer_daily_cost, la misma que comprueba el CHECK) en una sola sentencia. */
  setSalary(id: string, salary: number | null): Promise<boolean>;
}
