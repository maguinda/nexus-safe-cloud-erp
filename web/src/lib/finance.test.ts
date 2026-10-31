import { describe, expect, it } from 'vitest';
import { barPct, cashScale, closingChecklist, filterPayables, payableDue, payrollTone, summarizePayables, usedTone } from './finance';
import type { Payable, PayrollRun, ProjectCostRow } from './types';

const NOW = Date.UTC(2026, 10, 1, 15, 0); // 1 nov 2026
const pay = (n: string, over: Partial<Payable> = {}): Payable => ({ id: n, number: n, orderId: 'o', supplierName: 'S', amountCop: 100, dueDate: '2026-11-30', projectName: null, status: 'open', overdue: false, createdAt: '2026-10-01T00:00:00Z', paidAt: null, paidBy: null, method: null, reference: null, ...over });
const run = (period: string, status: 'generated' | 'paid' = 'generated'): PayrollRun => ({ id: period, period, status, totalCop: 1, headcount: 1, generatedBy: 'x', generatedAt: '', paidBy: null, paidAt: null });
const cost = (usedPct: number | null): ProjectCostRow => ({ quoteNumber: 'C', projectName: 'P', quotedPriceCop: 1, quotedCostCop: 1, quotedMarginPct: 25, laborCostCop: 0, purchasesPaidCop: 0, realCostCop: 0, varianceCop: 0, usedPct, approvedAt: '' });

describe('payableDue (semáforo de la deuda)', () => {
  it('vencida, pronto (7 días o menos) y con margen', () => {
    expect(payableDue(pay('a', { dueDate: '2026-10-30' }), NOW)).toEqual({ state: 'overdue', days: -2 });
    expect(payableDue(pay('b', { dueDate: '2026-11-08' }), NOW).state).toBe('soon'); // 7 días
    expect(payableDue(pay('c', { dueDate: '2026-11-09' }), NOW).state).toBe('ok'); // 8 días
    expect(payableDue(pay('d', { dueDate: '2026-11-01' }), NOW).state).toBe('soon'); // hoy no está vencida
  });
  it('una deuda pagada ya no vence, aunque su fecha haya pasado', () => { expect(payableDue(pay('e', { status: 'paid', dueDate: '2026-01-01' }), NOW).state).toBe('none'); });
});

describe('summarizePayables', () => {
  it('suma por estado: por pagar, vencidas, por vencer y pagadas', () => {
    const s = summarizePayables([pay('1', { amountCop: 285, dueDate: '2026-10-26' }), pay('2', { amountCop: 900, dueDate: '2026-11-04' }), pay('3', { amountCop: 50 }), pay('4', { status: 'paid', amountCop: 4800 })], NOW);
    expect(s).toEqual({ open: 3, overdue: 1, soon: 1, paid: 1, openCop: 1235, overdueCop: 285, soonCop: 900, paidCop: 4800 });
  });
  it('sin deudas todo es cero', () => { expect(summarizePayables([], NOW)).toEqual({ open: 0, overdue: 0, soon: 0, paid: 0, openCop: 0, overdueCop: 0, soonCop: 0, paidCop: 0 }); });
});

describe('filterPayables', () => {
  const all = [pay('A', { dueDate: '2026-11-20' }), pay('B', { dueDate: '2026-10-20' }), pay('C', { status: 'paid', paidAt: '2026-10-25T00:00:00Z' }), pay('D', { status: 'paid', paidAt: '2026-10-28T00:00:00Z' })];
  it('«Por pagar» la más próxima a vencer primero; «Vencidas» solo las vencidas; «Pagadas» la más reciente primero', () => {
    expect(filterPayables(all, 'open', NOW).map((p) => p.number)).toEqual(['B', 'A']);
    expect(filterPayables(all, 'overdue', NOW).map((p) => p.number)).toEqual(['B']);
    expect(filterPayables(all, 'paid', NOW).map((p) => p.number)).toEqual(['D', 'C']);
  });
  it('«Todas»: lo por pagar y luego lo pagado', () => { expect(filterPayables(all, 'all', NOW).map((p) => p.number)).toEqual(['B', 'A', 'D', 'C']); });
});

describe('payrollTone', () => {
  it('pagada verde; sin pagar del mes actual ámbar; sin pagar de un mes pasado rojo', () => {
    expect(payrollTone(run('2026-09', 'paid'), NOW)).toBe('ok');
    expect(payrollTone(run('2026-11'), NOW)).toBe('warn');
    expect(payrollTone(run('2026-10'), NOW)).toBe('bad');
  });
});

describe('usedTone (costo real contra lo cotizado)', () => {
  it.each([[0, 'ok'], [100, 'ok'], [101, 'warn'], [110, 'warn'], [111, 'bad'], [null, 'neutral']] as const)('%s %% es %s', (pct, tone) => { expect(usedTone(pct)).toBe(tone); });
});

describe('closingChecklist (cierre del mes)', () => {
  it('sin nómina del mes: falta generarla y pagarla', () => {
    const l = closingChecklist(NOW, [run('2026-10', 'paid')], [], []);
    expect(l.map((i) => [i.key, i.state])).toEqual([['payrollGenerated', 'todo'], ['payrollPaid', 'todo'], ['payablesOverdue', 'done'], ['budget', 'done']]);
  });
  it('nómina generada sin pagar: se está haciendo; pagada: hecho', () => {
    expect(closingChecklist(NOW, [run('2026-11')], [], []).slice(0, 2).map((i) => i.state)).toEqual(['done', 'doing']);
    expect(closingChecklist(NOW, [run('2026-11', 'paid')], [], []).slice(0, 2).map((i) => i.state)).toEqual(['done', 'done']);
  });
  it('deudas vencidas y proyectos pasados de presupuesto se marcan mal, con su cuenta', () => {
    const l = closingChecklist(NOW, [], [pay('1', { dueDate: '2026-10-01' }), pay('2', { dueDate: '2026-10-02' }), pay('3', { status: 'paid', dueDate: '2026-10-01' })], [cost(118.5), cost(90), cost(null)]);
    expect(l[2]).toMatchObject({ key: 'payablesOverdue', state: 'bad', n: 2 });
    expect(l[3]).toMatchObject({ key: 'budget', state: 'bad', n: 1 });
  });
});

describe('barras del flujo de caja', () => {
  it('la escala es el mes más grande y nunca 0', () => {
    expect(cashScale([{ month: 'a', inCop: 5, payrollCop: 0, supplierCop: 0, outCop: 40, netCop: 0, balanceCop: 0 }, { month: 'b', inCop: 100, payrollCop: 0, supplierCop: 0, outCop: 1, netCop: 0, balanceCop: 0 }])).toBe(100);
    expect(cashScale([])).toBe(1);
  });
  it('el porcentaje queda entre 0 y 100', () => { expect(barPct(50, 100)).toBe(50); expect(barPct(500, 100)).toBe(100); expect(barPct(-5, 100)).toBe(0); });
});
