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

export class QuoteNotFoundError extends Error {
  constructor() { super('Quote not found'); this.name = 'QuoteNotFoundError'; }
}
/** La cotización no está en el estado que pide la acción (409). */
export class QuoteStateError extends Error {
  constructor(message: string) { super(message); this.name = 'QuoteStateError'; }
}
/** Ventas solo toca sus propias cotizaciones (403). */
export class QuoteForbiddenError extends Error {
  constructor() { super('That quote belongs to someone else'); this.name = 'QuoteForbiddenError'; }
}

/** Un evento recibido del bus no cumple el contrato: va a la cola de mensajes muertos, no se reintenta. */
export class InvalidEventError extends Error {}
