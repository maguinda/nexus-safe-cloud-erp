import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AllocateEngineerUseCase, CreateEngineerUseCase, DeleteAllocationUseCase, ListCapacityUseCase, SetSalaryUseCase } from '../application/capacity.use-cases';
import { AuthUser, Roles } from '../auth/auth.guard';
import { dayString } from '../domain/dates';
import { AllocateDto, CreateEngineerDto, SetSalaryDto } from './capacity.dto';

export const LIST_CAPACITY = 'LIST_CAPACITY';
export const CREATE_ENGINEER = 'CREATE_ENGINEER';
export const ALLOCATE = 'ALLOCATE';
export const DELETE_ALLOCATION = 'DELETE_ALLOCATION';
export const SET_SALARY = 'SET_SALARY';

@ApiTags('Capacity')
@ApiBearerAuth()
@Controller()
export class CapacityController {
  constructor(
    @Inject(LIST_CAPACITY) private readonly list: ListCapacityUseCase,
    @Inject(CREATE_ENGINEER) private readonly createEngineer: CreateEngineerUseCase,
    @Inject(ALLOCATE) private readonly allocate: AllocateEngineerUseCase,
    @Inject(DELETE_ALLOCATION) private readonly deleteAllocation: DeleteAllocationUseCase,
    @Inject(SET_SALARY) private readonly setSalary: SetSalaryUseCase,
  ) {}

  @Get('engineers')
  @Roles('project_lead', 'sales', 'manager')
  @ApiOperation({ summary: 'Engineers with skills, certifications, load today, the peak of the next 30 days and their upcoming allocations (US-07)' })
  async engineers(@Req() req: Request & { user: AuthUser }) {
    const r = await this.list.execute();
    // El sueldo y el costo diario son datos de gerencia: los demás roles no los reciben.
    if (req.user.role === 'manager') return r;
    return { ...r, engineers: r.engineers.map(({ dailyCostCop: _cost, monthlySalaryCop: _salary, ...rest }) => rest) };
  }

  @Post('engineers')
  @Roles('manager')
  @ApiOperation({ summary: 'Add an engineer or technician to the staff (role manager). The position is one of a fixed catalog and decides the kind.' })
  create(@Body() dto: CreateEngineerDto) { return this.createEngineer.execute(dto); }

  @Patch('engineers/:id/salary')
  @HttpCode(204)
  @Roles('manager')
  @ApiOperation({ summary: 'Write or clear the MONTHLY payroll salary (role manager). The cost per working day is derived (salary / 22) and applies to allocations made after the change.' })
  @ApiResponse({ status: 404, description: 'Engineer not found' })
  async salary(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SetSalaryDto) { await this.setSalary.execute(id, dto.monthlySalaryCop); }

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
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request & { correlationId?: string }) { await this.deleteAllocation.execute(id, req.correlationId ?? 'no-correlation'); }
}
