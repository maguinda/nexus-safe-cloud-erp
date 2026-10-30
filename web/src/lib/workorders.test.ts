import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkWorkOrder } from './workorders';

const t = makeT('en');
const TODAY = '2026-10-30';
const ok = { type: 'corrective', priority: 'high', description: '  Cámara   sin señal ', dueDate: '2026-11-10', assignedTo: ' Laura  Ríos ' };
describe('checkWorkOrder (same rules as the server)', () => {
  it('accepts and cleans a full order; due date and assignee are optional', () => {
    expect(checkWorkOrder(t, ok, TODAY).value).toEqual({ type: 'corrective', priority: 'high', description: 'Cámara sin señal', dueDate: '2026-11-10', assignedTo: 'Laura Ríos' });
    expect(checkWorkOrder(t, { ...ok, dueDate: '', assignedTo: '' }, TODAY).value).toEqual({ type: 'corrective', priority: 'high', description: 'Cámara sin señal' });
    expect(checkWorkOrder(t, { ...ok, dueDate: TODAY }, TODAY).value?.dueDate).toBe(TODAY);
  });
  it.each<[string, object, string]>([['no type', { type: '' }, 'type'], ['unknown type', { type: 'repair' }, 'type'], ['unknown priority', { priority: 'urgent' }, 'priority'], ['short description', { description: 'ab' }, 'description'],
    ['long description', { description: 'x'.repeat(301) }, 'description'], ['markup', { description: '<b>x</b>' }, 'description'], ['impossible date', { dueDate: '2026-02-30' }, 'dueDate'], ['text date', { dueDate: 'mañana' }, 'dueDate'],
    ['past date', { dueDate: '2026-10-29' }, 'dueDate'], ['short assignee', { assignedTo: 'A' }, 'assignedTo'], ['markup assignee', { assignedTo: '<i>x</i>' }, 'assignedTo']])('rejects %s', (_n, over, key) => {
    expect((checkWorkOrder(t, { ...ok, ...over }, TODAY).errors as Record<string, string>)[key]).toBeTruthy();
  });
});
