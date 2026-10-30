import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { Roles } from '../auth/auth.guard';
import { listAudit } from '../infrastructure/prisma-audit';

export const AUDIT_PRISMA = 'AUDIT_PRISMA';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(@Inject(AUDIT_PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  @Roles('manager')
  @ApiOperation({ summary: 'Audit log built from every event on the bus: when, who (when the event says it) and what (role manager)' })
  @ApiQuery({ name: 'type', required: false, description: 'Event type, e.g. InvoiceIssued' })
  @ApiQuery({ name: 'limit', required: false, description: '1 to 200, default 100' })
  @ApiResponse({ status: 403, description: 'Only the manager reads the audit log' })
  audit(@Query('type') type?: string, @Query('limit') limit?: string) {
    if (type !== undefined && !/^[A-Za-z]{1,60}$/.test(type)) throw new BadRequestException('type must be letters only');
    let n = 100;
    if (limit !== undefined) { if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 200) throw new BadRequestException('limit must be a whole number from 1 to 200'); n = Number(limit); }
    return listAudit(this.prisma, { type, limit: n });
  }
}
