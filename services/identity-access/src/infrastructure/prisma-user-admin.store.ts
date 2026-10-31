import { Prisma, PrismaClient } from '@prisma/client';
import { EmailTakenError, StaffTakenError } from '../domain/errors';
import { NewUser, RoleChangeTx, UserAdminStore, UserSummary } from '../domain/ports';
import { Role } from '../domain/role';
import { IdentityEvent, routingKeyOf } from '../domain/events';

const SUMMARY = { id: true, email: true, name: true, role: true, staffId: true, createdAt: true } as const; // sin passwordHash: nunca sale de aquí

/** Cuánto espera una petición su turno (por una conexión y por el bloqueo) antes de rendirse: una ráfaga de cambios de rol debe formarse en fila, no fallar. */
const ROLE_CHANGE_TX = { maxWait: 20_000, timeout: 20_000 };

export class PrismaUserAdminStore implements UserAdminStore {
  constructor(private readonly prisma: PrismaClient) {}

  async isManager(id: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    return row?.role === 'manager';
  }

  list(): Promise<UserSummary[]> {
    return this.prisma.user.findMany({ select: SUMMARY, orderBy: [{ createdAt: 'asc' }, { email: 'asc' }] });
  }

  async create(user: NewUser, makeEvent?: (created: UserSummary) => IdentityEvent): Promise<UserSummary> {
    try {
      if (!makeEvent) return await this.prisma.user.create({ data: user, select: SUMMARY });
      // El alta y su evento en UNA transacción: nunca hay una persona creada sin evento, ni un evento de una persona que no existe.
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: user, select: SUMMARY });
        const ev = makeEvent(created);
        await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId: created.id, type: ev.type, routingKey: routingKeyOf(ev), payload: ev as any } });
        return created;
      });
    } catch (e) {
      // Carrera entre dos altas del mismo email: la restricción única de la base decide y gana una sola.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw (String(e.meta?.target ?? '').includes('staff_id') ? new StaffTakenError() : new EmailTakenError());
      throw e;
    }
  }

  /**
   * Se bloquean todas las filas de los gerentes (en orden por id) antes de leer nada. Como TODO cambio de rol exige ser gerente,
   * todos pasan por ese mismo bloqueo y se ejecutan de uno en uno: no hace falta bloquear además la fila de quien llama ni la del usuario.
   * Todo lo que el caso de uso lee ocurre ya dentro del bloqueo, así que ve el estado real aunque otra petición esté a punto de cambiarlo.
   */
  runRoleChange<T>(work: (tx: RoleChangeTx) => Promise<T>): Promise<T> {
    // Los cambios de rol se ejecutan de uno en uno, así que los demás ESPERAN su turno. Prisma por defecto da 2 s para conseguir una conexión y
    // 5 s en total: en una ráfaga con pocas conexiones (el CI tiene 5) los últimos se rendían con un 500 en vez de esperar.
    return this.prisma.$transaction(async (tx) => {
      // Un candado único y global para TODO cambio de rol, antes de tocar ninguna fila. Sin él, el bloqueo de las filas de los gerentes no basta:
      // quien empezó antes de que alguien fuera ascendido no ve a ese nuevo gerente, y toma sus bloqueos en otro orden que quien ya lo ve
      // (una pide la fila de la persona ascendida después de la del gerente y la otra al revés): PostgreSQL detecta el bloqueo mutuo (40P01)
      // y una de las dos recibía un 500. Con el candado se ejecutan de una en una y no puede haber ciclo.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('identity.role-change'))`;
      await tx.$queryRaw`SELECT id FROM users WHERE role = 'manager'::"Role" ORDER BY id FOR UPDATE`;
      return work({
        findById: async (id) => {
          const rows = await tx.$queryRaw<UserSummary[]>`SELECT id, email, name, role::text AS role, staff_id AS "staffId", created_at AS "createdAt" FROM users WHERE id = ${id}::uuid`;
          return rows[0] ?? null;
        },
        countManagers: () => tx.user.count({ where: { role: 'manager' } }),
        setRole: (id: string, role: Role) => tx.user.update({ where: { id }, data: { role }, select: SUMMARY }),
        addToOutbox: async (ev, aggregateId) => { await tx.outboxEvent.create({ data: { id: ev.eventId, aggregateId, type: ev.type, routingKey: routingKeyOf(ev), payload: ev as any } }); },
      });
    }, ROLE_CHANGE_TX);
  }
}
