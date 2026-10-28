import { REFRESH_COOKIE } from '../domain/refresh-token';

/** La cookie solo viaja a las rutas /auth (login, refresh y logout): al resto de la API no se le manda. */
export const REFRESH_COOKIE_PATH = '/auth';
/** Cabecera propia que el cliente web pone al renovar o cerrar sesión: un sitio ajeno no puede ponerla sin permiso del navegador (CORS). */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_VALUE = 'erp-web';

/**
 * El token de renovación dentro de la cabecera Cookie. Si la cookie aparece más de una vez (otro sitio del mismo dominio pudo sembrar una), no se
 * adivina cuál es la buena: se ignora y hay que iniciar sesión de nuevo.
 */
export function readRefreshCookie(header: string | undefined): string | undefined {
  if (!header || header.length > 4096) return undefined;
  const found: string[] = [];
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === REFRESH_COOKIE) found.push(part.slice(i + 1).trim());
  }
  return found.length === 1 ? found[0] : undefined;
}

/** HttpOnly (el JavaScript de la página no la lee: un fallo de XSS no se la lleva), SameSite=Strict (no sale en peticiones de otros sitios) y, con HTTPS, Secure. Sin Max-Age: se va al cerrar el navegador. */
export const refreshCookie = (token: string, o: { secure: boolean }): string => `${REFRESH_COOKIE}=${token}; Path=${REFRESH_COOKIE_PATH}; HttpOnly; SameSite=Strict${o.secure ? '; Secure' : ''}`;

export const clearedRefreshCookie = (o: { secure: boolean }): string => `${REFRESH_COOKIE}=; Path=${REFRESH_COOKIE_PATH}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${o.secure ? '; Secure' : ''}`;
