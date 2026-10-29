import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetTelemetryUseCase } from '../application/get-telemetry.use-case';
import { ExploreReadingsUseCase, GetTrendsUseCase } from '../application/explore.use-cases';
import { IngestReadingsUseCase, IngestRejectedError } from '../application/ingest-readings.use-case';
import { Public, Roles } from '../auth/auth.guard';
import { INGEST_KEY_HEADER, ServiceKeyGuard } from '../auth/service-key.guard';
import { ReadingsQueryDto } from './explorer.dto';

export const GET_TELEMETRY = 'GET_TELEMETRY';
export const GET_TRENDS = 'GET_TRENDS';
export const EXPLORE_READINGS = 'EXPLORE_READINGS';
export const INGEST_READINGS = 'INGEST_READINGS';
/** En el mensaje de error caben a lo sumo estos problemas; el resto se cuenta. */
const MAX_PROBLEMS_SHOWN = 20;

@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller('telemetry')
export class TelemetryController {
  constructor(
    @Inject(GET_TELEMETRY) private readonly getTelemetry: GetTelemetryUseCase,
    @Inject(GET_TRENDS) private readonly getTrends: GetTrendsUseCase,
    @Inject(EXPLORE_READINGS) private readonly explore: ExploreReadingsUseCase,
    @Inject(INGEST_READINGS) private readonly ingest: IngestReadingsUseCase,
  ) {}

  /** Solo el gerente: estado de la red y de los sensores IoT de Nexus, leído de la base de Operations & Telemetry. */
  @Get('summary')
  @Roles('manager')
  @ApiOperation({ summary: 'Network and IoT telemetry summary from the loaded Nexus data (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed (only the manager reads telemetry)' })
  summary() {
    return this.getTelemetry.execute();
  }

  /** Series por oficina, eventos y hallazgos (reglas sobre los datos) de un rango: 1d (por defecto), 7d, 30d, 180d o 365d, contado hacia atrás desde la lectura más reciente. */
  @Get('trends')
  @Roles('manager')
  @ApiOperation({ summary: 'Sensor trends by office for a range (1d default, 7d, 30d, 180d, 365d back from the latest reading; the slot widens with the range: 10 min, 2 h, 6 h, 2 days, 4 days), the latest alert and warning events, and rule-based findings (role manager)' })
  @ApiQuery({ name: 'range', required: false, enum: ['1d', '7d', '30d', '180d', '365d'] })
  @ApiResponse({ status: 400, description: 'Unknown range' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  trends(@Query('range') range?: string | string[]) {
    return this.getTrends.execute(Array.isArray(range) ? '' : range); // «?range=1d&range=7d» no es un rango válido
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

  /**
   * Ingesta de lecturas nuevas de los sensores. NO usa JWT de persona: usa la clave de servicio (cabecera x-ingest-key). Lote de 1 a 50
   * lecturas, «todo o nada»; es idempotente por (dispositivo, instante), así que reenviar un lote no duplica nada.
   */
  @Post('readings')
  @Public()
  @UseGuards(ServiceKeyGuard)
  @HttpCode(200)
  @ApiHeader({ name: INGEST_KEY_HEADER, description: 'Ingestion service key (not a user token)', required: true })
  @ApiOperation({ summary: 'Ingest a batch of new sensor readings (service key, no user token)' })
  @ApiResponse({ status: 200, description: '{ accepted, duplicates }: how many were stored and how many already existed' })
  @ApiResponse({ status: 400, description: 'The batch is not valid: nothing was stored (all or nothing)' })
  @ApiResponse({ status: 401, description: 'Missing or wrong ingestion key' })
  @ApiResponse({ status: 503, description: 'Ingestion is not configured on this server' })
  async ingestReadings(@Body() body: unknown) {
    try {
      return await this.ingest.execute(body);
    } catch (e) {
      if (!(e instanceof IngestRejectedError)) throw e;
      const shown = e.problems.slice(0, MAX_PROBLEMS_SHOWN).map((p) => `${p.path}: ${p.message}`);
      if (e.problems.length > MAX_PROBLEMS_SHOWN) shown.push(`(+${e.problems.length - MAX_PROBLEMS_SHOWN} more)`);
      throw new BadRequestException(shown);
    }
  }
}
