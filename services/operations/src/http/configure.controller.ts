import { BadRequestException, Body, Controller, Inject, NotFoundException, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaClient } from '@prisma/client';
import { Roles } from '../auth/auth.guard';
import { InvalidConfigurationError, validateConfiguration } from '../domain/configure';

export const CONFIGURE_PRISMA = 'CONFIGURE_PRISMA';

class ConfigureDto {
  @ApiProperty({ example: 'Switch de acceso piso 2' }) @IsString() @MaxLength(200) role!: string;
  @ApiProperty({ enum: ['Crítica', 'Alta', 'Media'] }) @IsString() @MaxLength(20) criticality!: string;
  @ApiPropertyOptional({ example: '10.0.2.5; 10.0.2.6', description: 'Up to 4 different IPv4 addresses' }) @IsOptional() @IsString() @MaxLength(200) ips?: string;
}

@ApiTags('Network')
@ApiBearerAuth()
@Controller('network')
export class ConfigureController {
  constructor(@Inject(CONFIGURE_PRISMA) private readonly prisma: PrismaClient) {}

  @Patch('devices/:id/configure')
  @Roles('manager')
  @ApiOperation({ summary: 'Complete a PURCHASED device (role, criticality, IPs). Only devices that came from a purchase can be edited here (role manager)' })
  @ApiResponse({ status: 400, description: 'Invalid role, criticality or IPs' })
  @ApiResponse({ status: 404, description: 'The device does not exist or did not come from a purchase' })
  async configure(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfigureDto) {
    let c;
    try { c = validateConfiguration(dto); } catch (e) { if (e instanceof InvalidConfigurationError) throw new BadRequestException(e.message); throw e; }
    // Una sola sentencia: solo toca equipos que vinieron de una compra; los del Excel de la docente no se editan por aquí.
    const n = await this.prisma.networkDevice.updateMany({ where: { id, sourceOrder: { not: null } }, data: { role: c.role, criticality: c.criticality, ips: c.ips } });
    if (n.count === 0) throw new NotFoundException('Device not found or not purchased');
    return { id, ...c };
  }
}
