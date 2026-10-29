import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AllocateEngineerUseCase, CreateEngineerUseCase, DeleteAllocationUseCase, ListCapacityUseCase } from '../application/capacity.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { dayString } from '../domain/dates';
import { AllocateDto, CreateEngineerDto } from './capacity.dto';

export const LIST_CAPACITY = 'LIST_CAPACITY';
export const CREATE_ENGINEER = 'CREATE_ENGINEER';
export const ALLOCATE = 'ALLOCATE';
export const DELETE_ALLOCATION = 'DELETE_ALLOCATION';

@ApiTags('Capacity')
@ApiBearerAuth()
@Controller()
export class CapacityController {
  constructor(
    @Inject(LIST_CAPACITY) private readonly list: ListCapacityUseCase,
    @Inject(CREATE_ENGINEER) private readonly createEngineer: CreateEngineerUseCase,
    @Inject(ALLOCATE) private readonly allocate: AllocateEngineerUseCase,
    @Inject(DELETE_ALLOCATION) private readonly deleteAllocation: DeleteAllocationUseCase,
  ) {}

  @Get('engineers')
  @Roles('project_lead', 'sales', 'manager')
  @ApiOperation({ summary: 'Engineers with skills, certifications, load today, the peak of the next 30 days and their upcoming allocations (US-07)' })
  engineers() { return this.list.execute(); }

  @Post('engineers')
  @Roles('manager')
  @ApiOperation({ summary: 'Add an engineer to the catalog (role manager)' })
  create(@Body() dto: CreateEngineerDto) { return this.createEngineer.execute(dto); }

  @Post('engineers/:id/allocations')
  @Roles('project_lead', 'manager')
  @ApiOperation({ summary: 'Allocate an engineer to a project for a period. Nobody goes over 100% on any day, unless the manager says so on purpose.' })
  @ApiResponse({ status: 409, description: 'It would put the engineer over 100% on some day' })
  async allocateEngineer(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: AllocateDto, @Req() req: Request & { user: AuthUser; correlationId?: string }) {
    if (dto.allowOverallocation && req.user.role !== 'manager') throw new ForbiddenException('Only the manager can allow going over 100%');
    const r = await this.allocate.execute(id, dto, req.correlationId ?? 'no-correlation');
    return { id: r.id, engineerId: r.engineerId, projectName: r.projectName, percent: r.percent, startDate: dayString(r.start), endDate: dayString(r.end), overAllocated: r.overAllocated, peak: r.peak };
  }

  @Delete('allocations/:id')
  @HttpCode(204)
  @Roles('project_lead', 'manager')
  @ApiOperation({ summary: 'Remove an allocation' })
  @ApiResponse({ status: 404, description: 'Allocation not found' })
  async remove(@Param('id', new ParseUUIDPipe()) id: string) { await this.deleteAllocation.execute(id); }
}
