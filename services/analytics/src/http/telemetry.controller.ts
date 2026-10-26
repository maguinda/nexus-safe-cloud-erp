import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetTelemetryUseCase } from '../application/get-telemetry.use-case';
import { ExploreReadingsUseCase, GetTrendsUseCase } from '../application/explore.use-cases';
import { Roles } from '../auth/auth.guard';
import { ReadingsQueryDto } from './explorer.dto';

export const GET_TELEMETRY = 'GET_TELEMETRY';
export const GET_TRENDS = 'GET_TRENDS';
export const EXPLORE_READINGS = 'EXPLORE_READINGS';

@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller('telemetry')
export class TelemetryController {
  constructor(
    @Inject(GET_TELEMETRY) private readonly getTelemetry: GetTelemetryUseCase,
    @Inject(GET_TRENDS) private readonly getTrends: GetTrendsUseCase,
    @Inject(EXPLORE_READINGS) private readonly explore: ExploreReadingsUseCase,
  ) {}

  /** Solo el gerente: estado de la red y de los sensores IoT de Nexus, leído del modelo de lectura de Analytics. */
  @Get('summary')
  @Roles('manager')
  @ApiOperation({ summary: 'Network and IoT telemetry summary from the loaded Nexus data (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed (only the manager reads telemetry)' })
  summary() {
    return this.getTelemetry.execute();
  }

  /** Series cada 10 minutos por oficina, eventos y hallazgos (reglas sobre los datos) para los gráficos del gerente. */
  @Get('trends')
  @Roles('manager')
  @ApiOperation({ summary: 'Sensor trends by office every 10 minutes, the alert and warning events, and rule-based findings (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  trends() {
    return this.getTrends.execute();
  }

  /** Explorador de lecturas con filtros (oficina, tipo, dispositivo, severidad, estado, horas), orden y paginación. */
  @Get('readings')
  @Roles('manager')
  @ApiOperation({ summary: 'Filterable, sortable and paged list of the loaded readings (role manager)' })
  @ApiResponse({ status: 400, description: 'A filter is not valid (unknown name, bad date, from after to, limit over 200)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  readings(@Query() q: ReadingsQueryDto) {
    return this.explore.readings({ ...q, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined });
  }

  /** Los valores que se pueden elegir en los filtros, con cuántas lecturas tiene cada estado. */
  @Get('facets')
  @Roles('manager')
  @ApiOperation({ summary: 'Values available for the readings filters (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  facets() {
    return this.explore.facets();
  }
}
