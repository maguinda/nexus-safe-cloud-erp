import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { ActivitiesService } from '../infrastructure/prisma-activities';
import { IdPipe } from './id.pipe';

export const ACTIVITIES = 'ACTIVITIES_SERVICE';

class OwnerDto {
  @ApiPropertyOptional({ nullable: true, description: 'Id of the engineer (from the staff list of Technical Capacity); null clears the owner' }) @IsOptional() ownerId?: string | null;
  @ApiPropertyOptional({ example: 'Ana Torres', description: 'Name of that engineer (required with ownerId)' }) @IsOptional() @IsString() @MaxLength(120) ownerName?: string;
}
class CreateActivityDto {
  @ApiProperty({ example: 'Instalar el switch de la oficina 2', minLength: 3, maxLength: 120 }) @IsString() @MaxLength(200) title!: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(400) description?: string;
  @ApiProperty({ description: 'Id of the technician in Technical Capacity (chosen from its staff list)' }) @IsDefined() assignedToId!: string;
  @ApiProperty({ example: 'Hugo Salazar' }) @IsString() @MaxLength(120) assignedTo!: string;
  @ApiPropertyOptional({ example: '2026-11-10', description: 'Due date, not in the past' }) @IsOptional() @IsString() @MaxLength(12) dueDate?: string;
}
class EditActivityDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() description?: string | null;
  @ApiPropertyOptional({ description: 'Reassign: needs assignedTo too' }) @IsOptional() assignedToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) assignedTo?: string;
  @ApiPropertyOptional({ nullable: true, description: 'null clears the due date' }) @IsOptional() dueDate?: string | null;
}
class ProgressDto {
  @ApiProperty({ enum: ['in_progress', 'done'] }) @IsString() @MaxLength(20) status!: string;
  @ApiPropertyOptional({ maxLength: 300, description: 'Only when finishing' }) @IsOptional() @IsString() @MaxLength(400) note?: string;
}

type Req2 = Request & { user: AuthUser; correlationId?: string };
const actor = (r: Req2) => ({ id: r.user.id, email: r.user.email, role: r.user.role, staffId: r.user.staffId });

@ApiTags('Activities')
@ApiBearerAuth()
@Controller()
export class ActivitiesController {
  constructor(@Inject(ACTIVITIES) private readonly svc: ActivitiesService) {}

  @Patch('milestones/:milestoneId/owner') @Roles('manager', 'project_lead')
  @ApiOperation({ summary: 'Choose (or clear) the engineer in charge of a milestone (manager, project lead). An approved milestone no longer changes owner' })
  @ApiResponse({ status: 404, description: 'Milestone not found' }) @ApiResponse({ status: 409, description: 'The milestone is already approved' })
  owner(@Param('milestoneId', new IdPipe()) id: string, @Body() dto: OwnerDto) { return this.svc.setOwner(id, dto.ownerId, dto.ownerName); }

  @Get('projects/:projectId/milestone-progress') @Roles('manager', 'project_lead')
  @ApiOperation({ summary: 'Owner and activity progress of every milestone of a project' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  progressByProject(@Param('projectId', new IdPipe()) id: string) { return this.svc.progressByProject(id); }

  @Get('my-milestones') @Roles('engineer')
  @ApiOperation({ summary: 'The milestones I am in charge of, with their project and activities (the person comes from the signed token; no money)' })
  myMilestones(@Req() req: Req2) { return this.svc.myMilestones(actor(req)); }

  @Get('my-activities') @Roles('technician')
  @ApiOperation({ summary: 'The activities assigned to me, with their milestone and project (the person comes from the signed token)' })
  myActivities(@Req() req: Req2) { return this.svc.myActivities(actor(req)); }

  @Get('milestones/:milestoneId/activities') @Roles('manager', 'project_lead', 'engineer')
  @ApiOperation({ summary: 'Activities of a milestone (an engineer only sees those of milestones they are in charge of; another one answers 404)' })
  @ApiResponse({ status: 404, description: 'Milestone not found, or not yours' })
  list(@Param('milestoneId', new IdPipe()) id: string, @Req() req: Req2) { return this.svc.listActivities(id, actor(req)); }

  @Post('milestones/:milestoneId/activities') @Roles('manager', 'project_lead', 'engineer')
  @ApiOperation({ summary: 'Add an activity to a milestone and assign it to a technician (the engineer in charge, the manager or the project lead)' })
  @ApiResponse({ status: 400, description: 'Invalid body' }) @ApiResponse({ status: 404, description: 'Milestone not found, or not yours' }) @ApiResponse({ status: 409, description: 'The milestone is already approved' })
  create(@Param('milestoneId', new IdPipe()) id: string, @Body() dto: CreateActivityDto, @Req() req: Req2) { return this.svc.create(id, actor(req), dto); }

  @Patch('activities/:id') @Roles('manager', 'project_lead', 'engineer')
  @ApiOperation({ summary: 'Edit or reassign a live activity (only what you send changes)' })
  @ApiResponse({ status: 404, description: 'Activity not found, or not yours' }) @ApiResponse({ status: 409, description: 'The activity is finished or cancelled' })
  edit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: EditActivityDto, @Req() req: Req2) { return this.svc.edit(id, actor(req), dto); }

  @Post('activities/:id/cancel') @HttpCode(200) @Roles('manager', 'project_lead', 'engineer')
  @ApiOperation({ summary: 'Cancel a live activity' })
  @ApiResponse({ status: 404, description: 'Activity not found, or not yours' }) @ApiResponse({ status: 409, description: 'The activity is finished or cancelled' })
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Req2) { return this.svc.cancel(id, actor(req)); }

  @Patch('activities/:id/progress') @Roles('technician')
  @ApiOperation({ summary: 'The assigned technician starts (in_progress) or finishes (done, with an optional note) their activity' })
  @ApiResponse({ status: 404, description: 'Activity not found, or not assigned to you' }) @ApiResponse({ status: 409, description: 'That change is not allowed from the current status' })
  progress(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ProgressDto, @Req() req: Req2) { return this.svc.progress(id, actor(req), dto.status, dto.note); }
}
