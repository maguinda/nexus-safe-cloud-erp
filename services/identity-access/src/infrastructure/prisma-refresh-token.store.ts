import { Prisma, PrismaClient } from '@prisma/client';
import { RefreshTokenStore } from '../domain/ports';
import { RefreshRecord } from '../domain/refresh-token';

/** Las columnas son TIMESTAMP sin zona (así las guarda Prisma, en UTC): en SQL a mano el instante se pasa en UTC explícito, no según la zona de la sesión. */
const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(t: { userId: string; familyId: string; tokenHash: string; expiresAt: Date; familyExpiresAt: Date }): Promise<void> {
    await this.prisma.refreshToken.create({ data: t });
  }

  async rotate(oldHash: string, next: { tokenHash: string; idleMs: number }, now: Date): Promise<{ userId: string; familyId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // «family_expires_at > ahora» es una segunda defensa: la base ya impide (CHECK) un token que dure más que su familia.
      // Un solo UPDATE decide quién gana: con dos a la vez, el segundo espera al primero, vuelve a mirar la condición («used_at IS NULL») y no encuentra nada.
      const rows = await tx.$queryRaw<{ user_id: string; family_id: string; family_expires_at: Date }[]>`
        UPDATE "refresh_tokens" SET "used_at" = ${utc(now)}
        WHERE "token_hash" = ${oldHash} AND "used_at" IS NULL AND "revoked_at" IS NULL
          AND "expires_at" > ${utc(now)} AND "family_expires_at" > ${utc(now)}
        RETURNING "user_id", "family_id", "family_expires_at"`;
      if (rows.length === 0) return null;
      const r = rows[0];
      const familyEnds = new Date(r.family_expires_at);
      const expiresAt = new Date(Math.min(now.getTime() + next.idleMs, familyEnds.getTime()));
      await tx.refreshToken.create({ data: { userId: r.user_id, familyId: r.family_id, tokenHash: next.tokenHash, expiresAt, familyExpiresAt: familyEnds } });
      return { userId: r.user_id, familyId: r.family_id };
    });
  }

  async find(tokenHash: string): Promise<(RefreshRecord & { familyId: string }) | null> {
    const r = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    return r ? { userId: r.userId, familyId: r.familyId, expiresAt: r.expiresAt, familyExpiresAt: r.familyExpiresAt, usedAt: r.usedAt, revokedAt: r.revokedAt } : null;
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.revokeUntilQuiet({ familyId }, now);
  }

  async revokeAllForUser(userId: string, now: Date): Promise<number> {
    return this.revokeUntilQuiet({ userId }, now);
  }

  /**
   * Una renovación que ya gastó su token y está a punto de guardar el siguiente NO ve el UPDATE de revocación (su fila nueva aún no existe para él) y
   * el UPDATE no ve esa fila nueva (nació después de su foto). Por eso se repite hasta que una pasada ya no encuentra nada: la segunda pasada empieza
   * cuando la renovación en vuelo ya confirmó (el primer UPDATE tuvo que esperar su fila) y ve el token nuevo. Tope de pasadas por si algo gira sin fin.
   */
  private async revokeUntilQuiet(where: { familyId: string } | { userId: string }, now: Date): Promise<number> {
    let total = 0;
    for (let pass = 0; pass < 5; pass++) {
      const { count } = await this.prisma.refreshToken.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: now } });
      total += count;
      if (count === 0) break;
    }
    return total;
  }

  async purge(before: Date): Promise<number> {
    return (await this.prisma.refreshToken.deleteMany({ where: { familyExpiresAt: { lt: before } } })).count;
  }
}
