import type { MsgKey, TFn } from '../i18n';

export const NAME_MAX = 120;
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u001f<>]/;
export interface ContractForm { clientName: string; projectName: string; amountCop: string; startDate: string; endDate: string }
export type ContractErrors = Partial<Record<keyof ContractForm, string>>;
export const STATUS_KEY: Record<'active' | 'closed' | 'cancelled', MsgKey> = { active: 'con.status.active', closed: 'con.status.closed', cancelled: 'con.status.cancelled' };

const realDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Mismos criterios que el servidor (domain/contract.ts): textos limpios de 2 a 120, pesos enteros, fechas reales y vigencia que no termina antes de empezar. */
export function checkContract(t: TFn, f: ContractForm): { errors: ContractErrors; value?: { clientName: string; projectName: string; amountCop: number; startDate: string; endDate: string } } {
  const errors: ContractErrors = {};
  const clientName = f.clientName.replace(/\s+/g, ' ').trim(), projectName = f.projectName.replace(/\s+/g, ' ').trim();
  for (const [k, v] of [['clientName', clientName], ['projectName', projectName]] as const) if (v.length < 2 || v.length > NAME_MAX || BAD.test(v)) errors[k] = t('con.v.name', { max: NAME_MAX });
  const a = f.amountCop.trim();
  if (!/^\d+$/.test(a) || Number(a) < 1 || Number(a) > 2_147_483_647) errors.amountCop = t('con.v.amount');
  if (!realDay(f.startDate)) errors.startDate = t('con.v.date');
  if (!realDay(f.endDate)) errors.endDate = t('con.v.date');
  else if (!errors.startDate && f.endDate < f.startDate) errors.endDate = t('con.v.range');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { clientName, projectName, amountCop: Number(a), startDate: f.startDate, endDate: f.endDate } };
}
