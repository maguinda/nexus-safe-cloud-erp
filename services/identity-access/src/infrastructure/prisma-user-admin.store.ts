import { Prisma, PrismaClient } from '@prisma/client';
import { EmailTakenError } from '../domain/errors';
import { NewUser, RoleChangeTx, UserAdminStore, UserSummary } from '../domain/ports';
import { Role } from '../domain/role';

const SUMMARY = { id: true, email: true, name: true, role: true, createdAt: true } as const; // sin passwordHash: nunca sale de aquí

export class PrismaUserAdminStore implements UserAdminStore {
  constructor(private readonly prisma: PrismaClient) {}

  async isManager(id: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    return row?.role === 'manager';
  }

  list(): Promise<UserSummary[]> {
    return this.prisma.user.findMany({ select: SUMMARY, orderBy: [{ createdAt: 'asc' }, { email: 'asc' }] });
  }

  async create(user: NewUser): Promise<UserSummary> {
    try {
      return await this.prisma.user.create({ data: user, select: SUMMARY });
    } catch (e) {
      // Carrera entre dos altas del mismo email: la restricción única de la base decide y gana una sola.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new EmailTakenError();
      throw e;
    }
  }

  /**
   * Se bloquean todas las filas de los gerentes (en orden por id) antes de leer nada. Como TODO cambio de rol exige ser gerente,
   * todos pasan por ese mismo bloqueo y se ejecutan de uno en uno: no hace falta bloquear además la fila de quien llama ni la del usuario.
   * Todo lo que el caso de uso lee ocurre ya dentro del bloqueo, así que ve el estado real aunque otra petición esté a punto de cambiarlo.
   */
  runRoleChange<T>(work: (tx: RoleChangeTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE role = 'manager'::"Role" ORDER BY id FOR UPDATE`;
      return work({
        findById: async (id) => {
          const rows = await tx.$queryRaw<UserSummary[]>`SELECT id, email, name, role::text AS role, created_at AS "createdAt" FROM users WHERE id = ${id}::uuid`;
          return rows[0] ?? null;
        },
        countManagers: () => tx.user.count({ where: { role: 'manager' } }),
        setRole: (id: string, role: Role) => tx.user.update({ where: { id }, data: { role }, select: SUMMARY }),
      });
    });
  }
}
