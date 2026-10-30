/** Entrada inválida (400). */
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}
export class EngineerNotFoundError extends Error {
  constructor() { super('Engineer not found'); this.name = 'EngineerNotFoundError'; }
}
export class AllocationNotFoundError extends Error {
  constructor() { super('Allocation not found'); this.name = 'AllocationNotFoundError'; }
}
/** La asignación haría pasar al ingeniero de 100 % en algún día (409). */
/** Una asignación de mantenimiento pertenece a una orden de trabajo: se libera cerrando o cancelando la orden, no a mano (409). */
export class MaintenanceAllocationError extends Error {
  constructor() { super('That allocation belongs to a work order: close or cancel the order to release it'); this.name = 'MaintenanceAllocationError'; }
}
export class OverAllocationError extends Error {
  constructor(public readonly peak: number, public readonly engineerName: string) {
    super(`${engineerName} would be allocated at ${peak}% (the limit is 100%)`);
    this.name = 'OverAllocationError';
  }
}
