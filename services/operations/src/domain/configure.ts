
export const PENDING_ROLE = 'Pendiente de configurar';
export const CRITICALITIES = ['Crítica', 'Alta', 'Media'] as const;
export class InvalidConfigurationError extends Error {}

const ROLE = /^[\p{L}\p{N} ._()/&-]{2,60}$/u;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const SERIAL = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,39}$/;
const PERSON = /^[^<>\u0000-\u001f]{2,80}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface Configuration {
  role: string; criticality: (typeof CRITICALITIES)[number]; ips: string | null;
  /** undefined = no se toca; el serial real no se puede borrar (solo cambiar). */
  serial?: string;
  /** undefined = no se toca; null = quitar. */
  warrantyUntil?: string | null;
  assignedTo?: string | null;
}

const optional = <T,>(v: unknown, f: (s: string) => T): T | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string') throw new InvalidConfigurationError('a field must be text');
  return f(v);
};

/** Lo que gerencia completa de un equipo comprado: para qué sirve, qué tan crítico es y sus IP (de 0 a 4, separadas por «; » como el resto del inventario). */
export function validateConfiguration(i: { role?: unknown; criticality?: unknown; ips?: unknown; serial?: unknown; warrantyUntil?: unknown; assignedTo?: unknown }): Configuration {
  const role = typeof i.role === 'string' ? i.role.replace(/\s+/g, ' ').trim() : '';
  if (!ROLE.test(role)) throw new InvalidConfigurationError('role must be 2 to 60 letters, numbers, spaces and . _ ( ) / & -');
  if (role.toLowerCase() === PENDING_ROLE.toLowerCase()) throw new InvalidConfigurationError('role must say what the device is for, not “pending”');
  if (typeof i.criticality !== 'string' || !(CRITICALITIES as readonly string[]).includes(i.criticality)) throw new InvalidConfigurationError('criticality must be Crítica, Alta or Media');
  let ips: string | null = null;
  if (i.ips !== undefined && i.ips !== null && i.ips !== '') {
    if (typeof i.ips !== 'string') throw new InvalidConfigurationError('ips must be text');
    const list = i.ips.split(/[;,\s]+/).filter(Boolean);
    if (list.length < 1 || list.length > 4 || list.some((x) => !IPV4.test(x)) || new Set(list).size !== list.length) throw new InvalidConfigurationError('ips must be 1 to 4 different IPv4 addresses');
    ips = list.join('; ');
  }
  const out: Configuration = { role, criticality: i.criticality as Configuration['criticality'], ips };
  if (i.serial !== undefined && i.serial !== null && i.serial !== '') {
    if (typeof i.serial !== 'string' || !SERIAL.test(i.serial.trim())) throw new InvalidConfigurationError('serial must be 3 to 40 letters, numbers and . _ / -');
    out.serial = i.serial.trim();
  }
  const w = optional(i.warrantyUntil, (s) => {
    const d = s.trim();
    if (!DAY.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d || d < '2000-01-01' || d > '2100-12-31') throw new InvalidConfigurationError('warrantyUntil must be a real date (YYYY-MM-DD) between 2000 and 2100');
    return d;
  });
  if (w !== undefined) out.warrantyUntil = w;
  const a = optional(i.assignedTo, (s) => {
    const p = s.replace(/\s+/g, ' ').trim();
    if (!PERSON.test(p)) throw new InvalidConfigurationError('assignedTo must be 2 to 80 characters without < > or control characters');
    return p;
  });
  if (a !== undefined) out.assignedTo = a;
  return out;
}
