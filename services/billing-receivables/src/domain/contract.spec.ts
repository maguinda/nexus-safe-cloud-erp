import { canChangeStatus, validateContract } from './contract';
import { InvalidContractError } from './errors';

const ok = { clientName: 'Retail Norte (example)', projectName: 'Branch network upgrade', amountCop: 120_000_000, startDate: '2026-11-01', endDate: '2027-05-01' };
describe('validateContract', () => {
  it('accepts a valid contract and cleans the spaces', () => {
    expect(validateContract({ ...ok, clientName: '  Retail   Norte  ' }).clientName).toBe('Retail Norte');
    expect(validateContract({ ...ok, endDate: '2026-11-01' }).endDate).toBe('2026-11-01'); // un día de vigencia
  });
  it.each<[string, object]>([
    ['short client', { clientName: 'A' }], ['client with <', { clientName: '<b>x</b>' }], ['no project', { projectName: '' }], ['long project', { projectName: 'x'.repeat(121) }],
    ['control character', { clientName: 'Ret\u0000ail' }], ['amount 0', { amountCop: 0 }], ['negative', { amountCop: -5 }], ['decimal', { amountCop: 10.5 }], ['text amount', { amountCop: '100' }],
    ['over int32', { amountCop: 2_147_483_648 }], ['NaN', { amountCop: NaN }], ['bad date', { startDate: '2026-13-01' }], ['not a real day', { startDate: '2026-02-30' }], ['no dash', { endDate: '20270501' }],
    ['end before start', { endDate: '2026-10-31' }], ['null date', { startDate: null }],
  ])('refuses %s', (_n, over) => { expect(() => validateContract({ ...ok, ...over } as any)).toThrow(InvalidContractError); });
  it('only an active contract can be closed or cancelled', () => {
    expect(canChangeStatus('active', 'closed')).toBe(true); expect(canChangeStatus('active', 'cancelled')).toBe(true);
    for (const f of ['closed', 'cancelled'] as const) for (const t of ['active', 'closed', 'cancelled'] as const) expect(canChangeStatus(f, t)).toBe(false);
    expect(canChangeStatus('active', 'active')).toBe(false);
  });
});
