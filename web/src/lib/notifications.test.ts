import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { notificationText } from './notifications';
import type { NotificationItem } from './types';

const item = (kind: string, params: any): NotificationItem => ({ id: 'x', kind, severity: 'warning', params, occurredAt: '2026-11-20T00:00:00Z', read: false });

describe('notificationText', () => {
  const overdue = item('OverdueDetected', { invoiceNumber: 'INV-0103', projectName: 'Branch network upgrade', milestoneName: 'Link design', totalCop: 22_015_000, daysOverdue: 3 });
  it('writes an overdue invoice in each language', () => {
    expect(notificationText(overdue, makeT('es'), 'es')).toBe('La factura INV-0103 de «Branch network upgrade» (Link design) lleva 3 días vencida · 22.015.000 COP con IVA');
    expect(notificationText(overdue, makeT('en'), 'en')).toBe('Invoice INV-0103 of “Branch network upgrade” (Link design) is 3 days overdue · 22.015.000 COP with IVA');
  });
  it('writes a threshold alert', () => {
    const n = item('ThresholdBreached', { deviceName: 'Cold room sensor', location: 'Bogotá', readingKind: 'temperature', value: 31.5, unit: '°C', status: 'ALERT' });
    expect(notificationText(n, makeT('en'), 'en')).toBe('Cold room sensor in Bogotá: temperature at 31.5 °C (ALERT)');
  });
  it('writes an over-allocation with readable dates', () => {
    const n = item('OverAllocationDetected', { engineerName: 'Ing. Example', allocationPercent: 120, periodStart: '2026-11-01', periodEnd: '2026-11-30' });
    expect(notificationText(n, makeT('es'), 'es')).toBe('Ing. Example está asignado al 120 % entre 1 nov 2026 y 30 nov 2026');
  });
  it('a kind from a future version says “new notification” instead of breaking', () => {
    expect(notificationText(item('Surprise', {}), makeT('es'), 'es')).toBe('Aviso nuevo');
  });
  it('missing or strange params never crash and never print undefined', () => {
    const text = notificationText(item('OverdueDetected', { projectName: { a: 1 }, daysOverdue: 'x' }), makeT('en'), 'en');
    expect(text).not.toContain('undefined'); expect(text).not.toContain('[object');
  });
});
