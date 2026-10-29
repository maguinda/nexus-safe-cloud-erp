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
export class OverAllocationError extends Error {
  constructor(public readonly peak: number, public readonly engineerName: string) {
    super(`${engineerName} would be allocated at ${peak}% (the limit is 100%)`);
    this.name = 'OverAllocationError';
  }
}
