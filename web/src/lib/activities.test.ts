import { describe, expect, it } from 'vitest';
import { activityDue, filterActivities, sameProject, summarizeActivities, validateActivity } from './activities';
import type { MilestoneActivity } from './types';

const NOW = Date.UTC(2026, 10, 1, 15, 0);
const mk = (code: string, over: Partial<MilestoneActivity> = {}): MilestoneActivity => ({ id: code, code, milestoneId: 'm2', title: 't', description: null, status: 'open', dueDate: null, assignedTo: 'Hugo', assignedToId: 'x', createdBy: 'a@b.co', createdAt: '', startedAt: null, doneAt: null, doneBy: null, doneNote: null, cancelledAt: null, ...over });

describe('activityDue', () => {
  it('vence según su fecha mientras está viva; terminada o cancelada ya no vence', () => {
    expect(activityDue(mk('a', { dueDate: '2026-10-30' }), NOW)).toEqual({ state: 'overdue', days: -2 });
    expect(activityDue(mk('b', { dueDate: '2026-11-03' }), NOW).state).toBe('soon');
    expect(activityDue(mk('c', { dueDate: '2026-12-30' }), NOW).state).toBe('ok');
    expect(activityDue(mk('d'), NOW).state).toBe('none');
    expect(activityDue(mk('e', { status: 'done', dueDate: '2026-01-01' }), NOW).state).toBe('none');
    expect(activityDue(mk('f', { status: 'cancelled', dueDate: '2026-01-01' }), NOW).state).toBe('none');
  });
});
describe('summarizeActivities', () => {
  it('cuenta por estado, las vencidas, y deja fuera las canceladas', () => {
    expect(summarizeActivities([mk('1'), mk('2', { status: 'in_progress', dueDate: '2026-10-29' }), mk('3', { status: 'done' }), mk('4', { status: 'cancelled' })], NOW)).toEqual({ todo: 1, doing: 1, done: 1, overdue: 1, total: 3 });
    expect(summarizeActivities([], NOW)).toEqual({ todo: 0, doing: 0, done: 0, overdue: 0, total: 0 });
  });
});
describe('filterActivities', () => {
  const all = [mk('A-0001', { dueDate: '2026-11-10' }), mk('A-0002', { dueDate: '2026-10-30' }), mk('A-0003', { status: 'in_progress' }), mk('A-0004', { status: 'done', doneAt: '2026-10-20T00:00:00Z' }), mk('A-0005', { status: 'done', doneAt: '2026-10-25T00:00:00Z' }), mk('A-0006', { status: 'cancelled' })];
  it('por hacer con la vencida primero; en curso; hechas la más reciente primero; nunca las canceladas', () => {
    expect(filterActivities(all, 'todo', NOW).map((a) => a.code)).toEqual(['A-0002', 'A-0001']);
    expect(filterActivities(all, 'doing', NOW).map((a) => a.code)).toEqual(['A-0003']);
    expect(filterActivities(all, 'done', NOW).map((a) => a.code)).toEqual(['A-0005', 'A-0004']);
    expect(filterActivities(all, 'all', NOW).map((a) => a.code)).toEqual(['A-0002', 'A-0001', 'A-0003', 'A-0005', 'A-0004']);
  });
});
describe('sameProject', () => {
  it('ignora mayúsculas y espacios de más', () => { expect(sameProject(' Branch  Network upgrade ', 'branch network UPGRADE')).toBe(true); expect(sameProject('Branch', 'Retail')).toBe(false); });
});
describe('validateActivity', () => {
  const ok = { title: 'Instalar el switch', description: '', tech: 'id', due: '' };
  it('una actividad correcta no tiene errores', () => { expect(validateActivity(ok, '2026-11-01')).toEqual({}); expect(validateActivity({ ...ok, due: '2026-11-01' }, '2026-11-01')).toEqual({}); });
  it.each([['título corto', { title: 'ab' }, 'title'], ['título largo', { title: 'x'.repeat(121) }, 'title'], ['detalle con <', { description: 'a<b' }, 'description'], ['detalle largo', { description: 'x'.repeat(301) }, 'description'], ['sin técnico', { tech: null }, 'tech'], ['fecha pasada', { due: '2026-10-31' }, 'due'], ['fecha mal escrita', { due: '1/11/2026' }, 'due']] as const)('%s', (_n, over, key) => {
    expect(validateActivity({ ...ok, ...over } as never, '2026-11-01')).toHaveProperty(key);
  });
});
