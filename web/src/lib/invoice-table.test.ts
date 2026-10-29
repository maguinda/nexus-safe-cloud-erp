import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { countByStatus, dueChip, dueState, filterInvoices, sortInvoices } from './invoice-table';
import type { SortKey } from './invoice-table';
import type { Invoice } from './types';

const inv = (number: string, o: Partial<Invoice> = {}): Invoice => ({
  number, projectName: 'Branch network upgrade', milestoneName: 'Site survey', amountCop: 1000, taxCop: 190, totalCop: 1190,
  status: 'issued', createdAt: '2026-10-18T10:00:00.000Z', dueDate: '2026-11-17T10:00:00.000Z', clientName: null, electronicStatus: 'not_applicable', ...o,
});
const draft = (number: string, o: Partial<Invoice> = {}) => inv(number, { status: 'draft', dueDate: null, ...o });
const nums = (l: Invoice[]) => l.map((i) => i.number);

describe('filterInvoices', () => {
  const list = [inv('INV-0101'), draft('INV-0103', { projectName: 'Warehouse Wi-Fi rollout', milestoneName: 'Cutover' }), inv('INV-0102', { projectName: 'Retail POS integration', milestoneName: 'API contract' })];
  it('returns everything for the "all" status and an empty query', () => { expect(nums(filterInvoices(list, { status: 'all', query: '' }))).toEqual(['INV-0101', 'INV-0103', 'INV-0102']); });
  it.each([['draft', ['INV-0103']], ['issued', ['INV-0101', 'INV-0102']]] as const)('filters by status %s', (status, expected) => {
    expect(nums(filterInvoices(list, { status, query: '' }))).toEqual(expected);
  });
  it.each([['inv-0102', ['INV-0102']], ['WAREHOUSE', ['INV-0103']], ['  cutover  ', ['INV-0103']], ['pos', ['INV-0102']], ['site survey', ['INV-0101']]] as [string, string[]][])('searches number, project and milestone, ignoring case and spaces: %j', (query, expected) => {
    expect(nums(filterInvoices(list, { status: 'all', query }))).toEqual(expected);
  });
  it('combines status and search', () => { expect(nums(filterInvoices(list, { status: 'issued', query: 'site' }))).toEqual(['INV-0101']); });
  it('returns an empty list when nothing matches and does not touch the input', () => {
    const copy = [...list];
    expect(filterInvoices(list, { status: 'all', query: 'zzz' })).toEqual([]);
    expect(list).toEqual(copy);
  });
});

describe('sortInvoices', () => {
  it('sorts invoice numbers as numbers, not as text', () => {
    const l = [inv('INV-0100'), inv('INV-0099'), inv('INV-1000')];
    expect(nums(sortInvoices(l, 'number', 'asc'))).toEqual(['INV-0099', 'INV-0100', 'INV-1000']);
    expect(nums(sortInvoices(l, 'number', 'desc'))).toEqual(['INV-1000', 'INV-0100', 'INV-0099']);
  });
  it('sorts by total and by project name', () => {
    const l = [inv('A', { totalCop: 500, projectName: 'Zeta' }), inv('B', { totalCop: 90, projectName: 'Alfa' }), inv('C', { totalCop: 1_000_000, projectName: 'Mike' })];
    expect(nums(sortInvoices(l, 'total', 'asc'))).toEqual(['B', 'A', 'C']);
    expect(nums(sortInvoices(l, 'total', 'desc'))).toEqual(['C', 'A', 'B']);
    expect(nums(sortInvoices(l, 'project', 'asc'))).toEqual(['B', 'C', 'A']);
  });
  it('sorts by creation time', () => {
    const l = [inv('A', { createdAt: '2026-10-15T00:00:00Z' }), inv('B', { createdAt: '2026-10-19T00:00:00Z' }), inv('C', { createdAt: '2026-10-12T00:00:00Z' })];
    expect(nums(sortInvoices(l, 'created', 'desc'))).toEqual(['B', 'A', 'C']);
    expect(nums(sortInvoices(l, 'created', 'asc'))).toEqual(['C', 'A', 'B']);
  });
  it('puts drafts (no due date) last in BOTH directions', () => {
    const l = [draft('D1'), inv('A', { dueDate: '2026-12-01T00:00:00Z' }), inv('B', { dueDate: '2026-11-01T00:00:00Z' }), draft('D2')];
    expect(nums(sortInvoices(l, 'due', 'asc'))).toEqual(['B', 'A', 'D1', 'D2']);
    expect(nums(sortInvoices(l, 'due', 'desc'))).toEqual(['A', 'B', 'D1', 'D2']);
  });
  it('is stable for equal keys and does not mutate the input', () => {
    const l = [inv('A', { totalCop: 5 }), inv('B', { totalCop: 5 }), inv('C', { totalCop: 5 })];
    const before = nums(l);
    expect(nums(sortInvoices(l, 'total', 'asc'))).toEqual(['A', 'B', 'C']);
    expect(nums(sortInvoices(l, 'total', 'desc'))).toEqual(['A', 'B', 'C']);
    expect(nums(l)).toEqual(before);
  });
});

