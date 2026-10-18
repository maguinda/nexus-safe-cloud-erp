/**
 * Decodifica el payload del JWT SOLO para mostrarlo (rol, vencimiento). No verifica la firma ni se usa para decidir
 * permisos: el servidor verifica el token y comprueba el rol en cada petición.
 */
export interface TokenClaims { sub?: string; email?: string; role?: string; exp?: number; iat?: number; iss?: string; aud?: string }

export function decodeClaims(token: string): TokenClaims | null {
  if (token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)));
    const obj = JSON.parse(json);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as TokenClaims) : null;
  } catch {
    return null;
  }
}

/** Segundos que le quedan al token (0 si venció o si no se puede leer). */
export function secondsLeft(token: string, nowMs = Date.now()): number {
  const exp = decodeClaims(token)?.exp;
  return typeof exp === 'number' ? Math.max(0, Math.floor(exp - nowMs / 1000)) : 0;
}
