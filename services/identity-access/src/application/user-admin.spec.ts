import { StaffRoleError, CannotChangeOwnRoleError, EmailTakenError, LastManagerError, NotAManagerError, UserNotFoundError, WeakPasswordError } from '../domain/errors';
import { NewUser, PasswordHasher, RoleChangeTx, UserAdminStore, UserSummary } from '../domain/ports';
import { IdentityEvent } from '../domain/events';
import { Role } from '../domain/role';
import { ChangeRoleUseCase, CreateUserUseCase, ListUsersUseCase } from './user-admin.use-cases';

/** Base falsa en memoria: guarda usuarios y cuenta cuántas veces se escribió y si una operación corrió dentro de «runRoleChange». */
class FakeStore implements UserAdminStore {
  users = new Map<string, UserSummary & { passwordHash?: string }>();
  writes = 0;
  /** Lo que quedó en el outbox: se descarta junto con la transacción si algo falla. */
  events: IdentityEvent[] = [];
  insideTx = false;
  setRoleOutsideTx = 0;
  constructor(seed: [string, string, Role][] = []) { seed.forEach(([id, email, role]) => this.users.set(id, { id, email, name: email.split('@')[0], role, staffId: null, createdAt: new Date('2026-10-19T10:00:00Z') })); }
  async isManager(id: string) { return this.users.get(id)?.role === 'manager'; }
  async list() { return [...this.users.values()].map(({ passwordHash: _p, ...u }) => u); }
  async create(u: NewUser, makeEvent?: (c: UserSummary) => IdentityEvent) {
    if ([...this.users.values()].some((x) => x.email === u.email)) throw new EmailTakenError();
    const id = `id-${this.users.size + 1}`; this.writes++;
    const row = { id, email: u.email, name: u.name, role: u.role, staffId: u.staffId, createdAt: new Date('2026-10-19T11:00:00Z'), passwordHash: u.passwordHash };
    this.users.set(id, row); const { passwordHash: _p, ...summary } = row;
    if (makeEvent) this.events.push(makeEvent(summary));
    return summary;
  }
  private queue: Promise<unknown> = Promise.resolve();
  /** Una transacción a la vez: es lo que garantiza SELECT … FOR UPDATE sobre las filas de los gerentes en PostgreSQL. */
  runRoleChange<T>(work: (tx: RoleChangeTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.runLocked(work));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async runLocked<T>(work: (tx: RoleChangeTx) => Promise<T>): Promise<T> {
    this.insideTx = true;
    const snapshot = new Map([...this.users].map(([k, v]) => [k, { ...v }]));
    const eventsBefore = this.events.length;
    try {
      return await work({
        findById: async (id) => { const u = this.users.get(id); return u ? { id: u.id, email: u.email, name: u.name, role: u.role, staffId: u.staffId, createdAt: u.createdAt } : null; },
        countManagers: async () => [...this.users.values()].filter((u) => u.role === 'manager').length,
        setRole: async (id, role) => { this.writes++; const u = this.users.get(id)!; u.role = role; return { id: u.id, email: u.email, name: u.name, role: u.role, staffId: u.staffId, createdAt: u.createdAt }; },
        addToOutbox: async (ev) => { this.events.push(ev); },
      });
    } catch (e) { this.users = snapshot; this.events.length = eventsBefore; throw e; } finally { this.insideTx = false; }
  }
}
const hasher: PasswordHasher & { calls: string[] } = { calls: [], verify: async () => true, hash: async function (p) { hasher.calls.push(p); return `hashed:${p}`; } };
const ADMIN = 'admin';
const seed = (): FakeStore => new FakeStore([[ADMIN, 'diana.vega@nexus.example', 'manager'], ['m2', 'otra.gerente@nexus.example', 'manager'], ['s1', 'camila.soto@nexus.example', 'sales'], ['l1', 'laura.rios@nexus.example', 'project_lead']]);

describe('ListUsersUseCase', () => {
  it('lists users for a manager, never with a password hash', async () => {
    const out = await new ListUsersUseCase(seed()).execute(ADMIN);
    expect(out).toHaveLength(4);
    expect(JSON.stringify(out)).not.toMatch(/password|hash/i);
  });
  it('refuses someone who is no longer a manager in the database even if their token still says so', async () => {
    await expect(new ListUsersUseCase(seed()).execute('s1')).rejects.toBeInstanceOf(NotAManagerError);
    await expect(new ListUsersUseCase(seed()).execute('ghost')).rejects.toBeInstanceOf(NotAManagerError);
  });
});

describe('CreateUserUseCase', () => {
  const make = (s = seed()) => ({ s, uc: new CreateUserUseCase(s, hasher) });
  beforeEach(() => { hasher.calls.length = 0; });

  it('creates the user with a normalized email and name, and stores only the hash', async () => {
    const { s, uc } = make();
    const out = await uc.execute(ADMIN, { email: '  Carlos.PEREZ@Nexus.Example ', name: '  Carlos   Pérez ', role: 'sales', password: 'correct horse battery' });
    expect(out).toMatchObject({ email: 'carlos.perez@nexus.example', name: 'Carlos Pérez', role: 'sales' });
    expect(JSON.stringify(out)).not.toMatch(/password|hash|correct horse/i);
    expect([...s.users.values()].find((u) => u.email === 'carlos.perez@nexus.example')?.passwordHash).toBe('hashed:correct horse battery');
  });
  it('rejects a weak password before hashing or writing anything', async () => {
    const { s, uc } = make();
    for (const [pw, problem] of [['short', 'too_short'], ['aaaaaaaaaaaaaa', 'too_simple'], ['carlos.perez-1234', 'contains_email'], [' leading space ok', 'edge_spaces']] as const) {
      const err: any = await uc.execute(ADMIN, { email: 'carlos.perez@nexus.example', name: 'Carlos', role: 'sales', password: pw }).catch((e) => e);
      expect(err).toBeInstanceOf(WeakPasswordError); expect(err.problem).toBe(problem);
    }
    expect(hasher.calls).toEqual([]); expect(s.writes).toBe(0);
  });
  it('rejects an email that already exists, whatever its case', async () => {
    const { s, uc } = make();
    await expect(uc.execute(ADMIN, { email: 'CAMILA.SOTO@nexus.example', name: 'Otra', role: 'sales', password: 'correct horse battery' })).rejects.toBeInstanceOf(EmailTakenError);
    expect(s.writes).toBe(0);
  });
  it('refuses a caller who is not a manager now and writes nothing', async () => {
    const { s, uc } = make();
    await expect(uc.execute('s1', { email: 'x.y@nexus.example', name: 'X', role: 'manager', password: 'correct horse battery' })).rejects.toBeInstanceOf(NotAManagerError);
    expect(s.writes).toBe(0); expect(hasher.calls).toEqual([]);
  });
});

describe('ChangeRoleUseCase', () => {
  const make = (s = seed()) => ({ s, uc: new ChangeRoleUseCase(s) });
  it('changes another user’s role inside the locked transaction', async () => {
    const { s, uc } = make();
    const out = await uc.execute(ADMIN, 's1', 'billing_analyst');
    expect(out.role).toBe('billing_analyst'); expect(s.users.get('s1')?.role).toBe('billing_analyst'); expect(s.insideTx).toBe(false);
  });
  it('does nothing when the role is already the requested one', async () => {
    const { s, uc } = make(); const out = await uc.execute(ADMIN, 's1', 'sales');
    expect(out.role).toBe('sales'); expect(s.writes).toBe(0);
  });
  it('refuses to change your own role', async () => {
    await expect(make().uc.execute(ADMIN, ADMIN, 'sales')).rejects.toBeInstanceOf(CannotChangeOwnRoleError);
  });
  it('a manager demoted a moment ago cannot demote anyone with the old token (the caller is re-read inside the transaction)', async () => {
    const s = seed(); const uc = new ChangeRoleUseCase(s);
    await uc.execute(ADMIN, 'm2', 'sales'); // el administrador baja a la otra gerente
    await expect(uc.execute('m2', ADMIN, 'sales')).rejects.toBeInstanceOf(NotAManagerError); // su token sigue vigente, pero ya no es gerente
    expect(s.users.get(ADMIN)?.role).toBe('manager'); // sigue habiendo un gerente
  });
  it('two managers demoting each other one after the other leave exactly one manager', async () => {
    const s = new FakeStore([['a', 'a@nexus.example', 'manager'], ['b', 'b@nexus.example', 'manager']]); const uc = new ChangeRoleUseCase(s);
    const results = await Promise.allSettled([uc.execute('a', 'b', 'sales'), uc.execute('b', 'a', 'sales')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([...s.users.values()].filter((u) => u.role === 'manager')).toHaveLength(1);
  });
  it('answers 404-style for a user that does not exist', async () => {
    await expect(make().uc.execute(ADMIN, 'nope', 'sales')).rejects.toBeInstanceOf(UserNotFoundError);
  });
  it('rolls back everything if the work fails in the middle', async () => {
    const s = seed(); const before = JSON.stringify([...s.users]);
    await expect(s.runRoleChange(async (tx) => { await tx.setRole('s1', 'manager'); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(JSON.stringify([...s.users])).toBe(before);
  });
});

describe('engineer and technician accounts (staff roles)', () => {
  const STAFF = '11111111-1111-4111-8111-111111111101';
  const make = (s = seed()) => ({ s, uc: new CreateUserUseCase(s, hasher), role: new ChangeRoleUseCase(s) });
  const pw = 'correct horse battery';
  it('creates an engineer or a technician only with the staff member it belongs to, stored in lowercase', async () => {
    const { uc } = make();
    const a = await uc.execute(ADMIN, { email: 'ana@nexus.example', name: 'Ana', role: 'engineer', password: pw, staffId: STAFF.toUpperCase() });
    expect(a).toMatchObject({ role: 'engineer', staffId: STAFF });
    expect(await uc.execute(ADMIN, { email: 'hugo@nexus.example', name: 'Hugo', role: 'technician', password: pw, staffId: '11111111-1111-4111-8111-111111111107' })).toMatchObject({ role: 'technician' });
  });
  it.each([['engineer without staff', 'engineer', undefined], ['technician with empty staff', 'technician', ''], ['engineer with a bad id', 'engineer', 'zz'], ['sales with a staff member', 'sales', STAFF], ['manager with a staff member', 'manager', STAFF], ['finance with a staff member', 'finance', STAFF]] as const)('refuses %s and writes nothing', async (_n, role, staffId) => {
    const { s, uc } = make();
    await expect(uc.execute(ADMIN, { email: 'x@nexus.example', name: 'X', role, password: pw, staffId: staffId as any })).rejects.toBeInstanceOf(StaffRoleError);
    expect(s.writes).toBe(0);
  });
  it('a staff account never changes role, and nobody becomes staff by a role change; repeating the same role is harmless', async () => {
    const { s, uc, role } = make();
    const eng = await uc.execute(ADMIN, { email: 'ana@nexus.example', name: 'Ana', role: 'engineer', password: pw, staffId: STAFF });
    const before = s.writes;
    for (const to of ['sales', 'technician', 'manager'] as const) await expect(role.execute(ADMIN, eng.id, to)).rejects.toBeInstanceOf(StaffRoleError);
    await expect(role.execute(ADMIN, 's1', 'engineer')).rejects.toBeInstanceOf(StaffRoleError);
    await expect(role.execute(ADMIN, 's1', 'technician')).rejects.toBeInstanceOf(StaffRoleError);
    expect((await role.execute(ADMIN, eng.id, 'engineer')).role).toBe('engineer');
    expect(s.writes).toBe(before);
  });
});

describe('user events (UserCreated, RoleChanged) in the outbox', () => {
  const CTX = { actorEmail: 'diana.vega@nexus.example', correlationId: 'trace-user-0001' };
  const newUser = { email: 'carlos.perez@nexus.example', name: 'Carlos Pérez', role: 'sales' as Role, password: 'correct horse battery' };

  it('creating a user leaves ONE UserCreated with the person, role, who did it and the trace, and never the email or the password', async () => {
    const s = seed();
    const out = await new CreateUserUseCase(s, hasher).execute(ADMIN, newUser, CTX);
    expect(s.events).toHaveLength(1);
    const ev = s.events[0];
    expect(ev).toMatchObject({ type: 'UserCreated', correlationId: 'trace-user-0001', data: { userId: out.id, userName: 'Carlos Pérez', role: 'sales', staffId: null, createdBy: 'diana.vega@nexus.example' } });
    expect(JSON.stringify(ev)).not.toMatch(/carlos\.perez@|correct horse|hash|password/i);
    expect(ev.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('without a context it still works: the trace is «no-correlation» and there is no createdBy', async () => {
    const s = seed();
    await new CreateUserUseCase(s, hasher).execute(ADMIN, newUser);
    expect(s.events[0].correlationId).toBe('no-correlation');
    expect((s.events[0].data as any).createdBy).toBeUndefined();
  });
  it('a refused creation (weak password, taken email, not a manager) leaves NO event', async () => {
    const s = seed(); const uc = new CreateUserUseCase(s, hasher);
    await uc.execute(ADMIN, { ...newUser, password: 'short' }).catch(() => undefined);
    await uc.execute(ADMIN, { ...newUser, email: 'laura.rios@nexus.example' }).catch(() => undefined);
    await uc.execute('s1', newUser).catch(() => undefined);
    expect(s.events).toHaveLength(0);
  });
  it('a role change leaves ONE RoleChanged with the previous and the new role, who did it and the trace, and not the person’s email', async () => {
    const s = seed();
    await new ChangeRoleUseCase(s).execute(ADMIN, 's1', 'manager', CTX);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ type: 'RoleChanged', correlationId: 'trace-user-0001', data: { userId: 's1', previousRole: 'sales', role: 'manager', changedBy: 'diana.vega@nexus.example' } });
    expect(JSON.stringify(s.events[0])).not.toMatch(/camila\.soto@/i);
  });
  it('the same role again, changing your own role and demoting the last manager leave NO event', async () => {
    const s = seed(); const uc = new ChangeRoleUseCase(s);
    await uc.execute(ADMIN, 's1', 'sales', CTX);
    await uc.execute(ADMIN, ADMIN, 'sales', CTX).catch(() => undefined);
    const solo = new FakeStore([[ADMIN, 'diana.vega@nexus.example', 'manager'], ['x', 'x@nexus.example', 'sales']]);
    await new ChangeRoleUseCase(solo).execute('x', ADMIN, 'sales', CTX).catch(() => undefined);
    expect(s.events).toHaveLength(0); expect(solo.events).toHaveLength(0);
  });
  it('two changes of the same person are two different events (each change is its own fact)', async () => {
    const s = seed(); const uc = new ChangeRoleUseCase(s);
    await uc.execute(ADMIN, 's1', 'finance', CTX); await uc.execute(ADMIN, 's1', 'sales', CTX);
    expect(s.events.map((e) => (e.data as any).role)).toEqual(['finance', 'sales']);
    expect(new Set(s.events.map((e) => e.eventId)).size).toBe(2);
  });
});
