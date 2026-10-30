import { canTransition, InvalidWorkOrderError, orderLabel, validateAssignee, validateNewWorkOrder, validateStatusChange } from './work-order';

const TODAY = '2026-10-30';
const ok = { type: 'corrective', targetKind: 'sensor', targetRef: 'WEBCAM_OF1', description: '  Cámara   sin   señal ', priority: 'high', dueDate: '2026-11-10', assignedTo: ' Laura   Ríos ', sourceNote: 'ALERT 41,2 °C' };

describe('validateNewWorkOrder', () => {
  it('accepts a complete order and cleans the texts', () => {
    expect(validateNewWorkOrder(ok, TODAY)).toEqual({ type: 'corrective', priority: 'high', targetKind: 'sensor', targetRef: 'WEBCAM_OF1', description: 'Cámara sin señal', sourceNote: 'ALERT 41,2 °C', dueDate: '2026-11-10', assignedTo: 'Laura Ríos', assignedToId: null, capacity: null });
  });
  it('priority defaults to normal; due date, assignee and source note are optional; a device ref may be a number', () => {
    expect(validateNewWorkOrder({ type: 'inspection', targetKind: 'device', targetRef: 12, description: 'Revisar puertos' }, TODAY)).toMatchObject({ priority: 'normal', targetRef: '12', dueDate: null, assignedTo: null, sourceNote: null });
    expect(validateNewWorkOrder({ ...ok, dueDate: TODAY }, TODAY).dueDate).toBe(TODAY); // hoy vale
  });
  it.each<[string, object]>([['type unknown', { type: 'repair' }], ['no type', { type: undefined }], ['kind unknown', { targetKind: 'camera' }], ['sensor ref with space', { targetRef: 'a b' }], ['sensor ref injection', { targetRef: "x'; DROP" }],
    ['device ref text', { targetKind: 'device', targetRef: 'abc' }], ['device ref negative', { targetKind: 'device', targetRef: '-1' }], ['no ref', { targetRef: undefined }], ['description short', { description: 'ab' }], ['description long', { description: 'x'.repeat(301) }],
    ['description markup', { description: '<b>x</b>' }], ['description control', { description: 'a\u0000b' }], ['description number', { description: 5 }], ['priority unknown', { priority: 'urgent' }],
    ['date past', { dueDate: '2026-10-29' }], ['date impossible', { dueDate: '2026-02-30' }], ['date text', { dueDate: 'mañana' }], ['date far', { dueDate: '2101-01-01' }], ['assignee short', { assignedTo: 'A' }], ['assignee markup', { assignedTo: '<i>x</i>' }],
    ['note long', { sourceNote: 'x'.repeat(201) }], ['note markup', { sourceNote: '<script>' }],
  ])('refuses %s', (_n, over) => { expect(() => validateNewWorkOrder({ ...ok, ...over }, TODAY)).toThrow(InvalidWorkOrderError); });
});

describe('status rules', () => {
  it('open → in_progress, done or cancelled; in_progress → done or cancelled; done and cancelled are final', () => {
    expect(canTransition('open', 'in_progress')).toBe(true); expect(canTransition('open', 'done')).toBe(true); expect(canTransition('open', 'cancelled')).toBe(true);
    expect(canTransition('in_progress', 'done')).toBe(true); expect(canTransition('in_progress', 'cancelled')).toBe(true);
    expect(canTransition('in_progress', 'open')).toBe(false); expect(canTransition('open', 'open')).toBe(false);
    for (const to of ['open', 'in_progress', 'done', 'cancelled'] as const) { expect(canTransition('done', to)).toBe(false); expect(canTransition('cancelled', to)).toBe(false); }
  });
  it('validates the new status and the note', () => {
    expect(validateStatusChange('done', '  Se cambió  el equipo ')).toEqual({ status: 'done', note: 'Se cambió el equipo' }); expect(validateStatusChange('cancelled', '')).toEqual({ status: 'cancelled', note: null });
    for (const s of ['closed', '', undefined, 5, 'DONE']) expect(() => validateStatusChange(s, null)).toThrow(InvalidWorkOrderError);
    expect(() => validateStatusChange('done', '<b>x</b>')).toThrow(InvalidWorkOrderError); expect(() => validateStatusChange('done', 'x'.repeat(301))).toThrow(InvalidWorkOrderError);
  });
  it('assignee is optional and validated; the label is OT-0001', () => {
    expect(validateAssignee('  Ana  Gil ')).toBe('Ana Gil'); expect(validateAssignee(null)).toBeNull(); expect(validateAssignee('')).toBeNull(); expect(() => validateAssignee('A')).toThrow(InvalidWorkOrderError);
    expect(orderLabel(7)).toBe('OT-0007'); expect(orderLabel(12345)).toBe('OT-12345');
  });
});

