import { InvalidConfigurationError, validateConfiguration } from './configure';

const ok = { role: '  Switch de acceso   piso 2 ', criticality: 'Alta', ips: '10.0.2.5; 10.0.2.6' };
describe('validateConfiguration', () => {
  it('accepts a complete configuration and cleans it', () => { expect(validateConfiguration(ok)).toEqual({ role: 'Switch de acceso piso 2', criticality: 'Alta', ips: '10.0.2.5; 10.0.2.6' }); });
  it('IPs are optional and normalised (commas and spaces become "; ")', () => {
    expect(validateConfiguration({ ...ok, ips: undefined }).ips).toBeNull(); expect(validateConfiguration({ ...ok, ips: '' }).ips).toBeNull();
    expect(validateConfiguration({ ...ok, ips: '10.0.0.1, 10.0.0.2 192.168.1.254' }).ips).toBe('10.0.0.1; 10.0.0.2; 192.168.1.254');
  });
  it.each<[string, object]>([['role empty', { role: '' }], ['role short', { role: 'a' }], ['role long', { role: 'x'.repeat(61) }], ['role markup', { role: '<b>x</b>' }], ['role pending', { role: 'pendiente DE configurar' }],
    ['role number', { role: 5 }], ['criticality unknown', { criticality: 'Baja' }], ['criticality missing', { criticality: undefined }], ['ip bad', { ips: '10.0.0.256' }], ['ip text', { ips: 'abc' }], ['ip 3 octets', { ips: '10.0.0' }],
    ['ip repeated', { ips: '10.0.0.1; 10.0.0.1' }], ['5 ips', { ips: '10.0.0.1 10.0.0.2 10.0.0.3 10.0.0.4 10.0.0.5' }], ['ips number', { ips: 5 }], ['ip injection', { ips: "10.0.0.1'; DROP" }],
  ])('refuses %s', (_n, over) => { expect(() => validateConfiguration({ ...ok, ...over })).toThrow(InvalidConfigurationError); });
  describe('unit assets: serial, warranty and assignee', () => {
    it('keeps what is not sent untouched (undefined) and clears with empty or null', () => {
      const a = validateConfiguration(ok); expect('serial' in a).toBe(false); expect('warrantyUntil' in a).toBe(false); expect('assignedTo' in a).toBe(false);
      expect(validateConfiguration({ ...ok, warrantyUntil: '', assignedTo: null })).toMatchObject({ warrantyUntil: null, assignedTo: null });
    });
    it('accepts and cleans a full set', () => {
      expect(validateConfiguration({ ...ok, serial: ' FOC2145X0AB ', warrantyUntil: '2028-11-30', assignedTo: '  Laura   Ríos ' })).toMatchObject({ serial: 'FOC2145X0AB', warrantyUntil: '2028-11-30', assignedTo: 'Laura Ríos' });
    });
    it.each<[string, object]>([['serial short', { serial: 'ab' }], ['serial with space', { serial: 'AB 12 34' }], ['serial long', { serial: 'A'.repeat(41) }], ['serial injection', { serial: "A1';DROP" }], ['serial number', { serial: 5 }],
      ['date impossible', { warrantyUntil: '2028-02-30' }], ['date text', { warrantyUntil: 'mañana' }], ['date too old', { warrantyUntil: '1999-12-31' }], ['date too far', { warrantyUntil: '2101-01-01' }], ['date number', { warrantyUntil: 20281130 }],
      ['person short', { assignedTo: 'A' }], ['person markup', { assignedTo: '<b>x</b>' }], ['person long', { assignedTo: 'x'.repeat(81) }], ['person control', { assignedTo: 'a\u0000b' }], ['person number', { assignedTo: 5 }],
    ])('refuses %s', (_n, over) => { expect(() => validateConfiguration({ ...ok, ...over })).toThrow(InvalidConfigurationError); });
  });
});
