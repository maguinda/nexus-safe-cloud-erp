/** Cuántos segundos antes de que venza el token de acceso se renueva (hay margen para reintentar y para una pestaña que despierta tarde). */
export const RENEW_BUFFER_S = 120;
/** Si otra renovación con la misma cookie ganó un instante antes (dos pestañas a la vez), se espera esto y se vuelve a intentar con la cookie nueva. */
export const CONFLICT_RETRY_MS = 1500;
export const CONFLICT_RETRIES = 2;
/** Si la red o el servidor fallan, se vuelve a intentar cada tanto mientras el token de acceso siga valiendo. */
export const TRANSIENT_RETRY_MS = 10_000;

export const shouldRenew = (secondsLeft: number): boolean => secondsLeft <= RENEW_BUFFER_S;

/**
 *  renewed    sirvió
 *  conflict   409: otra renovación con la misma cookie ganó un instante antes; la cookie del navegador ya es la nueva
 *  expired    401 o 403: no hay sesión que renovar (venció, la cerraron, o falta la cookie): hay que iniciar sesión de nuevo
 *  transient  sin red, 429 o error del servidor: no se sabe nada de la sesión; se reintenta
 */
export type RenewalKind = 'renewed' | 'conflict' | 'expired' | 'transient';
export function classifyRenewal(status: number | 'network'): RenewalKind {
  if (status === 200) return 'renewed';
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403) return 'expired';
  return 'transient';
}

/**
 * La cookie de renovación es del NAVEGADOR, no de la pestaña: si en otra pestaña entró otra persona, la renovación de ESTA pestaña devolvería a esa otra
 * persona. Una renovación solo se aplica si es de la misma persona que ya está en pantalla.
 */
export const isSamePerson = (current: { email: string }, renewed: { email: string }): boolean => current.email.trim().toLowerCase() === renewed.email.trim().toLowerCase();
