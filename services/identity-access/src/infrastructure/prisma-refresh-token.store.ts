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
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });
  }

  async purge(before: Date): Promise<number> {
    return (await this.prisma.refreshToken.deleteMany({ where: { familyExpiresAt: { lt: before } } })).count;
  }
}
