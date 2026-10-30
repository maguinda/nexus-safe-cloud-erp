import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { InvalidWorkOrderError, validateNewWorkOrder, WO_STATUSES, WorkOrderStateError } from '../domain/work-order';
import { WorkOrderDuplicateError, WorkOrderNotFoundError, WorkOrderTargetMissingError, WorkOrdersService } from '../infrastructure/prisma-work-orders';

export const WORK_ORDERS = 'WORK_ORDERS';

class CreateWorkOrderDto {
  @ApiProperty({ enum: ['inspection', 'preventive', 'corrective'] }) @IsString() @MaxLength(20) type!: string;
  @ApiProperty({ enum: ['sensor', 'device'], description: 'sensor = an IoT device; device = a network device' }) @IsString() @MaxLength(10) targetKind!: string;
  @ApiProperty({ example: 'WEBCAM_OF1', description: 'The sensor id or the network device id' }) @IsDefined() targetRef!: string | number;
  @ApiProperty({ example: 'Temperature above the threshold in Oficina 2', maxLength: 300 }) @IsString() @MaxLength(400) description!: string;
  @ApiPropertyOptional({ enum: ['low', 'normal', 'high', 'critical'] }) @IsOptional() @IsString() @MaxLength(10) priority?: string;
  @ApiPropertyOptional({ example: '2026-11-10', description: 'Due date, not in the past' }) @IsOptional() @IsString() @MaxLength(12) dueDate?: string;
  @ApiPropertyOptional({ example: 'Laura Ríos', description: 'Name of the person responsible' }) @IsOptional() @IsString() @MaxLength(100) assignedTo?: string;
  @ApiPropertyOptional({ example: 'ALERT 41.2 °C', description: 'The alert or finding the order comes from' }) @IsOptional() @IsString() @MaxLength(300) sourceNote?: string;
}
class StatusDto {
  @ApiProperty({ enum: ['in_progress', 'done', 'cancelled'] }) @IsString() @MaxLength(20) status!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(400) note?: string;
}
class AssignDto { @ApiPropertyOptional({ nullable: true, description: 'Name of the person responsible; empty clears it' }) @IsOptional() @IsString() @MaxLength(100) assignedTo?: string | null }

/** Traduce los errores del servicio a respuestas HTTP con un mensaje claro. */
function http(e: unknown): never {
  if (e instanceof InvalidWorkOrderError) throw new BadRequestException(e.message);
  if (e instanceof WorkOrderNotFoundError || e instanceof WorkOrderTargetMissingError) throw new NotFoundException(e.message);
  if (e instanceof WorkOrderStateError || e instanceof WorkOrderDuplicateError) throw new ConflictException(e.message);
  throw e;
}

@ApiTags('Work orders')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrdersController {
  constructor(@Inject(WORK_ORDERS) private readonly svc: WorkOrdersService) {}

  @Post()
  @Roles('manager')
  @ApiOperation({ summary: 'Create a work order (inspection, preventive or corrective maintenance) on a sensor or a network device (role manager)' })
  @ApiResponse({ status: 409, description: 'There is already an open work order of that type for that equipment' })
  async create(@Body() dto: CreateWorkOrderDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) {
    try { return await this.svc.create(validateNewWorkOrder(dto as any, new Date().toISOString().slice(0, 10)), req.user.email, req.correlationId ?? 'no-correlation'); } catch (e) { return http(e); }
  }

  @Get()
  @Roles('manager', 'project_lead')
  @ApiOperation({ summary: 'Work orders: open ones first, newest first (roles manager and project_lead)' })
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    if (status !== undefined && !(WO_STATUSES as readonly string[]).includes(status)) throw new BadRequestException('status is not valid');
    let n = 100;
    if (limit !== undefined) { if (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 200) throw new BadRequestException('limit must be a whole number from 1 to 200'); n = Number(limit); }
    return this.svc.list({ status, limit: n });
  }

  @Get(':id')
  @Roles('manager', 'project_lead')
  @ApiOperation({ summary: 'One work order with its history' })
  async get(@Param('id', new ParseUUIDPipe()) id: string) { try { return await this.svc.get(id); } catch (e) { return http(e); } }

  @Patch(':id/status')
  @Roles('manager')
  @ApiOperation({ summary: 'Change the status: open → in_progress → done, or cancelled (role manager). Done and cancelled are final' })
  @ApiResponse({ status: 409, description: 'That change is not allowed from the current status' })
  async status(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: StatusDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) {
    try { return await this.svc.changeStatus(id, dto.status, dto.note, req.user.email, req.correlationId ?? 'no-correlation'); } catch (e) { return http(e); }
  }

  @Patch(':id/assign')
  @Roles('manager')
  @ApiOperation({ summary: 'Set or clear the person responsible (a name) while the order is open (role manager)' })
  async assign(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AssignDto, @Req() req: Request & { user: AuthUser }) {
    try { return await this.svc.assign(id, dto.assignedTo, req.user.email); } catch (e) { return http(e); }
  }
}
