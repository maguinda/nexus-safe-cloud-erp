import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { PayrollService } from '../infrastructure/prisma-payroll';

export const PAYROLL = 'PAYROLL_SERVICE';
class GenerateDto { @ApiProperty({ example: '2026-11', description: 'Month, YYYY-MM' }) @IsOptional() period!: string }

/** La nómina es dato sensible: solo gerencia y finanzas. */
@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(@Inject(PAYROLL) private readonly svc: PayrollService) {}

  @Get() @Roles('manager', 'finance')
  @ApiOperation({ summary: 'Payroll runs, newest month first (roles manager and finance)' })
  list() { return this.svc.list(); }

  @Get(':id') @Roles('manager', 'finance')
  @ApiResponse({ status: 404, description: 'Payroll run not found' })
  @ApiOperation({ summary: 'One payroll run with the snapshot line of each person' })
  get(@Param('id', new ParseUUIDPipe()) id: string) { return this.svc.get(id); }

  @Post() @Roles('manager', 'finance')
  @ApiOperation({ summary: 'Generate the payroll of a month: a snapshot of everyone with a salary and what each costs the company. One per month.' })
  @ApiResponse({ status: 409, description: 'That month already has a payroll' })
  generate(@Body() dto: GenerateDto, @Req() req: Request & { user: AuthUser }) { return this.svc.generate(dto.period, req.user.email); }

  @Post(':id/pay') @HttpCode(200) @Roles('manager', 'finance')
  @ApiOperation({ summary: 'Mark a payroll as paid (once) and announce it (PayrollPaid)' })
  @ApiResponse({ status: 409, description: 'It is already paid' })
  pay(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request & { user: AuthUser; correlationId?: string }) { return this.svc.pay(id, req.user.email, req.correlationId ?? 'no-correlation'); }
}
