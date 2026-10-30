import type { TFn } from '../i18n';

export const CRITICALITIES = ['Crítica', 'Alta', 'Media'] as const;
export const PENDING_ROLE = 'Pendiente de configurar';
const ROLE = /^[\p{L}\p{N} ._()/&-]{2,60}$/u;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export interface ConfigureErrors { role?: string; criticality?: string; ips?: string }

/** Mismos criterios que el servidor (domain/configure.ts). */
export function checkConfiguration(t: TFn, f: { role: string; criticality: string; ips: string }): { errors: ConfigureErrors; value?: { role: string; criticality: string; ips: string } } {
  const errors: ConfigureErrors = {};
  const role = f.role.replace(/\s+/g, ' ').trim();
  if (!ROLE.test(role)) errors.role = t('cfg.v.role');
  else if (role.toLowerCase() === PENDING_ROLE.toLowerCase()) errors.role = t('cfg.v.rolePending');
  if (!(CRITICALITIES as readonly string[]).includes(f.criticality)) errors.criticality = t('cfg.v.criticality');
  const list = f.ips.split(/[;,\s]+/).filter(Boolean);
  if (list.length > 0 && (list.length > 4 || list.some((x) => !IPV4.test(x)) || new Set(list).size !== list.length)) errors.ips = t('cfg.v.ips');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { role, criticality: f.criticality, ips: list.join('; ') } };
}
