import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaClient } from '@prisma/client';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { employerCost, monthlySalary, POSITIONS, position } from '../domain/engineer';
import { ValidationError } from '../domain/errors';

export const RATES_PRISMA = 'RATES_PRISMA';

class RateDto {
  @ApiProperty({ example: 5500000, minimum: 1, maximum: 200000000, description: 'Monthly payroll salary estimate for the position, whole pesos' }) @IsOptional() monthlySalaryCop!: number;
  @ApiPropertyOptional({ maxLength: 400, description: 'Where the estimate comes from' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('Rates')
@ApiBearerAuth()
@Controller('position-rates')
export class RatesController {
  constructor(@Inject(RATES_PRISMA) private readonly prisma: PrismaClient) {}

  @Get() @Roles('sales', 'manager', 'project_lead')
  @ApiOperation({ summary: 'Reference monthly salary per position and what it costs the company: with benefits and social security (breakdown) and per working day, to quote before knowing who will go to the project' })
  async list() {
    const rows = await this.prisma.positionRate.findMany();
    const order = Object.keys(POSITIONS);
    return rows.sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position)).map((r) => ({
      position: r.position, kind: POSITIONS[r.position as keyof typeof POSITIONS].kind, label: POSITIONS[r.position as keyof typeof POSITIONS].label,
      monthlySalaryCop: r.monthlySalaryCop, cost: employerCost(r.monthlySalaryCop, r.position as keyof typeof POSITIONS), dailyCostCop: employerCost(r.monthlySalaryCop, r.position as keyof typeof POSITIONS).dailyCop, note: r.note, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy,
    }));
  }

  @Patch(':position') @HttpCode(204) @Roles('manager')
  @ApiOperation({ summary: 'Adjust the reference salary of a position (role manager)' })
  @ApiResponse({ status: 404, description: 'Unknown position' })
  async set(@Param('position') pos: string, @Body() dto: RateDto, @Req() req: Request & { user: AuthUser }) {
    let p: string;
    try { p = position(pos); } catch { throw new NotFoundException('Position not found'); }
    const salary = monthlySalary(dto.monthlySalaryCop);
    if (salary === null) throw new ValidationError('monthlySalaryCop is required');
    const note = dto.note === undefined ? undefined : dto.note.replace(/\s+/g, ' ').trim();
    // eslint-disable-next-line no-control-regex
    if (note !== undefined && (note.length < 3 || note.length > 400 || /[\u0000-\u001f<>]/.test(note))) throw new ValidationError('note must be 3 to 400 characters');
    await this.prisma.positionRate.update({ where: { position: p }, data: { monthlySalaryCop: salary, ...(note !== undefined ? { note } : {}), updatedAt: new Date(), updatedBy: req.user.email } });
  }
}
