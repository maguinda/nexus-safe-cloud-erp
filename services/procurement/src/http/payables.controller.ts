import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { PayablesService } from '../infrastructure/prisma-payables';

export const PAYABLES = 'PAYABLES_SERVICE';
class PayDto {
  @ApiProperty({ enum: ['transfer', 'cash', 'card', 'check'] }) @IsString() @MaxLength(20) method!: string;
  @ApiPropertyOptional({ maxLength: 60, description: 'Transfer number, check number… (3 to 60 characters)' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

/** Lo que se le debe a los proveedores: dato de gerencia y finanzas. */
@ApiTags('Payables')
@ApiBearerAuth()
@Controller('payables')
export class PayablesController {
  constructor(@Inject(PAYABLES) private readonly svc: PayablesService) {}

  @Get() @Roles('manager', 'finance')
  @ApiOperation({ summary: 'What is owed to suppliers (one per received order): open first by due date, with the totals owed and overdue' })
  list() { return this.svc.list(); }

  @Post(':id/pay') @HttpCode(200) @Roles('manager', 'finance')
  @ApiOperation({ summary: 'Pay a payable, once, and announce it (SupplierPaid)' })
  @ApiResponse({ status: 409, description: 'It is already paid' })
  pay(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PayDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) { return this.svc.pay(id, dto.method, dto.reference, req.user.email, req.correlationId ?? 'no-correlation'); }
}
