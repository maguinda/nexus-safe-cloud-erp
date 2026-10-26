import { Body, Controller, Inject, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SetLanguageUseCase } from '../application/set-language.use-case';
import { AuthUser } from '../auth/auth.guard';
import { SetLanguageDto } from './me.dto';

export const SET_LANGUAGE_USE_CASE = 'SET_LANGUAGE_USE_CASE';
export const ME_WRITE_RATE_LIMIT = Number(process.env.ME_WRITE_RATE_LIMIT ?? 30);

/** Lo que cada persona puede hacer sobre SÍ misma. Cualquier rol con token válido; sin @Roles: no hay nada que un rol pueda hacer al de otro. */
@ApiTags('Me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(@Inject(SET_LANGUAGE_USE_CASE) private readonly setLanguage: SetLanguageUseCase) {}

  @Patch('language')
  @Throttle({ default: { limit: ME_WRITE_RATE_LIMIT, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change the interface language of the person who signs the token (es or en). Any role.' })
  @ApiResponse({ status: 200, description: 'The saved language' })
  @ApiResponse({ status: 400, description: 'Language is not es or en, or the body has other fields' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, tampered or expired token' })
  @ApiResponse({ status: 404, description: 'The person no longer exists' })
  async language(@Req() req: { user: AuthUser }, @Body() dto: SetLanguageDto) {
    // El id sale del token firmado: el cuerpo no puede nombrar a otra persona (y si trae otro campo, 400).
    return { language: await this.setLanguage.execute(req.user.id, dto.language) };
  }
}
