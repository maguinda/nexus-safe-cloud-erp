
export const PENDING_ROLE = 'Pendiente de configurar';
export const CRITICALITIES = ['Crítica', 'Alta', 'Media'] as const;
export class InvalidConfigurationError extends Error {}

const ROLE = /^[\p{L}\p{N} ._()/&-]{2,60}$/u;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export interface Configuration { role: string; criticality: (typeof CRITICALITIES)[number]; ips: string | null }

/** Lo que gerencia completa de un equipo comprado: para qué sirve, qué tan crítico es y sus IP (de 0 a 4, separadas por «; » como el resto del inventario). */
export function validateConfiguration(i: { role?: unknown; criticality?: unknown; ips?: unknown }): Configuration {
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
  return { role, criticality: i.criticality as Configuration['criticality'], ips };
}
