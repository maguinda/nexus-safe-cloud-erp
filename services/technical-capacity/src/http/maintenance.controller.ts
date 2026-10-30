import { Body, Controller, Delete, HttpCode, Inject, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { dayString } from '../domain/dates';
import { MaintenanceService } from '../infrastructure/prisma-maintenance';

export const MAINTENANCE = 'MAINTENANCE_SERVICE';

class ReserveDto {
  @ApiProperty({ description: 'The person (engineer or technician) responsible for the work order' }) @IsUUID() engineerId!: string;
  @ApiProperty({ example: 'OT-0007 · Switch piso 2', maxLength: 80 }) @IsString() @MaxLength(120) label!: string;
  @ApiProperty({ minimum: 1, maximum: 100 }) @IsInt() percent!: number;
  @ApiProperty({ example: '2026-11-03' }) @IsString() @MaxLength(10) startDate!: string;
  @ApiProperty({ example: '2026-11-07' }) @IsString() @MaxLength(10) endDate!: string;
  @ApiPropertyOptional({ description: 'Manager only: accept going over 100% on purpose' }) @IsOptional() @IsBoolean() allowOverallocation?: boolean;
}

/**
 * Para Operations (servicio a servicio, con mTLS y el token de la persona reenviado): NO pasa por el gateway ni por el navegador.
 * Una orden de trabajo gasta capacidad: PUT reserva (o mueve) la asignación de mantenimiento de la orden; DELETE la libera.
 */
@ApiTags('Capacity')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(@Inject(MAINTENANCE) private readonly svc: MaintenanceService) {}

  @Put(':orderId') @HttpCode(200) @Roles('manager')
  @ApiOperation({ summary: 'Reserve (or move) the capacity of a work order: one maintenance allocation per order, under the same 100% rule. Idempotent by order id. Service to service only.' })
  @ApiResponse({ status: 409, description: 'It would put the person over 100% on some day' })
  async reserve(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: ReserveDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) {
    const r = await this.svc.reserve(orderId, dto, req.correlationId ?? 'no-correlation');
    return { allocationId: r.allocationId, peak: r.peak, overAllocated: r.overAllocated, startDate: dayString(Math.floor(Date.parse(`${dto.startDate}T00:00:00Z`) / 86_400_000)), endDate: dto.endDate };
  }

  @Delete(':orderId') @HttpCode(204) @Roles('manager')
  @ApiOperation({ summary: 'Release the capacity of a work order. Idempotent: nothing to release is not an error. Service to service only.' })
  async release(@Param('orderId', new ParseUUIDPipe()) orderId: string) { await this.svc.release(orderId); }
}
