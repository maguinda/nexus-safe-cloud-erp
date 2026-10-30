import { describe, expect, it } from 'vitest';
import { makeT } from '../i18n';
import { checkConfiguration } from './configure';

const t = makeT('en');
const ok = { role: ' Switch  piso 2 ', criticality: 'Alta', ips: '10.0.2.5, 10.0.2.6' };
describe('checkConfiguration (same rules as the server)', () => {
  it('accepts and cleans', () => { expect(checkConfiguration(t, ok).value).toEqual({ role: 'Switch piso 2', criticality: 'Alta', ips: '10.0.2.5; 10.0.2.6' }); });
  it('IPs are optional', () => { expect(checkConfiguration(t, { ...ok, ips: '  ' }).value?.ips).toBe(''); });
  it.each<[string, object, string]>([['role short', { role: 'a' }, 'role'], ['role markup', { role: '<b>' }, 'role'], ['role pending', { role: 'pendiente de configurar' }, 'role'], ['no criticality', { criticality: '' }, 'criticality'],
    ['bad ip', { ips: '10.0.0.256' }, 'ips'], ['repeated ip', { ips: '10.0.0.1 10.0.0.1' }, 'ips'], ['5 ips', { ips: '1.1.1.1 1.1.1.2 1.1.1.3 1.1.1.4 1.1.1.5' }, 'ips']])('rejects %s', (_n, over, key) => {
    expect((checkConfiguration(t, { ...ok, ...over }).errors as Record<string, string>)[key]).toBeTruthy();
  });
});
