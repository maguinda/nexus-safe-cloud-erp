import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaClient } from '@prisma/client';
import { Roles } from '../auth/auth.guard';
import { DashboardQueries } from '../domain/ports';
import { cashflow, projectCosts } from '../infrastructure/prisma-cash';

export const FINANCE_PRISMA = 'FINANCE_PRISMA';
export const FINANCE_QUERIES = 'FINANCE_QUERIES';

/** Dinero de la empresa: solo gerencia y finanzas. */
@ApiTags('Finance')
@ApiBearerAuth()
@Controller()
export class FinanceController {
  constructor(@Inject(FINANCE_PRISMA) private readonly prisma: PrismaClient, @Inject(FINANCE_QUERIES) private readonly queries: DashboardQueries) {}

  @Get('cashflow') @Roles('manager', 'finance')
  @ApiOperation({ summary: 'Cash in (what clients pay) against cash out (payroll and suppliers) per month, with the running balance (roles manager and finance)' })
  cash(@Query('months') months?: string) {
    let n = 12;
    if (months !== undefined) { if (!/^\d{1,2}$/.test(months) || Number(months) < 1 || Number(months) > 36) throw new BadRequestException('months must be a whole number from 1 to 36'); n = Number(months); }
    return cashflow(this.prisma, n, new Date());
  }

  @Get('project-costs') @Roles('manager', 'finance')
  @ApiOperation({ summary: 'What each approved quote said it would cost against what it has cost so far: labor to date plus the suppliers paid for that project (roles manager and finance)' })
  costs() { return projectCosts(this.prisma, this.queries, new Date()); }
}
