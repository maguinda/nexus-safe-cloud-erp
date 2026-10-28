import { createHash, randomBytes } from 'crypto';

/** Nombre de la cookie con el token de renovación. */
export const REFRESH_COOKIE = 'erp_refresh';
/** 32 bytes al azar en base64url son 43 caracteres: lo que no tenga esta forma ni se busca en la base. */
export const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/**
 * Margen para dos renovaciones a la vez con el mismo token (dos pestañas del mismo navegador): la que llega segunda no es un robo, es una carrera.
 * Dentro del margen se responde «reintenta» SIN revocar nada; el reintento ya lleva la cookie nueva. Pasado el margen, usar un token gastado
 * es la señal de que lo copiaron y se revoca toda la familia.
 */
export const REUSE_GRACE_MS = 10_000;

export const hashRefreshToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Un token nuevo: el valor (solo viaja en la cookie) y su hash (lo único que se guarda). 256 bits al azar: no se puede adivinar. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

/** Lo que hay guardado de un token. */
export interface RefreshRecord {
  userId: string;
  familyId: string;
  expiresAt: Date;
  familyExpiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/**
 *  ok      se puede renovar con él
 *  invalid no existe, está revocado o venció (por inactividad o por el tope de la sesión)
 *  retry   ya se gastó hace un instante: una carrera entre dos renovaciones, no un robo
 *  reuse   ya se gastó hace rato: alguien está usando una copia
 */
export type RefreshVerdict = 'ok' | 'invalid' | 'retry' | 'reuse';

export function judgeRefresh(r: RefreshRecord | null, now: Date, graceMs: number = REUSE_GRACE_MS): RefreshVerdict {
  if (!r || r.revokedAt) return 'invalid';
  if (r.expiresAt.getTime() <= now.getTime() || r.familyExpiresAt.getTime() <= now.getTime()) return 'invalid';
  if (r.usedAt) return now.getTime() - r.usedAt.getTime() <= graceMs ? 'retry' : 'reuse';
  return 'ok';
}
