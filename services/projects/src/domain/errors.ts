export class ProjectNotFoundError extends Error {
  constructor(id: string) { super(`Project ${id} not found`); this.name = 'ProjectNotFoundError'; }
}
export class MilestoneNotFoundError extends Error {
  constructor(id: string) { super(`Milestone ${id} not found`); this.name = 'MilestoneNotFoundError'; }
}
export class MilestoneAlreadyApprovedError extends Error {
  constructor(id: string) { super(`Milestone ${id} is already approved`); this.name = 'MilestoneAlreadyApprovedError'; }
}
export class InvalidInputError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidInputError'; }
}

/** Un evento recibido del bus no cumple el contrato: va a la cola de mensajes muertos, no se reintenta. */
export class InvalidEventError extends Error {}