describe('validateAssigneeId', () => {
  const { validateAssigneeId } = require('./work-order');
  const id = '11111111-1111-4111-8111-111111111107';
  it('is optional, lowercases a UUID and needs the name', () => {
    expect(validateAssigneeId(undefined, 'Ana Gil')).toBeNull(); expect(validateAssigneeId('', undefined)).toBeNull(); expect(validateAssigneeId(null, null)).toBeNull();
    expect(validateAssigneeId(id.toUpperCase(), 'Ana Gil')).toBe(id);
    expect(() => validateAssigneeId(id, undefined)).toThrow(InvalidWorkOrderError); expect(() => validateAssigneeId(id, '')).toThrow(InvalidWorkOrderError);
  });
  it.each(['zz', 5, {}, [], "1'; DROP", id + 'x'])('refuses %p', (v) => { expect(() => validateAssigneeId(v, 'Ana Gil')).toThrow(InvalidWorkOrderError); });
});

describe('validateCapacity', () => {
  const { validateCapacity } = require('./work-order');
  const id = '11111111-1111-4111-8111-111111111107';
  const ok = { capacityPercent: 30, capacityStart: '2026-11-03', capacityEnd: '2026-11-07' };
  it('is required with a person from the list and keeps percent, dates and the on-purpose flag', () => {
    expect(validateCapacity(ok, id)).toEqual({ percent: 30, startDate: '2026-11-03', endDate: '2026-11-07', allowOverallocation: false });
    expect(validateCapacity({ ...ok, allowOverallocation: true }, id).allowOverallocation).toBe(true);
    expect(validateCapacity({ ...ok, capacityStart: '2026-11-03', capacityEnd: '2026-11-03', capacityPercent: 100 }, id)).toMatchObject({ percent: 100 });
  });
  it('is null without a person, and refuses data that would not be used', () => {
    expect(validateCapacity({}, null)).toBeNull();
    for (const extra of [{ capacityPercent: 30 }, { capacityStart: '2026-11-03' }, { capacityEnd: '2026-11-03' }, { allowOverallocation: true }]) expect(() => validateCapacity(extra, null)).toThrow(InvalidWorkOrderError);
  });
  it.each<[string, object]>([['no percent', { capacityPercent: undefined }], ['0', { capacityPercent: 0 }], ['101', { capacityPercent: 101 }], ['decimal', { capacityPercent: 1.5 }], ['text', { capacityPercent: '30' }], ['no start', { capacityStart: undefined }], ['no end', { capacityEnd: undefined }],
    ['impossible date', { capacityStart: '2026-02-30' }], ['text date', { capacityStart: 'mañana' }], ['end before start', { capacityEnd: '2026-11-02' }], ['too old', { capacityStart: '1999-12-31' }], ['too far', { capacityEnd: '2101-01-01' }],
    ['span over 1095 days', { capacityStart: '2026-01-01', capacityEnd: '2030-01-01' }], ['flag text', { allowOverallocation: 'si' }]])('refuses %s', (_n, over) => { expect(() => validateCapacity({ ...ok, ...over }, id)).toThrow(InvalidWorkOrderError); });
});
