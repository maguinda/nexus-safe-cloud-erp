import { PrismaClient } from '@prisma/client';
import { parseEquipmentInstalled, unitName } from '../domain/purchased';

const LOCK = 727_001; // candado de la base para repartir ids del inventario sin choques
const TX = { timeout: 15_000, maxWait: 15_000 };

/**
 * Cada unidad comprada entra al inventario de red como un equipo «pendiente de configurar» (criticidad Media, sin sede ni IP: eso lo completa una persona).
 * La pareja (orden, unidad) es única, así que un aviso repetido no duplica; el id se toma bajo un candado para que dos compras a la vez no choquen.
 */
export function purchaseEventHandler(prisma: PrismaClient) {
  return async (raw: unknown): Promise<string> => {
    // La compra recibida ya NO crea equipos (queda «en bodega»): solo se confirma. El equipo nace al instalarse.
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'EquipmentPurchased') return 'ignored (in storage, not installed)';
    const p = parseEquipmentInstalled(raw);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`;
      const n = await tx.$executeRaw`
        INSERT INTO network_devices (id, name, pt_type, model, category, role, criticality, serial, source_order, source_unit)
        SELECT COALESCE(MAX(id), 0) + 1, ${unitName(p.itemName, p.installNumber, 1)}, 'Installed', ${p.itemName}, 'Equipo comprado', 'Pendiente de configurar', 'Media', ${`${p.installNumber}-1`}, ${p.installNumber}, 1 FROM network_devices
        ON CONFLICT DO NOTHING`;
      return n === 0 ? 'duplicate' : 'stored 1';
    }, TX);
  };
}
