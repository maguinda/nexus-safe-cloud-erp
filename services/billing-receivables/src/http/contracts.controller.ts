import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthUser, Roles } from '../auth/auth.guard';
import { CONTRACT_STATUSES, ContractStatus, validateContract } from '../domain/contract';
import { ContractNotFoundError, ContractStateError } from '../domain/errors';

export const PRISMA = 'PRISMA';

class CreateContractDto {
  @ApiProperty({ example: 'Retail Norte (example)' }) @IsString() @MaxLength(300) clientName!: string;
  @ApiProperty({ example: 'Branch network upgrade' }) @IsString() @MaxLength(300) projectName!: string;
  @ApiProperty({ example: 120000000, description: 'Whole pesos, before VAT' }) @IsNumber() amountCop!: number;
  @ApiProperty({ example: '2026-11-01' }) @IsString() @MaxLength(10) startDate!: string;
  @ApiProperty({ example: '2027-05-01' }) @IsString() @MaxLength(10) endDate!: string;
}
class StatusDto { @ApiProperty({ enum: ['closed', 'cancelled'] }) @IsString() @MaxLength(20) status!: string }

const day = (d: Date) => d.toISOString().slice(0, 10);
/** Facturado y cobrado salen de las facturas del MISMO proyecto (enlace por valor); sin quién creó el contrato. */
const LIST_SQL = `
  SELECT c.id, c.client_name AS "clientName", c.project_name AS "projectName", c.amount_cop AS "amountCop", c.start_date AS "startDate", c.end_date AS "endDate", c.status, c.created_at AS "createdAt",
         COALESCE((SELECT SUM(i.amount_cop) FROM invoices i WHERE i.project_name = c.project_name AND i.status = 'issued'), 0)::int AS "billedCop",
         COALESCE((SELECT SUM(p.amount_cop) FROM payments p JOIN invoices i ON i.number = p.invoice_number WHERE i.project_name = c.project_name), 0)::int AS "paidCop"
  FROM contracts c ORDER BY c.created_at DESC, c.id LIMIT 200`;

@ApiTags('Contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Post()
  @Roles('manager', 'billing_analyst')
  @ApiOperation({ summary: 'Create a contract with a client (roles manager and billing_analyst)' })
  @ApiResponse({ status: 400, description: 'Invalid contract data' })
  async create(@Body() dto: CreateContractDto, @Req() req: Request) {
    const v = validateContract(dto);
    const user = (req as any).user as AuthUser;
    const c = await this.prisma.contract.create({ data: { ...v, startDate: new Date(`${v.startDate}T00:00:00Z`), endDate: new Date(`${v.endDate}T00:00:00Z`), createdBy: user.email } });
    return { id: c.id, ...v, status: c.status, createdAt: c.createdAt.toISOString(), billedCop: 0, paidCop: 0 };
  }

  @Get()
  @Roles('manager', 'billing_analyst', 'project_lead')
  @ApiOperation({ summary: 'Contracts with how much was billed and paid against their project (roles manager, billing_analyst, project_lead)' })
  async list() {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(LIST_SQL);
    return rows.map((r) => ({ ...r, startDate: day(r.startDate), endDate: day(r.endDate), createdAt: new Date(r.createdAt).toISOString() }));
  }

  @Patch(':id/status')
  @Roles('manager', 'billing_analyst')
  @ApiOperation({ summary: 'Close or cancel an active contract' })
  @ApiResponse({ status: 409, description: 'The contract is not active' })
  async status(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: StatusDto) {
    if (!(CONTRACT_STATUSES as readonly string[]).includes(dto.status) || dto.status === 'active') throw new ContractStateError('status must be closed or cancelled');
    // El cambio se decide en la misma sentencia: «solo si sigue vigente», así dos cambios a la vez no se pisan.
    const n = await this.prisma.contract.updateMany({ where: { id, status: 'active' }, data: { status: dto.status as ContractStatus } });
    if (n.count === 0) {
      const c = await this.prisma.contract.findUnique({ where: { id } });
      if (!c) throw new ContractNotFoundError('Contract not found');
      throw new ContractStateError(`The contract is already ${c.status}`);
    }
    return { id, status: dto.status };
  }
}
