import { decideRoleChange, normalizeEmail, normalizeName } from './user-admin';

describe('normalizeEmail / normalizeName', () => {
  it('lowercases and trims the email', () => { expect(normalizeEmail('  Carlos.PEREZ@Nexus.Example ')).toBe('carlos.perez@nexus.example'); });
  it('trims the name and collapses inner whitespace', () => { expect(normalizeName('  Carlos   Pérez\t Gómez ')).toBe('Carlos Pérez Gómez'); });
});

describe('decideRoleChange', () => {
  const base = { actorId: 'actor', targetId: 'target', targetRole: 'sales' as const, newRole: 'billing_analyst' as const, managerCount: 2 };

  it('allows changing someone else’s role', () => { expect(decideRoleChange(base)).toEqual({ ok: true, changed: true }); });
  it('is a no-op (ok, unchanged) when the role is already the requested one', () => {
    expect(decideRoleChange({ ...base, newRole: 'sales' })).toEqual({ ok: true, changed: false });
  });
  it('refuses to change your own role', () => {
    expect(decideRoleChange({ ...base, targetId: 'actor', targetRole: 'manager', newRole: 'sales' })).toEqual({ ok: false, reason: 'self' });
  });
  it('lets you "change" your own role to the one you already have (no-op, not an error)', () => {
    expect(decideRoleChange({ ...base, targetId: 'actor', targetRole: 'manager', newRole: 'manager' })).toEqual({ ok: true, changed: false });
  });
  it('refuses to demote the last manager', () => {
    expect(decideRoleChange({ ...base, targetRole: 'manager', newRole: 'sales', managerCount: 1 })).toEqual({ ok: false, reason: 'last_manager' });
    expect(decideRoleChange({ ...base, targetRole: 'manager', newRole: 'sales', managerCount: 0 })).toEqual({ ok: false, reason: 'last_manager' });
  });
  it('allows demoting a manager when another one remains', () => {
    expect(decideRoleChange({ ...base, targetRole: 'manager', newRole: 'sales', managerCount: 2 })).toEqual({ ok: true, changed: true });
  });
  it('allows promoting someone to manager', () => {
    expect(decideRoleChange({ ...base, newRole: 'manager', managerCount: 1 })).toEqual({ ok: true, changed: true });
  });
  it('checks "self" before "last manager" so the message names the real reason', () => {
    expect(decideRoleChange({ ...base, targetId: 'actor', targetRole: 'manager', newRole: 'sales', managerCount: 1 })).toEqual({ ok: false, reason: 'self' });
  });
});