describe('dueState (UTC calendar days)', () => {
  const now = Date.parse('2026-11-10T15:00:00Z');
  it.each([
    [null, 'none', null],
    ['2026-11-09T23:59:59Z', 'overdue', -1],
    ['2026-11-10T00:00:00Z', 'soon', 0],
    ['2026-11-10T23:59:59Z', 'soon', 0],
    ['2026-11-17T10:00:00Z', 'soon', 7],
    ['2026-11-18T10:00:00Z', 'ok', 8],
    ['2026-10-31T10:00:00Z', 'overdue', -10],
  ] as [string | null, string, number | null][])('%s -> %s', (due, state, days) => {
    expect(dueState(due, now)).toEqual({ state, days });
  });
  it('does not depend on the time of day: late in the evening UTC the day count is the same', () => {
    expect(dueState('2026-11-11T01:00:00Z', Date.parse('2026-11-10T23:59:00Z'))).toEqual({ state: 'soon', days: 1 });
  });
});

describe('countByStatus', () => {
  it('counts all, draft and issued', () => { expect(countByStatus([inv('A'), draft('B'), inv('C')])).toEqual({ all: 3, draft: 1, issued: 2 }); });
  it('is all zeros for an empty list', () => { expect(countByStatus([])).toEqual({ all: 0, draft: 0, issued: 0 }); });
});

describe('dueChip: the text of the chip, in the language of the screen', () => {
  const now = Date.parse('2026-11-10T15:00:00Z');
  const en = makeT('en'), es = makeT('es');
  const chip = (due: string | null, t = en) => dueChip(dueState(due, now), t);
  it.each([
    ['2026-11-09T23:59:59Z', 'Overdue 1 d', 'Vencida hace 1 d'],
    ['2026-10-31T10:00:00Z', 'Overdue 10 d', 'Vencida hace 10 d'],
    ['2026-11-10T23:59:59Z', 'Due today', 'Vence hoy'],
    ['2026-11-13T10:00:00Z', 'In 3 d', 'En 3 d'],
    ['2026-11-17T10:00:00Z', 'In 7 d', 'En 7 d'],
  ])('%s', (due, english, spanish) => { expect(chip(due)).toBe(english); expect(chip(due, es)).toBe(spanish); });
  it.each([[null], ['2026-11-18T10:00:00Z'], ['2027-01-01T00:00:00Z']])('no chip when there is nothing to warn about (%s)', (due) => { expect(chip(due)).toBeNull(); expect(chip(due, es)).toBeNull(); });
  it('the English text matches what the screen showed before the translation (the browser tests look for /^Overdue \\d+ d$/)', () => { expect(chip('2026-11-01T00:00:00Z')).toMatch(/^Overdue \d+ d$/); });
});

describe('the invoices dictionary', () => {
  const en = makeT('en'), es = makeT('es');
  it.each<SortKey>(['number', 'project', 'total', 'due', 'created'])('has a name for the sort key «%s» in both languages (it goes into the table caption)', (k) => {
    const key = `invoices.key.${k}` as const;
    expect(en(key)).toBe(k);
    expect(es(key)).not.toBe('');
  });
  it('the table caption reads the same in English as before and in Spanish now', () => {
    expect(en('invoices.caption', { key: 'created', dir: 'descending' })).toBe('Invoices, sorted by created (descending)');
    expect(en('invoices.captionFiltered', { key: 'due', dir: 'ascending' })).toBe('Invoices, sorted by due (ascending), filtered');
    expect(es('invoices.caption', { key: 'creación', dir: 'descendente' })).toBe('Facturas, ordenadas por creación (descendente)');
  });
  it('messages with values keep the English wording', () => {
    expect(en('invoices.toast.issued', { n: 'INV-0103' })).toBe('INV-0103 issued');
    expect(en('invoices.toast.notDraft', { n: 'INV-0103' })).toBe('INV-0103 is not a draft anymore.');
    expect(en('invoices.showing', { shown: 1, total: 4 })).toBe('Showing 1 of 4');
    expect(en('invoices.sortBy', { label: 'Due' })).toBe('Sort by Due');
    expect(en('invoices.note', { created: en('invoices.col.created') })).toBe('A draft shows up a moment after a milestone is approved. The “Created” column says how fresh each row is.');
    expect(es('invoices.note', { created: es('invoices.col.created') })).toContain('«Creada»');
  });
  it('the 403 panel names the role in the language of the screen', () => {
    expect(en('invoices.denied.body', { role: en('role.sales') })).toBe('Your role (Sales) cannot read invoices. The API checks the role on every request, not only the menu.');
    expect(es('invoices.denied.body', { role: es('role.sales') })).toBe('Tu rol (Ventas) no puede ver las facturas. La API revisa el rol en cada solicitud, no solo en el menú.');
  });
});
