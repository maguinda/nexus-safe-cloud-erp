import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AuthUser, Roles } from '../auth/auth.guard';
import { QuotesService } from '../infrastructure/prisma-quotes';

export const QUOTES = 'QUOTES_SERVICE';

class CreateQuoteDto {
  @ApiProperty({ example: 'Acme S.A.S.', maxLength: 120 }) @IsString() @MaxLength(200) client!: string;
  @ApiProperty({ example: 'Red de la sede Bogotá', maxLength: 120 }) @IsString() @MaxLength(200) projectName!: string;
}
class RejectDto { @ApiProperty({ example: 'El margen es muy bajo para este alcance', maxLength: 300 }) @IsString() @MaxLength(400) note!: string }
class SaveQuoteDto {
  @ApiProperty() @IsString() @MaxLength(200) client!: string;
  @ApiProperty() @IsString() @MaxLength(200) projectName!: string;
  @ApiPropertyOptional({ example: 25, description: 'Margin over the cost, whole percent 0 to 100 (default 25)' }) @IsOptional() marginPct?: number;
  @ApiPropertyOptional({ description: 'Milestones with their cost lines: [{ name, lines: [{ category: materials|supplies|labor, description, quantity, unitCostCop, ref? }] }]' }) @IsOptional() milestones?: unknown[];
}

type Req2 = Request & { user: AuthUser; correlationId?: string };
const who = (r: Req2) => ({ email: r.user.email, role: r.user.role });

@ApiTags('Quotes')
@ApiBearerAuth()
@Controller('quotes')
export class QuotesController {
  constructor(@Inject(QUOTES) private readonly quotes: QuotesService) {}

  @Get() @Roles('sales', 'manager', 'project_lead')
  @ApiOperation({ summary: 'Quotes with their computed cost, price and profit (sales see their own; manager and project lead see all)' })
  list(@Req() req: Req2) { return this.quotes.list(who(req)); }

  @Get(':id') @Roles('sales', 'manager', 'project_lead')
  @ApiResponse({ status: 404, description: 'Quote not found' })
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Req2) { return this.quotes.get(id, who(req)); }

  @Post() @Roles('sales', 'manager')
  @ApiOperation({ summary: 'Start a quote (draft, margin 25 %) for a client and a project name' })
  create(@Body() dto: CreateQuoteDto, @Req() req: Req2) { return this.quotes.create(dto.client, dto.projectName, who(req)); }

  @Put(':id') @Roles('sales', 'manager')
  @ApiOperation({ summary: 'Replace the whole content (client, project, margin, milestones and cost lines) of a draft or rejected quote' })
  @ApiResponse({ status: 409, description: 'The quote is pending or approved' })
  save(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SaveQuoteDto, @Req() req: Req2) { return this.quotes.save(id, dto as unknown as Record<string, unknown>, who(req)); }

  @Post(':id/submit') @HttpCode(200) @Roles('sales', 'manager')
  @ApiOperation({ summary: 'Send a draft for approval (it needs a milestone and a cost line in each)' })
  submit(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Req2) { return this.quotes.submit(id, who(req)); }

  @Post(':id/approve') @HttpCode(200) @Roles('manager')
  @ApiOperation({ summary: 'Approve a pending quote: the project and its milestones are born here and Billing creates the contract (role manager)' })
  @ApiResponse({ status: 409, description: 'The quote is not pending' })
  approve(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Req2) { return this.quotes.approve(id, who(req), req.correlationId ?? 'no-correlation'); }

  @Post(':id/reject') @HttpCode(200) @Roles('manager')
  @ApiOperation({ summary: 'Reject a pending quote with a reason (role manager); sales can fix it and send it again' })
  reject(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RejectDto, @Req() req: Req2) { return this.quotes.reject(id, dto.note, who(req)); }
}
