import { PrismaClient } from '@prisma/client';
import { parseEquipmentPurchased, unitName } from '../domain/purchased';

const LOCK = 727_001; // candado de la base para repartir ids del inventario sin choques
const TX = { timeout: 15_000, maxWait: 15_000 };

/**
 * Cada unidad comprada entra al inventario de red como un equipo «pendiente de configurar» (criticidad Media, sin sede ni IP: eso lo completa una persona).
 * La pareja (orden, unidad) es única, así que un aviso repetido no duplica; el id se toma bajo un candado para que dos compras a la vez no choquen.
 */
export function purchaseEventHandler(prisma: PrismaClient) {
  return async (raw: unknown): Promise<string> => {
    const p = parseEquipmentPurchased(raw);
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`;
      let added = 0;
      for (let unit = 1; unit <= p.quantity; unit++) {
        const name = unitName(p.itemName, p.orderNumber, unit);
        const n = await tx.$executeRaw`
          INSERT INTO network_devices (id, name, pt_type, model, category, role, criticality, serial, source_order, source_unit)
          SELECT COALESCE(MAX(id), 0) + 1, ${name}, 'Purchased', ${p.itemName}, 'Equipo comprado', 'Pendiente de configurar', 'Media', ${`${p.orderNumber}-${unit}`}, ${p.orderNumber}, ${unit} FROM network_devices
          ON CONFLICT DO NOTHING`;
        added += n;
      }
      return added === 0 ? 'duplicate' : `stored ${added}`;
    }, TX);
  };
}
