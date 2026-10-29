import { daysOverdue, isOverdue, utcDateString } from './overdue';

const issued = (due: string | null) => ({ status: 'issued' as const, dueDate: due === null ? null : new Date(due) });
const at = (iso: string) => new Date(iso);

describe('daysOverdue (calendar days, UTC; the same rule as the due date, the dashboard and the screen)', () => {
  it('the due day itself is NOT overdue yet, the next day is overdue by 1', () => {
    expect(daysOverdue(issued('2026-11-14T15:00:00Z'), at('2026-11-14T00:00:00Z'))).toBe(0);
    expect(daysOverdue(issued('2026-11-14T15:00:00Z'), at('2026-11-14T23:59:59.999Z'))).toBe(0);
    expect(daysOverdue(issued('2026-11-14T15:00:00Z'), at('2026-11-15T00:00:00Z'))).toBe(1);
  });
  it('counts whole calendar days, not hours: due 23:59 and checked 00:01 the next day is already 1 day', () => {
    expect(daysOverdue(issued('2026-11-14T23:59:00Z'), at('2026-11-15T00:01:00Z'))).toBe(1);
    expect(daysOverdue(issued('2026-11-14T00:00:00Z'), at('2026-11-15T23:59:59Z'))).toBe(1);
    expect(daysOverdue(issued('2026-11-14T12:00:00Z'), at('2026-11-17T00:00:01Z'))).toBe(3);
  });
  it('a year and a leap day are counted by the calendar', () => {
    expect(daysOverdue(issued('2027-02-27T10:00:00Z'), at('2027-03-02T10:00:00Z'))).toBe(3); // 2027 no es bisiesto
    expect(daysOverdue(issued('2028-02-27T10:00:00Z'), at('2028-03-02T10:00:00Z'))).toBe(4); // 2028 sí
    expect(daysOverdue(issued('2026-01-01T00:00:00Z'), at('2027-01-01T00:00:00Z'))).toBe(365);
  });
  it('a draft or an invoice without a due date is never overdue', () => {
    expect(daysOverdue({ status: 'draft', dueDate: new Date('2020-01-01T00:00:00Z') }, at('2026-11-15T00:00:00Z'))).toBe(0);
    expect(daysOverdue(issued(null), at('2026-11-15T00:00:00Z'))).toBe(0);
  });
  it('an invoice that is not due yet gives 0 (never a negative number)', () => {
    expect(daysOverdue(issued('2026-12-31T00:00:00Z'), at('2026-11-15T00:00:00Z'))).toBe(0);
  });
  it('isOverdue is simply "more than 0 days"', () => {
    expect(isOverdue(issued('2026-11-14T15:00:00Z'), at('2026-11-15T00:00:00Z'))).toBe(true);
    expect(isOverdue(issued('2026-11-14T15:00:00Z'), at('2026-11-14T23:00:00Z'))).toBe(false);
  });
  it('utcDateString is the UTC date, whatever the time', () => {
    expect(utcDateString(at('2026-11-14T23:59:59.999Z'))).toBe('2026-11-14');
    expect(utcDateString(at('2026-11-15T00:00:00.000Z'))).toBe('2026-11-15');
  });
});
