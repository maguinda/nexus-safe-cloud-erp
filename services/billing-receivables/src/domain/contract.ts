import { InvalidContractError } from './errors';

export const CONTRACT_STATUSES = ['active', 'closed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export const MAX_CONTRACT_COP = 2_147_483_647;
const NAME = /^[^<>\u0000-\u001f]{2,120}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface ContractInput { clientName: string; projectName: string; projectId: string | null; amountCop: number; startDate: string; endDate: string }
export interface Contract extends ContractInput { id: string; status: ContractStatus; createdAt: Date; createdBy: string }

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
function day(v: unknown, field: string): string {
  if (typeof v !== 'string' || !DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw new InvalidContractError(`${field} must be a real date (YYYY-MM-DD)`);
  return v;
}

/** El mismo criterio que usa el formulario: texto limpio, pesos enteros y una vigencia que no termina antes de empezar. */
export function validateContract(i: Partial<Record<keyof ContractInput, unknown>>): ContractInput {
  const clientName = clean(i.clientName), projectName = clean(i.projectName);
  if (!NAME.test(clientName)) throw new InvalidContractError('clientName must be 2 to 120 characters without < > or control characters');
  if (!NAME.test(projectName)) throw new InvalidContractError('projectName must be 2 to 120 characters without < > or control characters');
  const projectId = i.projectId === undefined || i.projectId === null || i.projectId === '' ? null : i.projectId;
  if (projectId !== null && (typeof projectId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId))) throw new InvalidContractError('projectId must be an id of Projects (letters, numbers, - and _)');
  const a = i.amountCop;
  if (typeof a !== 'number' || !Number.isInteger(a) || a < 1 || a > MAX_CONTRACT_COP) throw new InvalidContractError(`amountCop must be a whole number between 1 and ${MAX_CONTRACT_COP}`);
  const startDate = day(i.startDate, 'startDate'), endDate = day(i.endDate, 'endDate');
  if (endDate < startDate) throw new InvalidContractError('endDate cannot be before startDate');
  return { clientName, projectName, projectId, amountCop: a, startDate, endDate };
}

/** Solo un contrato vigente puede cerrarse o cancelarse; los demás estados son finales. */
export const canChangeStatus = (from: ContractStatus, to: ContractStatus) => from === 'active' && (to === 'closed' || to === 'cancelled');
