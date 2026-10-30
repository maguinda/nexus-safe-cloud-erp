import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetProfitabilityUseCase } from '../application/get-profitability.use-case';
import { Roles } from '../auth/auth.guard';

export const GET_PROFITABILITY = 'GET_PROFITABILITY';

@ApiTags('Profitability')
@ApiBearerAuth()
@Controller('profitability')
export class ProfitabilityController {
  constructor(@Inject(GET_PROFITABILITY) private readonly get: GetProfitabilityUseCase) {}

  /** Mezcla ingresos y costos de personas: solo gerencia. */
  @Get()
  @Roles('manager')
  @ApiOperation({ summary: 'Profitability per project: issued invoices (without VAT) minus labor cost (allocation % x working days so far x daily cost) (role manager)' })
  @ApiResponse({ status: 403, description: 'Only the manager sees costs' })
  profitability() { return this.get.execute(); }
}
