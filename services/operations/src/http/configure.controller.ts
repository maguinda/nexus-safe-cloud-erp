import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseIntPipe, Patch } from '@nestjs/common';
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
  @ApiPropertyOptional({ example: 'FOC2145X0AB', description: 'Real serial number (3 to 40 characters). Not repeated among purchased devices' }) @IsOptional() @IsString() @MaxLength(60) serial?: string;
  @ApiPropertyOptional({ example: '2028-11-30', nullable: true, description: 'End of the warranty; empty or null clears it' }) @IsOptional() @IsString() @MaxLength(12) warrantyUntil?: string | null;
  @ApiPropertyOptional({ example: 'Laura Ríos', nullable: true, description: 'Name of the person it was assigned to; empty or null clears it' }) @IsOptional() @IsString() @MaxLength(100) assignedTo?: string | null;
}

@ApiTags('Network')
@ApiBearerAuth()
@Controller('network')
export class ConfigureController {
  constructor(@Inject(CONFIGURE_PRISMA) private readonly prisma: PrismaClient) {}

  @Get('purchased')
  @Roles('manager')
  @ApiOperation({ summary: 'Devices that came from a purchase, with serial number, warranty and who has them (role manager)' })
  async purchased() {
    const rows = await this.prisma.networkDevice.findMany({ where: { sourceOrder: { not: null } }, orderBy: [{ sourceOrder: 'desc' }, { sourceUnit: 'asc' }], take: 500 });
    return rows.map((r) => ({ id: r.id, name: r.name, model: r.model, role: r.role, criticality: r.criticality, ips: r.ips, serial: r.serial, order: r.sourceOrder, unit: r.sourceUnit,
      warrantyUntil: r.warrantyUntil ? r.warrantyUntil.toISOString().slice(0, 10) : null, assignedTo: r.assignedTo }));
  }

  @Patch('devices/:id/configure')
  @Roles('manager')
  @ApiOperation({ summary: 'Complete a PURCHASED device (role, criticality, IPs). Only devices that came from a purchase can be edited here (role manager)' })
  @ApiResponse({ status: 400, description: 'Invalid role, criticality or IPs' })
  @ApiResponse({ status: 404, description: 'The device does not exist or did not come from a purchase' })
  async configure(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfigureDto) {
    let c;
    try { c = validateConfiguration(dto); } catch (e) { if (e instanceof InvalidConfigurationError) throw new BadRequestException(e.message); throw e; }
    // Una sola sentencia: solo toca equipos que vinieron de una compra; los del Excel de la docente no se editan por aquí.
    const data: Record<string, unknown> = { role: c.role, criticality: c.criticality, ips: c.ips };
    if (c.serial !== undefined) data.serial = c.serial;
    if (c.warrantyUntil !== undefined) data.warrantyUntil = c.warrantyUntil === null ? null : new Date(`${c.warrantyUntil}T00:00:00Z`);
    if (c.assignedTo !== undefined) data.assignedTo = c.assignedTo;
    let n;
    try { n = await this.prisma.networkDevice.updateMany({ where: { id, sourceOrder: { not: null } }, data }); } catch (e: any) {
      if (e?.code === 'P2002' || /network_devices_bought_serial_key/.test(String(e?.message))) throw new ConflictException('Another purchased device already has that serial number');
      throw e;
    }
    if (n.count === 0) throw new NotFoundException('Device not found or not purchased');
    return { id, ...c };
  }
}
