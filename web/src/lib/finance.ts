import { dueState, type DueState } from './invoice-table';
import type { CashflowResponse, Payable, PayrollRun, ProjectCostRow } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
/** Hasta cuántos días antes de vencer una deuda se avisa en ámbar. */
export const PAYABLE_SOON_DAYS = 7;

/** Vencimiento de una deuda: solo cuenta mientras está por pagar (una pagada ya no vence). Pronto = 7 días o menos. */
export function payableDue(p: Pick<Payable, 'status' | 'dueDate'>, nowMs: number): DueState {
  if (p.status === 'paid') return { state: 'none', days: null };
  const d = dueState(p.dueDate, nowMs);
  if (d.state === 'overdue') return d;
  return { state: d.days !== null && d.days <= PAYABLE_SOON_DAYS ? 'soon' : 'ok', days: d.days };
}

export interface PayablesSummary { open: number; overdue: number; soon: number; paid: number; openCop: number; overdueCop: number; soonCop: number; paidCop: number }
export function summarizePayables(list: Payable[], nowMs: number): PayablesSummary {
  const s: PayablesSummary = { open: 0, overdue: 0, soon: 0, paid: 0, openCop: 0, overdueCop: 0, soonCop: 0, paidCop: 0 };
  for (const p of list) {
    if (p.status === 'paid') { s.paid++; s.paidCop += p.amountCop; continue; }
    s.open++; s.openCop += p.amountCop;
    const st = payableDue(p, nowMs).state;
    if (st === 'overdue') { s.overdue++; s.overdueCop += p.amountCop; } else if (st === 'soon') { s.soon++; s.soonCop += p.amountCop; }
  }
  return s;
}

export type PayableFilter = 'open' | 'overdue' | 'paid' | 'all';
/** Lo urgente primero: las vencidas, luego por fecha; las pagadas al final, la más reciente primero. */
export function filterPayables(list: Payable[], f: PayableFilter, nowMs: number): Payable[] {
  const pick = f === 'all' ? list : f === 'paid' ? list.filter((p) => p.status === 'paid') : f === 'overdue' ? list.filter((p) => payableDue(p, nowMs).state === 'overdue') : list.filter((p) => p.status === 'open');
  const open = pick.filter((p) => p.status === 'open').sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number));
  const paid = pick.filter((p) => p.status === 'paid').sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? '') || a.number.localeCompare(b.number));
  return [...open, ...paid];
}

/** Estado de una nómina: pagada = verde; sin pagar de un mes que ya pasó = rojo (atrasada); sin pagar del mes actual = ámbar. */
export function payrollTone(run: Pick<PayrollRun, 'status' | 'period'>, nowMs: number): Tone {
  if (run.status === 'paid') return 'ok';
  const current = new Date(nowMs).toISOString().slice(0, 7);
  return run.period < current ? 'bad' : 'warn';
}

/** Semáforo del costo real contra lo cotizado: hasta 100 % verde, de 100 a 110 % ámbar, más de 110 % rojo; sin dato, neutro. */
export function usedTone(usedPct: number | null): Tone {
  if (usedPct === null) return 'neutral';
  return usedPct > 110 ? 'bad' : usedPct > 100 ? 'warn' : 'ok';
}
export const overBudget = (p: Pick<ProjectCostRow, 'usedPct'>) => p.usedPct !== null && p.usedPct > 100;

export type CheckState = 'done' | 'doing' | 'todo' | 'bad';
export interface ClosingItem { key: 'payrollGenerated' | 'payrollPaid' | 'payablesOverdue' | 'budget'; state: CheckState; n?: number; period?: string }

/** «Cierre del mes»: ¿la nómina del mes se generó? ¿se pagó? ¿no hay deudas vencidas? ¿ningún proyecto pasado de presupuesto? */
export function closingChecklist(nowMs: number, payrolls: PayrollRun[], payables: Payable[], costs: ProjectCostRow[]): ClosingItem[] {
  const period = new Date(nowMs).toISOString().slice(0, 7);
  const run = payrolls.find((r) => r.period === period);
  const overdue = payables.filter((p) => payableDue(p, nowMs).state === 'overdue').length;
  const over = costs.filter(overBudget).length;
  return [
    { key: 'payrollGenerated', state: run ? 'done' : 'todo', period },
    { key: 'payrollPaid', state: !run ? 'todo' : run.status === 'paid' ? 'done' : 'doing', period },
    { key: 'payablesOverdue', state: overdue === 0 ? 'done' : 'bad', n: overdue },
    { key: 'budget', state: over === 0 ? 'done' : 'bad', n: over },
  ];
}

/** Para las barras del flujo de caja: el mes más grande (entrada o salida) fija la escala, nunca 0 (evita dividir entre cero). */
export function cashScale(months: CashflowResponse['months']): number {
  return Math.max(1, ...months.map((m) => Math.max(m.inCop, m.outCop)));
}
export const barPct = (value: number, scale: number) => Math.max(0, Math.min(100, Math.round((value / scale) * 100)));
