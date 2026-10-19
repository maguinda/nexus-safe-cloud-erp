import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetDashboardUseCase } from '../application/get-dashboard.use-case';
import { Roles } from '../auth/auth.guard';

export const GET_DASHBOARD = 'GET_DASHBOARD';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(GET_DASHBOARD) private readonly getDashboard: GetDashboardUseCase) {}

  /** Solo el gerente ve cifras financieras consolidadas. Lee exclusivamente el modelo de lectura de Analytics. */
  @Get()
  @Roles('manager')
  @ApiOperation({ summary: 'Consolidated dashboard from the read models (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed (only the manager sees financial figures)' })
  dashboard() {
    return this.getDashboard.execute();
  }
}
