import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { CapacityRejectedError, CapacityUnavailableError } from '../infrastructure/capacity-client';
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
  @ApiPropertyOptional({ description: 'Id of the person in Technical Capacity (chosen from its staff list); needs assignedTo' }) @IsOptional() @IsString() @MaxLength(40) assignedToId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'Share of the working day the order takes from the person (required with assignedToId)' }) @IsOptional() capacityPercent?: number;
  @ApiPropertyOptional({ example: '2026-11-03', description: 'First day the person works on it (required with assignedToId)' }) @IsOptional() @IsString() @MaxLength(10) capacityStart?: string;
  @ApiPropertyOptional({ example: '2026-11-07', description: 'Last day (required with assignedToId)' }) @IsOptional() @IsString() @MaxLength(10) capacityEnd?: string;
  @ApiPropertyOptional({ description: 'Accept going over 100% of the person on purpose (role manager)' }) @IsOptional() allowOverallocation?: boolean;
  @ApiPropertyOptional({ example: 'ALERT 41.2 °C', description: 'The alert or finding the order comes from' }) @IsOptional() @IsString() @MaxLength(300) sourceNote?: string;
}
class StatusDto {
  @ApiProperty({ enum: ['in_progress', 'done', 'cancelled'] }) @IsString() @MaxLength(20) status!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(400) note?: string;
}
class AssignDto {
  @ApiPropertyOptional({ nullable: true, description: 'Name of the person responsible; empty clears it' }) @IsOptional() @IsString() @MaxLength(100) assignedTo?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Id of the person in Technical Capacity' }) @IsOptional() @IsString() @MaxLength(40) assignedToId?: string | null;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'Required with assignedToId' }) @IsOptional() capacityPercent?: number;
  @ApiPropertyOptional({ description: 'Required with assignedToId' }) @IsOptional() @IsString() @MaxLength(10) capacityStart?: string;
  @ApiPropertyOptional({ description: 'Required with assignedToId' }) @IsOptional() @IsString() @MaxLength(10) capacityEnd?: string;
  @ApiPropertyOptional() @IsOptional() allowOverallocation?: boolean;
}

/** Traduce los errores del servicio a respuestas HTTP con un mensaje claro. */
function http(e: unknown): never {
  if (e instanceof InvalidWorkOrderError) throw new BadRequestException(e.message);
  if (e instanceof WorkOrderNotFoundError || e instanceof WorkOrderTargetMissingError) throw new NotFoundException(e.message);
  if (e instanceof WorkOrderStateError || e instanceof WorkOrderDuplicateError) throw new ConflictException(e.message);
  // Capacidad dijo que no: se devuelve SU mensaje y su tipo de error (409 por pasarse de 100 %, 404 persona inexistente, 400 datos). Si no contestó, 502.
  if (e instanceof CapacityRejectedError) { if (e.status === 409) throw new ConflictException(e.message); if (e.status === 404) throw new NotFoundException(e.message); throw new BadRequestException(e.message); }
  if (e instanceof CapacityUnavailableError) throw new BadGatewayException(e.message);
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
    try { return await this.svc.create(validateNewWorkOrder(dto as any, new Date().toISOString().slice(0, 10)), req.user.email, req.correlationId ?? 'no-correlation', req.headers.authorization ?? ''); } catch (e) { return http(e); }
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

  @Get('mine')
  @Roles('engineer', 'technician')
  @ApiOperation({ summary: 'My work orders: only the ones where I am the responsible person (roles engineer and technician; the person comes from the signed token)' })
  mine(@Req() req: Request & { user: AuthUser }) { return this.svc.mine(req.user.staffId as string); }

  @Patch(':id/progress')
  @Roles('engineer', 'technician')
  @ApiOperation({ summary: 'Start (in_progress) or finish (done) one of MY work orders (roles engineer and technician). Cancelling is the manager’s; another person’s order answers 404' })
  @ApiResponse({ status: 404, description: 'There is no such order, or it is not mine' })
  @ApiResponse({ status: 409, description: 'That change is not allowed from the current status' })
  async progress(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: StatusDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) {
    if (dto.status !== 'in_progress' && dto.status !== 'done') throw new BadRequestException('status must be in_progress or done');
    try { return await this.svc.changeStatus(id, dto.status, dto.note, req.user.email, req.correlationId ?? 'no-correlation', req.user.staffId as string); } catch (e) { return http(e); }
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
  async assign(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AssignDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) {
    try { return await this.svc.assign(id, dto as unknown as Record<string, unknown>, req.user.email, req.correlationId ?? 'no-correlation', req.headers.authorization ?? ''); } catch (e) { return http(e); }
  }
}
