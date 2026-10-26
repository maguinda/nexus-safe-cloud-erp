import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetNetworkUseCase } from '../application/get-network.use-case';
import { ExploreNetworkUseCase } from '../application/explore.use-cases';
import { Roles } from '../auth/auth.guard';
import { DevicesQueryDto, LinksQueryDto } from './explorer.dto';

export const GET_NETWORK = 'GET_NETWORK';
export const EXPLORE_NETWORK = 'EXPLORE_NETWORK';

@ApiTags('Network')
@ApiBearerAuth()
@Controller('network')
export class NetworkController {
  constructor(
    @Inject(GET_NETWORK) private readonly getNetwork: GetNetworkUseCase,
    @Inject(EXPLORE_NETWORK) private readonly explore: ExploreNetworkUseCase,
  ) {}

  /** Solo el gerente: inventario de la red de Nexus (dispositivos, enlaces y estado de monitoreo), leído del modelo de lectura de Analytics. */
  @Get('summary')
  @Roles('manager')
  @ApiOperation({ summary: 'Network inventory summary from the loaded Nexus data (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed (only the manager reads the network inventory)' })
  summary() {
    return this.getNetwork.execute();
  }

  @Get('devices')
  @Roles('manager')
  @ApiOperation({ summary: 'Filterable, sortable and paged list of the 76 devices of the inventory (role manager)' })
  @ApiResponse({ status: 400, description: 'A filter is not valid' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  devices(@Query() q: DevicesQueryDto) {
    return this.explore.devices({ ...q, monitored: q.monitored === undefined ? undefined : q.monitored === 'yes' });
  }

  @Get('links')
  @Roles('manager')
  @ApiOperation({ summary: 'Filterable, sortable and paged list of the 74 links (role manager)' })
  @ApiResponse({ status: 400, description: 'A filter is not valid' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  links(@Query() q: LinksQueryDto) {
    return this.explore.links(q);
  }

  @Get('facets')
  @Roles('manager')
  @ApiOperation({ summary: 'Values available for the network filters (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  facets() {
    return this.explore.facets();
  }
}
