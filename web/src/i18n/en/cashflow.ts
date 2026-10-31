import type { cashflow as es } from '../es/cashflow';

export const cashflow: Record<keyof typeof es, string> = {
  'nav.cashflow': 'Cash flow',
  'cf.title': 'Cash flow',
  'cf.intro': 'What comes in (client payments) against what goes out (payroll paid and supplier payments), month by month, with the running balance. It counts only money already paid or collected, not what was invoiced or is owed.',
  'cf.loading': 'Loading the cash flow…',
  'cf.loadError': 'Could not load the cash flow: {reason}',
  'cf.months': 'Months',
  'cf.monthsN': 'Last {n} months',
  'cf.row': '{month}: in {inc} · out {out} (payroll {payroll}, suppliers {suppliers}) · net {net} · balance {balance}',
  'cf.totals': 'In the window: {inc} COP came in, {out} COP went out, net {net} COP. Running balance: {balance} COP.',
  'cf.empty': 'There is no money movement yet.',
  'cf.costs.title': 'Real cost against the quote',
  'cf.costs.intro': 'Each project born from an approved quote: what the quote said it would cost and what it has cost so far (labor of the allocations plus what was paid to suppliers tied to the project).',
  'cf.costs.empty': 'There are no projects with an approved quote yet.',
  'cf.costs.row': '{quote} · {project}: quoted {quoted} COP (price {price} COP, margin {margin}%) · real so far {real} COP (labor {labor} + suppliers {suppliers}) · {used}',
  'cf.costs.used': '{pct}% of the quoted cost',
  'cf.costs.noCost': 'no quoted cost',
};
