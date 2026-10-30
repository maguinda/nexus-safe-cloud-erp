import { Allocation, newAllocation } from '../domain/allocation';
import { dayString, todayNumber } from '../domain/dates';
import { dailyCostFromSalary, monthlySalary, newEngineer } from '../domain/engineer';
import { AllocationNotFoundError, EngineerNotFoundError, OverAllocationError } from '../domain/errors';
import { allocationRemoved, engineerAllocated, overAllocationDetected } from '../domain/events';
import { peakLoad, summarize } from '../domain/load';
import { CapacityQueries, EngineerCommands, EngineerView, UnitOfWork } from '../domain/ports';

const MAX_LISTED = 100;

export class CreateEngineerUseCase {
  constructor(private readonly commands: EngineerCommands) {}
  async execute(input: { name: unknown; role?: unknown; position: unknown; skills?: unknown; certifications?: unknown; monthlySalaryCop?: unknown }) {
    const e = newEngineer(input.name, input.role, input.skills, input.certifications, input.monthlySalaryCop, input.position);
    await this.commands.insertEngineer(e);
    return e;
  }
}

/** Gerencia escribe el sueldo MENSUAL; el costo diario se calcula de él. Solo cuenta para las asignaciones que se hagan DESPUÉS (cada asignación guarda el costo vigente al crearla). */
export class SetSalaryUseCase {
  constructor(private readonly commands: EngineerCommands) {}
  async execute(id: string, salary: unknown): Promise<void> {
    const s = monthlySalary(salary);
    if (!(await this.commands.setSalary(id, s, dailyCostFromSalary(s)))) throw new EngineerNotFoundError();
  }
}

export interface AllocateInput { projectName: unknown; percent: unknown; startDate: unknown; endDate: unknown; allowOverallocation?: boolean }

/**
 * Asignar a un ingeniero. Nadie pasa de 100 % de carga en ningún día: la fila del ingeniero se BLOQUEA, las asignaciones se RELEEN dentro
 * del bloqueo (no antes) y solo entonces se decide, así dos asignaciones a la vez no se suman por encima de 100.
 * Con `allowOverallocation` (decisión consciente de gerencia) se acepta pasar de 100 y se ANUNCIA con OverAllocationDetected.
 * La asignación y sus eventos (outbox) van en UNA transacción.
 */
export class AllocateEngineerUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}

  async execute(engineerId: string, input: AllocateInput, correlationId: string): Promise<Allocation & { overAllocated: boolean; peak: number }> {
    const a = newAllocation(engineerId, input.projectName, input.percent, input.startDate, input.endDate);
    return this.uow.run(async (tx) => {
      const engineer = await tx.lockEngineer(engineerId);
      if (!engineer) throw new EngineerNotFoundError();
      const existing = await tx.allocationsOverlapping(engineerId, a.start, a.end);
      const { peak } = peakLoad([...existing, a], a.start, a.end);
      const over = peak > 100;
      if (over && !input.allowOverallocation) throw new OverAllocationError(peak, engineer.name);
      const now = this.clock();
      await tx.insertAllocation(a, over);
      await tx.addToOutbox(engineerAllocated(engineer, a, correlationId, now), a.id);
      if (over) await tx.addToOutbox(overAllocationDetected(engineer, a, peak, correlationId, now), a.id);
      return { ...a, overAllocated: over, peak };
    });
  }
}

export class DeleteAllocationUseCase {
  constructor(private readonly uow: UnitOfWork, private readonly clock: () => Date = () => new Date()) {}
  /** Borra y ANUNCIA en la misma transacción (outbox): el equipo del proyecto y los costos olvidan la asignación. */
  execute(id: string, correlationId = 'no-correlation'): Promise<void> {
    return this.uow.run(async (tx) => {
      const gone = await tx.deleteAllocation(id);
      if (!gone) throw new AllocationNotFoundError();
      await tx.addToOutbox(allocationRemoved(id, gone.projectName, correlationId, this.clock()), id);
    });
  }
}

/** La vista de capacidad (para ventas y gerencia): cada ingeniero con lo ocupado hoy, el máximo de los próximos 30 días y lo que le queda por delante. */
export class ListCapacityUseCase {
  constructor(private readonly queries: CapacityQueries, private readonly clock: () => Date = () => new Date()) {}
  async execute(): Promise<{ today: string; engineers: EngineerView[] }> {
    const today = todayNumber(this.clock());
    const rows = await this.queries.engineersWithAllocations(today);
    return {
      today: dayString(today),
      engineers: rows.map(({ engineer, allocations }) => ({
        ...engineer, ...summarize(allocations, today),
        // La carga se calcula con TODAS las asignaciones vigentes; solo la lista que se muestra se corta (las 100 más próximas).
        allocations: allocations.slice(0, MAX_LISTED).map((x) => ({ id: x.id, projectName: x.projectName, percent: x.percent, startDate: dayString(x.start), endDate: dayString(x.end), overAllocated: x.overAllocated })),
      })),
    };
  }
}
