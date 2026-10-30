import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { Roles } from '../auth/auth.guard';

export const QC_PRISMA = 'QC_PRISMA';

/** Lo que ventas necesita para cotizar: los artículos que algún proveedor vende, con el precio de referencia más bajo. Sin existencias ni pedidos. */
@ApiTags('Procurement')
@ApiBearerAuth()
@Controller('quote-catalog')
export class QuoteCatalogController {
  constructor(@Inject(QC_PRISMA) private readonly prisma: PrismaClient) {}

  @Get() @Roles('sales', 'manager', 'project_lead')
  @ApiOperation({ summary: 'Items some supplier sells, with the lowest reference price, the supplier and the lead time (to quote materials and supplies)' })
  async list() {
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; kind: string; supplier: string; ref_price_cop: number; lead_days: number }[]>`
      SELECT DISTINCT ON (i.id) i.id, i.name, i.kind, s.name AS supplier, si.ref_price_cop, si.lead_days
      FROM items i JOIN supplier_items si ON si.item_id = i.id JOIN suppliers s ON s.id = si.supplier_id
      ORDER BY i.id, si.ref_price_cop ASC, s.name ASC`;
    return rows.map((r) => ({ itemId: r.id, name: r.name, kind: r.kind as 'equipment' | 'spare', supplier: r.supplier, refPriceCop: r.ref_price_cop, leadDays: r.lead_days }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
