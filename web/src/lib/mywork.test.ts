import { describe, expect, it } from 'vitest';
import type { WorkOrder } from './types';
import { filterOrders, loadTone, myList, orderDue, summarize } from './mywork';

const NOW = Date.UTC(2026, 10, 1, 15, 0); // 1 nov 2026
const mk = (n: string, over: Partial<WorkOrder> = {}): WorkOrder => ({ id: n, number: n, type: 'inspection', status: 'open', priority: 'normal', targetKind: 'sensor', targetRef: 'x', targetName: 'Sensor', description: 'd', sourceNote: null, dueDate: null, assignedTo: 'Ana', assignedToId: 'a', capacityPercent: null, capacityStart: null, capacityEnd: null, capacityState: 'none', createdBy: null, createdAt: '2026-10-01T00:00:00Z', closedBy: null, closedAt: null, ...over });

describe('loadTone (semáforo de la carga)', () => {
  it.each([[0, 'ok'], [80, 'ok'], [81, 'warn'], [100, 'warn'], [101, 'bad'], [150, 'bad']] as const)('%i %% es %s', (pct, tone) => { expect(loadTone(pct)).toBe(tone); });
});

describe('orderDue', () => {
  it('una orden abierta vence según su fecha: vencida, pronto, con margen o sin fecha', () => {
    expect(orderDue(mk('a', { dueDate: '2026-10-30' }), NOW)).toEqual({ state: 'overdue', days: -2 });
    expect(orderDue(mk('b', { dueDate: '2026-11-03' }), NOW).state).toBe('soon');
    expect(orderDue(mk('c', { dueDate: '2026-12-01' }), NOW).state).toBe('ok');
    expect(orderDue(mk('d'), NOW).state).toBe('none');
  });
  it('una orden terminada o cancelada ya no vence, aunque su fecha haya pasado', () => {
    expect(orderDue(mk('e', { status: 'done', dueDate: '2026-10-01' }), NOW).state).toBe('none');
    expect(orderDue(mk('f', { status: 'cancelled', dueDate: '2026-10-01' }), NOW).state).toBe('none');
  });
});

describe('summarize', () => {
  it('cuenta por estado, cuenta las vencidas y deja fuera las canceladas', () => {
    const s = summarize([mk('1'), mk('2', { status: 'in_progress', dueDate: '2026-10-29' }), mk('3', { status: 'done' }), mk('4', { status: 'done' }), mk('5', { status: 'cancelled' })], NOW);
    expect(s).toEqual({ todo: 1, doing: 1, done: 2, overdue: 1, total: 4 });
  });
  it('sin órdenes todo es cero', () => { expect(summarize([], NOW)).toEqual({ todo: 0, doing: 0, done: 0, overdue: 0, total: 0 }); });
});

describe('filterOrders', () => {
  const all = [mk('OT-1', { dueDate: '2026-11-10' }), mk('OT-2', { dueDate: '2026-10-30', priority: 'low' }), mk('OT-3', { status: 'in_progress' }), mk('OT-4', { status: 'done', closedAt: '2026-10-20T00:00:00Z' }), mk('OT-5', { status: 'done', closedAt: '2026-10-25T00:00:00Z' }), mk('OT-6', { status: 'cancelled' })];
  it('«Por hacer» solo lo abierto y la vencida va primero', () => { expect(filterOrders(all, 'todo', NOW).map((o) => o.number)).toEqual(['OT-2', 'OT-1']); });
  it('«En curso» y «Hechas» (la más reciente primero); nunca las canceladas', () => {
    expect(filterOrders(all, 'doing', NOW).map((o) => o.number)).toEqual(['OT-3']);
    expect(filterOrders(all, 'done', NOW).map((o) => o.number)).toEqual(['OT-5', 'OT-4']);
    expect(filterOrders(all, 'all', NOW).map((o) => o.number)).not.toContain('OT-6');
  });
  it('«Todas»: lo abierto por urgencia y luego lo terminado', () => { expect(filterOrders(all, 'all', NOW).map((o) => o.number)).toEqual(['OT-2', 'OT-1', 'OT-3', 'OT-5', 'OT-4']); });
  it('a igual fecha manda la prioridad', () => {
    const l = filterOrders([mk('A', { dueDate: '2026-11-05', priority: 'normal' }), mk('B', { dueDate: '2026-11-05', priority: 'critical' })], 'todo', NOW);
    expect(l.map((o) => o.number)).toEqual(['B', 'A']);
  });
});

describe('myList (check de lo hecho, lo que hago y lo que falta)', () => {
  it('muestra lo último hecho, lo vencido como mal, lo en curso y lo que falta', () => {
    const l = myList([mk('OT-1', { dueDate: '2026-11-10' }), mk('OT-2', { dueDate: '2026-10-30' }), mk('OT-3', { status: 'in_progress', dueDate: '2026-11-20' }), mk('OT-4', { status: 'done', closedAt: '2026-10-25T00:00:00Z' })], NOW);
    expect(l.map((e) => [e.order.number, e.state])).toEqual([['OT-4', 'done'], ['OT-2', 'bad'], ['OT-1', 'todo'], ['OT-3', 'doing']]);
  });
  it('solo las 2 últimas hechas, y si hay demasiadas se recorta lo que falta, nunca lo hecho', () => {
    const many = [...Array(12)].map((_, i) => mk(`T${String(i).padStart(2, '0')}`, { dueDate: `2026-12-${String(i + 1).padStart(2, '0')}` }));
    const done = [mk('D1', { status: 'done', closedAt: '2026-10-01T00:00:00Z' }), mk('D2', { status: 'done', closedAt: '2026-10-02T00:00:00Z' }), mk('D3', { status: 'done', closedAt: '2026-10-03T00:00:00Z' })];
    const l = myList([...many, ...done], NOW);
    expect(l).toHaveLength(8);
    expect(l.filter((e) => e.state === 'done').map((e) => e.order.number)).toEqual(['D3', 'D2']);
    expect(l[2].order.number).toBe('T00');
  });
  it('sin órdenes la lista está vacía', () => { expect(myList([], NOW)).toEqual([]); });
});
