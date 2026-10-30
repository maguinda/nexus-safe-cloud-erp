import type { TFn } from '../i18n';

export const CRITICALITIES = ['Crítica', 'Alta', 'Media'] as const;
export const PENDING_ROLE = 'Pendiente de configurar';
const ROLE = /^[\p{L}\p{N} ._()/&-]{2,60}$/u;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export interface ConfigureErrors { role?: string; criticality?: string; ips?: string; serial?: string; warrantyUntil?: string; assignedTo?: string }
const SERIAL = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/;
const PERSON = /^[^<>\u0000-\u001f]{2,80}$/u;

/** Estado de la garantía a una fecha: vencida, vence pronto (30 días) o vigente; sin fecha, null. */
export function warrantyState(until: string | null, today: string): 'expired' | 'soon' | 'ok' | null {
  if (!until) return null;
  if (until < today) return 'expired';
  return (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000 <= 30 ? 'soon' : 'ok';
}

/** Mismos criterios que el servidor (domain/configure.ts). */
export interface ConfigureForm { role: string; criticality: string; ips: string; serial: string; warrantyUntil: string; assignedTo: string }
export function checkConfiguration(t: TFn, f: ConfigureForm): { errors: ConfigureErrors; value?: { role: string; criticality: string; ips: string; serial?: string; warrantyUntil: string; assignedTo: string } } {
  const errors: ConfigureErrors = {};
  const role = f.role.replace(/\s+/g, ' ').trim();
  if (!ROLE.test(role)) errors.role = t('cfg.v.role');
  else if (role.toLowerCase() === PENDING_ROLE.toLowerCase()) errors.role = t('cfg.v.rolePending');
  if (!(CRITICALITIES as readonly string[]).includes(f.criticality)) errors.criticality = t('cfg.v.criticality');
  const list = f.ips.split(/[;,\s]+/).filter(Boolean);
  if (list.length > 0 && (list.length > 4 || list.some((x) => !IPV4.test(x)) || new Set(list).size !== list.length)) errors.ips = t('cfg.v.ips');
  const serial = f.serial.trim();
  if (serial && !SERIAL.test(serial)) errors.serial = t('cfg.v.serial');
  const w = f.warrantyUntil.trim();
  if (w && (!/^\d{4}-\d{2}-\d{2}$/.test(w) || new Date(`${w}T00:00:00Z`).toISOString().slice(0, 10) !== w || w < '2000-01-01' || w > '2100-12-31')) errors.warrantyUntil = t('cfg.v.warranty');
  const person = f.assignedTo.replace(/\s+/g, ' ').trim();
  if (person && !PERSON.test(person)) errors.assignedTo = t('cfg.v.person');
  if (Object.keys(errors).length) return { errors };
  return { errors, value: { role, criticality: f.criticality, ips: list.join('; '), ...(serial ? { serial } : {}), warrantyUntil: w, assignedTo: person } };
}
