import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetNetworkUseCase } from '../application/get-network.use-case';
import { Roles } from '../auth/auth.guard';

export const GET_NETWORK = 'GET_NETWORK';

@ApiTags('Network')
@ApiBearerAuth()
@Controller('network')
export class NetworkController {
  constructor(@Inject(GET_NETWORK) private readonly getNetwork: GetNetworkUseCase) {}

  /** Solo el gerente: inventario de la red de Nexus (dispositivos, enlaces y estado de monitoreo), leído del modelo de lectura de Analytics. */
  @Get('summary')
  @Roles('manager')
  @ApiOperation({ summary: 'Network inventory summary from the loaded Nexus data (role manager)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
  @ApiResponse({ status: 403, description: 'Role not allowed (only the manager reads the network inventory)' })
  summary() {
    return this.getNetwork.execute();
  }
}
