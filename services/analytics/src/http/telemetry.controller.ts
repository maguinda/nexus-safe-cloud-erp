import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetTelemetryUseCase } from '../application/get-telemetry.use-case';
import { Roles } from '../auth/auth.guard';

export const GET_TELEMETRY = 'GET_TELEMETRY';

@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller('telemetry')
export class TelemetryController {
  constructor(@Inject(GET_TELEMETRY) private readonly getTelemetry: GetTelemetryUseCase) {}

  /** Solo el gerente: estado de la red y de los sensores IoT de Nexus, leído del modelo de lectura de Analytics. */
  @Get('summary')
  @Roles('manager')
  @ApiOperation({ summary: 'Network and IoT telemetry summary from the loaded Nexus data (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed (only the manager reads telemetry)' })
  summary() {
    return this.getTelemetry.execute();
  }
}
