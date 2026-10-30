import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkConfiguration, warrantyState } from './configure';

const t = makeT('en');
const ok = { role: ' Switch  piso 2 ', criticality: 'Alta', ips: '10.0.2.5, 10.0.2.6', serial: '', warrantyUntil: '', assignedTo: '' };
describe('checkConfiguration (same rules as the server)', () => {
  it('accepts and cleans', () => { expect(checkConfiguration(t, ok).value).toEqual({ role: 'Switch piso 2', criticality: 'Alta', ips: '10.0.2.5; 10.0.2.6', warrantyUntil: '', assignedTo: '' }); });
  it('IPs are optional', () => { expect(checkConfiguration(t, { ...ok, ips: '  ' }).value?.ips).toBe(''); });
  it.each<[string, object, string]>([['role short', { role: 'a' }, 'role'], ['role markup', { role: '<b>' }, 'role'], ['role pending', { role: 'pendiente de configurar' }, 'role'], ['no criticality', { criticality: '' }, 'criticality'],
    ['bad ip', { ips: '10.0.0.256' }, 'ips'], ['repeated ip', { ips: '10.0.0.1 10.0.0.1' }, 'ips'], ['5 ips', { ips: '1.1.1.1 1.1.1.2 1.1.1.3 1.1.1.4 1.1.1.5' }, 'ips']])('rejects %s', (_n, over, key) => {
    expect((checkConfiguration(t, { ...ok, ...over }).errors as Record<string, string>)[key]).toBeTruthy();
  });
});

describe('serial, warranty and assignee', () => {
  const ok = { role: 'Switch piso 2', criticality: 'Alta', ips: '', serial: ' FOC2145X0AB ', warrantyUntil: '2028-11-30', assignedTo: '  Laura   Ríos ' };
  it('accepts and cleans them', () => { expect(checkConfiguration(t, ok).value).toEqual({ role: 'Switch piso 2', criticality: 'Alta', ips: '', serial: 'FOC2145X0AB', warrantyUntil: '2028-11-30', assignedTo: 'Laura Ríos' }); });
  it.each<[string, object, string]>([['serial short', { serial: 'ab' }, 'serial'], ['serial space', { serial: 'a b c' }, 'serial'], ['date impossible', { warrantyUntil: '2028-02-30' }, 'warrantyUntil'], ['date old', { warrantyUntil: '1999-01-01' }, 'warrantyUntil'],
    ['person markup', { assignedTo: '<b>x</b>' }, 'assignedTo'], ['person short', { assignedTo: 'A' }, 'assignedTo']])('rejects %s', (_n, over, key) => { expect((checkConfiguration(t, { ...ok, ...over }).errors as Record<string, string>)[key]).toBeTruthy(); });
  it('warranty state: expired, soon (30 days) or ok', () => {
    expect(warrantyState(null, '2026-10-30')).toBeNull(); expect(warrantyState('2026-10-29', '2026-10-30')).toBe('expired'); expect(warrantyState('2026-10-30', '2026-10-30')).toBe('soon');
    expect(warrantyState('2026-11-29', '2026-10-30')).toBe('soon'); expect(warrantyState('2026-11-30', '2026-10-30')).toBe('ok');
  });
});
